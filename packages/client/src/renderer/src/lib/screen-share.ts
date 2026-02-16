import { Device } from "mediasoup-client";
import type { Transport, Producer, Consumer } from "mediasoup-client/lib/types";
import { ScreenCapture, CapturePresets } from "./screen-capture";
import type { CapturePreset } from "./screen-capture";

type VoiceSignalFn = (action: string, data?: any) => Promise<any>;

export class ScreenShareManager {
  private device: Device | null = null;
  private sendTransport: Transport | null = null;
  private recvTransport: Transport | null = null;
  private producer: Producer | null = null;
  private consumer: Consumer | null = null;
  private capture: ScreenCapture | null = null;
  private voiceSignal: VoiceSignalFn;

  constructor(voiceSignal: VoiceSignalFn) {
    this.voiceSignal = voiceSignal;
  }

  async initDevice(): Promise<void> {
    const { rtpCapabilities } = await this.voiceSignal("screenGetCapabilities");

    this.device = new Device();
    await this.device.load({ routerRtpCapabilities: rtpCapabilities });
  }

  async startSharing(sourceId: string, preset?: CapturePreset): Promise<{
    producerId: string;
    track: MediaStreamTrack;
  }> {
    if (!this.device) {
      throw new Error("Device not initialized — call initDevice() first");
    }

    const presetConfig = preset ? CapturePresets[preset] : CapturePresets["1080p60"];

    // 1. Capture the screen/window and get a MediaStreamTrack
    this.capture = new ScreenCapture({
      sourceId,
      maxWidth: presetConfig.maxWidth,
      maxHeight: presetConfig.maxHeight,
      maxFrameRate: presetConfig.maxFrameRate,
    });
    const track = await this.capture.start();

    // 2. Create send transport
    const transportParams = await this.voiceSignal("screenCreateTransport");

    this.sendTransport = this.device.createSendTransport({
      id: transportParams.id,
      iceParameters: transportParams.iceParameters,
      iceCandidates: transportParams.iceCandidates,
      dtlsParameters: transportParams.dtlsParameters,
    });

    this.sendTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
      try {
        await this.voiceSignal("screenConnectTransport", {
          transportId: this.sendTransport!.id,
          dtlsParameters,
        });
        callback();
      } catch (err) {
        errback(err as Error);
      }
    });

    this.sendTransport.on("produce", async ({ kind, rtpParameters }, callback, errback) => {
      try {
        const { producerId } = await this.voiceSignal("screenProduce", {
          transportId: this.sendTransport!.id,
          kind,
          rtpParameters,
        });
        callback({ id: producerId });
      } catch (err) {
        errback(err as Error);
      }
    });

    // 3. Produce the track
    this.producer = await this.sendTransport.produce({
      track,
      encodings: [
        {
          maxBitrate: 8_000_000,
          maxFramerate: presetConfig.maxFrameRate,
        },
      ],
      codecOptions: {
        videoGoogleStartBitrate: 1000,
      },
    });

    return { producerId: this.producer.id, track };
  }

  async viewStream(producerId: string): Promise<MediaStreamTrack> {
    if (!this.device) {
      throw new Error("Device not initialized — call initDevice() first");
    }

    // Create recv transport
    const transportParams = await this.voiceSignal("screenCreateTransport");

    this.recvTransport = this.device.createRecvTransport({
      id: transportParams.id,
      iceParameters: transportParams.iceParameters,
      iceCandidates: transportParams.iceCandidates,
      dtlsParameters: transportParams.dtlsParameters,
    });

    this.recvTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
      try {
        await this.voiceSignal("screenConnectTransport", {
          transportId: this.recvTransport!.id,
          dtlsParameters,
        });
        callback();
      } catch (err) {
        errback(err as Error);
      }
    });

    // Consume the producer
    const consumerParams = await this.voiceSignal("screenConsume", {
      transportId: this.recvTransport.id,
      producerId,
      rtpCapabilities: this.device.rtpCapabilities,
    });

    this.consumer = await this.recvTransport.consume({
      id: consumerParams.id,
      producerId: consumerParams.producerId,
      kind: consumerParams.kind,
      rtpParameters: consumerParams.rtpParameters,
    });

    // Resume the consumer on the server
    await this.voiceSignal("screenResumeConsumer", {
      consumerId: this.consumer.id,
    });

    return this.consumer.track;
  }

  stopSharing(): void {
    if (this.producer) {
      this.producer.close();
      this.producer = null;
    }
    if (this.sendTransport) {
      this.sendTransport.close();
      this.sendTransport = null;
    }
    if (this.capture) {
      this.capture.stop();
      this.capture = null;
    }
  }

  stopViewing(): void {
    if (this.consumer) {
      this.consumer.close();
      this.consumer = null;
    }
    if (this.recvTransport) {
      this.recvTransport.close();
      this.recvTransport = null;
    }
  }

  dispose(): void {
    this.stopSharing();
    this.stopViewing();
    this.device = null;
  }
}
