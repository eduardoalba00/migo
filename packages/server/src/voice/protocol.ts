import type { WebSocket } from "ws";
import { eq } from "drizzle-orm";
import { WsOpcode, DispatchEvent } from "@nexus/shared";
import type { VoiceSignalAction } from "@nexus/shared";
import type { AppDatabase } from "../db/index.js";
import { users } from "../db/schema/users.js";
import type { ConnectionManager } from "../ws/connection.js";
import type { MediasoupManager } from "./mediasoup-manager.js";
import type { VoiceStateManager, VoiceParticipant } from "./state.js";

function send(socket: WebSocket, data: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

function sendSignalResponse(
  socket: WebSocket,
  requestId: string,
  action: VoiceSignalAction,
  data?: any,
  error?: string,
): void {
  send(socket, {
    op: WsOpcode.VOICE_SIGNAL,
    d: { requestId, action, ...(data !== undefined && { data }), ...(error && { error }) },
  });
}

export function handleVoiceStateUpdate(
  socket: WebSocket,
  userId: string,
  msg: any,
  mediasoup: MediasoupManager,
  voiceState: VoiceStateManager,
  connectionManager: ConnectionManager,
  db: AppDatabase,
): void {
  const { channelId, serverId } = msg.d ?? {};

  // Handle leave first — serverId not needed since state manager tracks it
  if (!channelId) {
    handleLeave(userId, mediasoup, voiceState, connectionManager, db);
    return;
  }

  if (!serverId) return;

  // Join voice channel
  const { previousChannelId } = voiceState.join(userId, channelId, serverId);

  // Broadcast leave from previous channel if applicable
  if (previousChannelId && previousChannelId !== channelId) {
    broadcastVoiceState(connectionManager, db, serverId, userId, previousChannelId, true);

    // Clean up empty router
    if (voiceState.isChannelEmpty(previousChannelId)) {
      mediasoup.closeRouter(previousChannelId);
    }
  }

  // Get or create router, then send RTP capabilities back
  mediasoup.getOrCreateRouter(channelId).then((router) => {
    send(socket, {
      op: WsOpcode.VOICE_SIGNAL,
      d: {
        requestId: "__join__",
        action: "routerRtpCapabilities",
        data: router.rtpCapabilities,
      },
    });
  });

  // Broadcast join to server members
  broadcastVoiceState(connectionManager, db, serverId, userId, channelId, false);
}

export function handleLeave(
  userId: string,
  mediasoup: MediasoupManager,
  voiceState: VoiceStateManager,
  connectionManager: ConnectionManager,
  db: AppDatabase,
): void {
  // Check if user was screen sharing before leaving
  const participant = voiceState.getParticipant(userId);
  const wasScreenSharing = participant?.screenProducer && !participant.screenProducer.closed;

  const result = voiceState.leave(userId);
  if (!result) return;

  const { channelId, serverId } = result;

  // Broadcast screen share stop if they were sharing
  if (wasScreenSharing) {
    connectionManager.broadcastToServer(serverId, {
      op: WsOpcode.DISPATCH,
      t: DispatchEvent.SCREEN_SHARE_STOP,
      d: { userId, channelId, serverId },
    });
  }

  // Broadcast leave to server members
  broadcastVoiceState(connectionManager, db, serverId, userId, channelId, true);

  // Close router if channel is now empty
  if (voiceState.isChannelEmpty(channelId)) {
    mediasoup.closeRouter(channelId);
  }
}

export async function handleVoiceSignal(
  socket: WebSocket,
  userId: string,
  msg: any,
  mediasoup: MediasoupManager,
  voiceState: VoiceStateManager,
  connectionManager: ConnectionManager,
): Promise<void> {
  const { requestId, action, data } = msg.d ?? {};
  if (!requestId || !action) return;

  const participant = voiceState.getParticipant(userId);
  if (!participant) {
    sendSignalResponse(socket, requestId, action, undefined, "Not in a voice channel");
    return;
  }

  const router = mediasoup.getRouter(participant.channelId);
  if (!router) {
    sendSignalResponse(socket, requestId, action, undefined, "No router for channel");
    return;
  }

  try {
    switch (action as VoiceSignalAction) {
      case "createSendTransport": {
        const transport = await mediasoup.createWebRtcTransport(router);
        participant.sendTransport = transport;
        sendSignalResponse(socket, requestId, action, {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        });
        break;
      }

      case "connectTransport": {
        const { transportId, dtlsParameters } = data;
        const transport =
          participant.sendTransport?.id === transportId
            ? participant.sendTransport
            : participant.recvTransport?.id === transportId
              ? participant.recvTransport
              : null;

        if (!transport) {
          sendSignalResponse(socket, requestId, action, undefined, "Transport not found");
          return;
        }

        await transport.connect({ dtlsParameters });
        sendSignalResponse(socket, requestId, action, { connected: true });
        break;
      }

      case "produce": {
        if (!participant.sendTransport) {
          sendSignalResponse(socket, requestId, action, undefined, "No send transport");
          return;
        }

        const produceKind = data.kind === "video" ? "video" : "audio";
        const producer = await participant.sendTransport.produce({
          kind: produceKind as any,
          rtpParameters: data.rtpParameters,
        });

        if (produceKind === "video") {
          participant.screenProducer = producer;

          // Auto-broadcast stop when producer closes
          producer.on("transportclose", () => {
            connectionManager.broadcastToServer(participant.serverId, {
              op: WsOpcode.DISPATCH,
              t: DispatchEvent.SCREEN_SHARE_STOP,
              d: { userId, channelId: participant.channelId, serverId: participant.serverId },
            });
          });

          // Broadcast screen share start
          connectionManager.broadcastToServer(participant.serverId, {
            op: WsOpcode.DISPATCH,
            t: DispatchEvent.SCREEN_SHARE_START,
            d: { userId, channelId: participant.channelId, serverId: participant.serverId },
          });
        } else {
          participant.producer = producer;
        }

        sendSignalResponse(socket, requestId, action, { producerId: producer.id });

        // Notify other participants to consume this new producer
        notifyNewProducer(
          userId,
          producer.id,
          produceKind,
          participant.channelId,
          voiceState,
          connectionManager,
        );

        // Notify this user about all existing producers in the channel (only on first audio produce)
        if (produceKind === "audio") {
          notifyExistingProducers(
            userId,
            participant.channelId,
            voiceState,
            connectionManager,
          );
        }
        break;
      }

      case "createRecvTransport": {
        const transport = await mediasoup.createWebRtcTransport(router);
        participant.recvTransport = transport;
        sendSignalResponse(socket, requestId, action, {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        });
        break;
      }

      case "consume": {
        if (!participant.recvTransport) {
          sendSignalResponse(socket, requestId, action, undefined, "No recv transport");
          return;
        }

        const { producerId, rtpCapabilities } = data;
        if (!router.canConsume({ producerId, rtpCapabilities })) {
          sendSignalResponse(socket, requestId, action, undefined, "Cannot consume");
          return;
        }

        const consumer = await participant.recvTransport.consume({
          producerId,
          rtpCapabilities,
          paused: true, // Start paused, client will resume
        });

        // Find which user owns this producer
        const producerUserId = findProducerOwner(producerId, participant.channelId, voiceState);
        participant.consumers.set(producerUserId || producerId, consumer);

        sendSignalResponse(socket, requestId, action, {
          consumerId: consumer.id,
          producerId: consumer.producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
          producerUserId,
        });
        break;
      }

      case "resumeConsumer": {
        const { consumerId } = data;
        for (const consumer of participant.consumers.values()) {
          if (consumer.id === consumerId) {
            await consumer.resume();
            break;
          }
        }
        sendSignalResponse(socket, requestId, action, { resumed: true });
        break;
      }

      case "stopScreenShare": {
        if (participant.screenProducer && !participant.screenProducer.closed) {
          participant.screenProducer.close();
        }
        participant.screenProducer = null;

        connectionManager.broadcastToServer(participant.serverId, {
          op: WsOpcode.DISPATCH,
          t: DispatchEvent.SCREEN_SHARE_STOP,
          d: { userId, channelId: participant.channelId, serverId: participant.serverId },
        });

        sendSignalResponse(socket, requestId, action, { stopped: true });
        break;
      }

      default:
        sendSignalResponse(socket, requestId, action, undefined, "Unknown action");
    }
  } catch (err: any) {
    sendSignalResponse(socket, requestId, action, undefined, err.message || "Internal error");
  }
}

async function broadcastVoiceState(
  connectionManager: ConnectionManager,
  db: AppDatabase,
  serverId: string,
  userId: string,
  channelId: string,
  left: boolean,
): Promise<void> {
  // Look up user info to include in the broadcast
  const user = await db.select().from(users).where(eq(users.id, userId)).get();

  connectionManager.broadcastToServer(serverId, {
    op: WsOpcode.DISPATCH,
    t: DispatchEvent.VOICE_STATE_UPDATE,
    d: {
      userId,
      channelId: left ? null : channelId,
      serverId,
      muted: false,
      deafened: false,
      username: user?.username ?? "",
      displayName: user?.displayName ?? "",
      avatarUrl: user?.avatarUrl ?? null,
    },
  });
}

function notifyNewProducer(
  producerUserId: string,
  producerId: string,
  kind: "audio" | "video",
  channelId: string,
  voiceState: VoiceStateManager,
  connectionManager: ConnectionManager,
): void {
  const participants = voiceState.getChannelUsers(channelId);
  for (const p of participants) {
    if (p.userId === producerUserId) continue;
    // Send a signal to each other participant telling them a new producer is available
    connectionManager.sendTo(p.userId, {
      op: WsOpcode.VOICE_SIGNAL,
      d: {
        requestId: "__newProducer__",
        action: "consume",
        data: { producerId, producerUserId, kind },
      },
    });
  }
}

function notifyExistingProducers(
  userId: string,
  channelId: string,
  voiceState: VoiceStateManager,
  connectionManager: ConnectionManager,
): void {
  const participants = voiceState.getChannelUsers(channelId);
  for (const p of participants) {
    if (p.userId === userId) continue;
    // Notify about audio producer
    if (p.producer && !p.producer.closed) {
      connectionManager.sendTo(userId, {
        op: WsOpcode.VOICE_SIGNAL,
        d: {
          requestId: "__newProducer__",
          action: "consume",
          data: { producerId: p.producer.id, producerUserId: p.userId, kind: "audio" },
        },
      });
    }
    // Notify about screen share (video) producer
    if (p.screenProducer && !p.screenProducer.closed) {
      connectionManager.sendTo(userId, {
        op: WsOpcode.VOICE_SIGNAL,
        d: {
          requestId: "__newProducer__",
          action: "consume",
          data: { producerId: p.screenProducer.id, producerUserId: p.userId, kind: "video" },
        },
      });
    }
  }
}

function findProducerOwner(
  producerId: string,
  channelId: string,
  voiceState: VoiceStateManager,
): string | null {
  const participants = voiceState.getChannelUsers(channelId);
  for (const p of participants) {
    if (p.producer?.id === producerId) return p.userId;
    if (p.screenProducer?.id === producerId) return p.userId;
  }
  return null;
}
