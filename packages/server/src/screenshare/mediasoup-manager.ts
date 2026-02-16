import * as mediasoup from "mediasoup";
import type {
  Worker,
  Router,
  WebRtcTransport,
  Producer,
  Consumer,
  RtpCapabilities,
  MediaKind,
  RtpParameters,
  DtlsParameters,
} from "mediasoup/types";
import type { Config } from "../config.js";

const mediaCodecs: mediasoup.types.RouterRtpCodecCapability[] = [
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {},
  },
  {
    kind: "video",
    mimeType: "video/H264",
    clockRate: 90000,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "640032",
      "level-asymmetry-allowed": 1,
    },
  },
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
];

interface Room {
  router: Router;
  transports: Map<string, WebRtcTransport>; // transportId → transport
  producers: Map<string, Producer>; // producerId → producer
  consumers: Map<string, Consumer>; // consumerId → consumer
}

// Track which transports/producers/consumers belong to which user
interface UserResources {
  transportIds: Set<string>;
  producerIds: Set<string>;
  consumerIds: Set<string>;
}

export class MediasoupManager {
  private worker: Worker | null = null;
  private rooms = new Map<string, Room>(); // channelId → Room
  private userResources = new Map<string, UserResources>(); // `${channelId}:${userId}` → resources
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async init(): Promise<void> {
    this.worker = await mediasoup.createWorker({
      rtcMinPort: this.config.mediasoupMinPort,
      rtcMaxPort: this.config.mediasoupMaxPort,
      logLevel: "warn",
    });

    this.worker.on("died", () => {
      console.error("mediasoup Worker died, exiting in 2 seconds...");
      setTimeout(() => process.exit(1), 2000);
    });
  }

  private async getOrCreateRoom(channelId: string): Promise<Room> {
    let room = this.rooms.get(channelId);
    if (room) return room;

    if (!this.worker) throw new Error("MediasoupManager not initialized");

    const router = await this.worker.createRouter({ mediaCodecs });
    room = {
      router,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    };
    this.rooms.set(channelId, room);
    return room;
  }

  private getUserResources(channelId: string, userId: string): UserResources {
    const key = `${channelId}:${userId}`;
    let resources = this.userResources.get(key);
    if (!resources) {
      resources = {
        transportIds: new Set(),
        producerIds: new Set(),
        consumerIds: new Set(),
      };
      this.userResources.set(key, resources);
    }
    return resources;
  }

  getRtpCapabilities(channelId: string): RtpCapabilities | null {
    const room = this.rooms.get(channelId);
    return room?.router.rtpCapabilities ?? null;
  }

  async ensureRoom(channelId: string): Promise<RtpCapabilities> {
    const room = await this.getOrCreateRoom(channelId);
    return room.router.rtpCapabilities;
  }

  async createTransport(
    channelId: string,
    userId: string,
  ): Promise<{
    id: string;
    iceParameters: any;
    iceCandidates: any;
    dtlsParameters: any;
  }> {
    const room = await this.getOrCreateRoom(channelId);

    const announcedAddress = this.config.mediasoupAnnouncedIp || undefined;

    const transport = await room.router.createWebRtcTransport({
      listenInfos: [
        {
          protocol: "udp",
          ip: "0.0.0.0",
          ...(announcedAddress ? { announcedAddress } : {}),
        },
        {
          protocol: "tcp",
          ip: "0.0.0.0",
          ...(announcedAddress ? { announcedAddress } : {}),
        },
      ],
      initialAvailableOutgoingBitrate: 2_000_000,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });

    room.transports.set(transport.id, transport);
    this.getUserResources(channelId, userId).transportIds.add(transport.id);

    transport.on("routerclose", () => {
      room.transports.delete(transport.id);
    });

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  async connectTransport(
    channelId: string,
    transportId: string,
    dtlsParameters: DtlsParameters,
  ): Promise<void> {
    const room = this.rooms.get(channelId);
    if (!room) throw new Error("Room not found");

    const transport = room.transports.get(transportId);
    if (!transport) throw new Error("Transport not found");

    await transport.connect({ dtlsParameters });
  }

  async produce(
    channelId: string,
    userId: string,
    transportId: string,
    kind: MediaKind,
    rtpParameters: RtpParameters,
  ): Promise<string> {
    const room = this.rooms.get(channelId);
    if (!room) throw new Error("Room not found");

    const transport = room.transports.get(transportId);
    if (!transport) throw new Error("Transport not found");

    const producer = await transport.produce({ kind, rtpParameters });
    room.producers.set(producer.id, producer);
    this.getUserResources(channelId, userId).producerIds.add(producer.id);

    producer.on("transportclose", () => {
      room.producers.delete(producer.id);
    });

    return producer.id;
  }

  async consume(
    channelId: string,
    userId: string,
    transportId: string,
    producerId: string,
    rtpCapabilities: RtpCapabilities,
  ): Promise<{
    id: string;
    producerId: string;
    kind: MediaKind;
    rtpParameters: RtpParameters;
  }> {
    const room = this.rooms.get(channelId);
    if (!room) throw new Error("Room not found");

    if (!room.router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error("Cannot consume this producer");
    }

    const transport = room.transports.get(transportId);
    if (!transport) throw new Error("Transport not found");

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: true, // Start paused, client resumes after setup
    });

    room.consumers.set(consumer.id, consumer);
    this.getUserResources(channelId, userId).consumerIds.add(consumer.id);

    consumer.on("transportclose", () => {
      room.consumers.delete(consumer.id);
    });

    consumer.on("producerclose", () => {
      room.consumers.delete(consumer.id);
    });

    return {
      id: consumer.id,
      producerId: consumer.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  }

  async resumeConsumer(channelId: string, consumerId: string): Promise<void> {
    const room = this.rooms.get(channelId);
    if (!room) throw new Error("Room not found");

    const consumer = room.consumers.get(consumerId);
    if (!consumer) throw new Error("Consumer not found");

    await consumer.resume();
  }

  closeProducer(channelId: string, producerId: string): void {
    const room = this.rooms.get(channelId);
    if (!room) return;

    const producer = room.producers.get(producerId);
    if (producer) {
      producer.close();
      room.producers.delete(producerId);
    }
  }

  cleanupUser(channelId: string, userId: string): void {
    const key = `${channelId}:${userId}`;
    const resources = this.userResources.get(key);
    if (!resources) return;

    const room = this.rooms.get(channelId);
    if (room) {
      // Close consumers
      for (const consumerId of resources.consumerIds) {
        const consumer = room.consumers.get(consumerId);
        if (consumer) {
          consumer.close();
          room.consumers.delete(consumerId);
        }
      }

      // Close producers
      for (const producerId of resources.producerIds) {
        const producer = room.producers.get(producerId);
        if (producer) {
          producer.close();
          room.producers.delete(producerId);
        }
      }

      // Close transports
      for (const transportId of resources.transportIds) {
        const transport = room.transports.get(transportId);
        if (transport) {
          transport.close();
          room.transports.delete(transportId);
        }
      }

      // Clean up empty rooms
      if (
        room.transports.size === 0 &&
        room.producers.size === 0 &&
        room.consumers.size === 0
      ) {
        room.router.close();
        this.rooms.delete(channelId);
      }
    }

    this.userResources.delete(key);
  }
}
