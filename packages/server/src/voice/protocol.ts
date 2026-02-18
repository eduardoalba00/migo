import type { WebSocket } from "ws";
import { eq } from "drizzle-orm";
import { WsOpcode, DispatchEvent } from "@migo/shared";
import type { AppDatabase } from "../db/index.js";
import { users } from "../db/schema/users.js";
import type { ConnectionManager } from "../ws/connection.js";
import type { LiveKitService } from "./livekit.js";
import type { VoiceStateManager } from "./state.js";

function send(socket: WebSocket, data: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

export function handleVoiceStateUpdate(
  socket: WebSocket,
  userId: string,
  msg: any,
  livekit: LiveKitService,
  voiceState: VoiceStateManager,
  connectionManager: ConnectionManager,
  db: AppDatabase,
): void {
  const { channelId, serverId, muted, deafened } = msg.d ?? {};

  // Handle leave first — serverId not needed since state manager tracks it
  if (!channelId) {
    handleLeave(userId, voiceState, connectionManager, db);
    return;
  }

  // Handle mute/deafen state update for an already-joined user
  if (muted !== undefined || deafened !== undefined) {
    const participant = voiceState.getParticipant(userId);
    if (participant) {
      voiceState.updateState(userId, muted ?? participant.muted, deafened ?? participant.deafened);
      broadcastVoiceState(connectionManager, db, participant.serverId, userId, participant.channelId, false, voiceState);
      return;
    }
  }

  if (!serverId) return;

  // Join voice channel
  const { previousChannelId } = voiceState.join(userId, channelId, serverId);

  // Broadcast leave from previous channel if applicable
  if (previousChannelId && previousChannelId !== channelId) {
    broadcastVoiceState(connectionManager, db, serverId, userId, previousChannelId, true, voiceState);
  }

  // Broadcast join to server members
  broadcastVoiceState(connectionManager, db, serverId, userId, channelId, false, voiceState);
}

export function handleLeave(
  userId: string,
  voiceState: VoiceStateManager,
  connectionManager: ConnectionManager,
  db: AppDatabase,
): void {
  const participant = voiceState.getParticipant(userId);
  const wasScreenSharing = participant?.screenSharing;

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
  broadcastVoiceState(connectionManager, db, serverId, userId, channelId, true, voiceState);
}

export async function handleVoiceSignal(
  socket: WebSocket,
  userId: string,
  msg: any,
  livekit: LiveKitService,
  voiceState: VoiceStateManager,
  connectionManager: ConnectionManager,
  db: AppDatabase,
): Promise<void> {
  const { requestId, action, data } = msg.d ?? {};
  if (!requestId || !action) return;

  const participant = voiceState.getParticipant(userId);

  if (action === "startScreenShare") {
    if (!participant) return;
    const updated = voiceState.setScreenSharing(userId, true);
    if (updated) {
      connectionManager.broadcastToServer(updated.serverId, {
        op: WsOpcode.DISPATCH,
        t: DispatchEvent.SCREEN_SHARE_START,
        d: {
          userId,
          channelId: updated.channelId,
          serverId: updated.serverId,
        },
      });
      broadcastVoiceState(connectionManager, db, updated.serverId, userId, updated.channelId, false, voiceState);
    }

    // Generate a LiveKit token for the screen share participant (userId|screen)
    try {
      const roomName = `voice-${participant.channelId}`;
      const screenIdentity = `${userId}|screen`;
      const token = await livekit.generateToken(screenIdentity, screenIdentity, roomName);
      send(socket, {
        op: WsOpcode.VOICE_SIGNAL,
        d: { requestId, action, data: { token, url: livekit.url } },
      });
    } catch (err: any) {
      send(socket, {
        op: WsOpcode.VOICE_SIGNAL,
        d: { requestId, action, error: err.message || "Failed to generate screen share token" },
      });
    }
    return;
  }

  if (action === "stopScreenShare") {
    if (!participant) return;
    const updated = voiceState.setScreenSharing(userId, false);
    if (updated) {
      connectionManager.broadcastToServer(updated.serverId, {
        op: WsOpcode.DISPATCH,
        t: DispatchEvent.SCREEN_SHARE_STOP,
        d: { userId, channelId: updated.channelId, serverId: updated.serverId },
      });
      broadcastVoiceState(connectionManager, db, updated.serverId, userId, updated.channelId, false, voiceState);
    }
    send(socket, {
      op: WsOpcode.VOICE_SIGNAL,
      d: { requestId, action, data: {} },
    });
    return;
  }

  if (action === "joinVoice") {
    if (!participant) {
      send(socket, {
        op: WsOpcode.VOICE_SIGNAL,
        d: { requestId, action, error: "Not in a voice channel" },
      });
      return;
    }

    try {
      const roomName = `voice-${participant.channelId}`;
      const token = await livekit.generateToken(userId, data?.displayName || userId, roomName);
      send(socket, {
        op: WsOpcode.VOICE_SIGNAL,
        d: { requestId, action, data: { token, url: livekit.url } },
      });
    } catch (err: any) {
      send(socket, {
        op: WsOpcode.VOICE_SIGNAL,
        d: { requestId, action, error: err.message || "Failed to generate token" },
      });
    }
    return;
  }

  send(socket, {
    op: WsOpcode.VOICE_SIGNAL,
    d: { requestId, action, error: "Unknown action" },
  });
}

async function broadcastVoiceState(
  connectionManager: ConnectionManager,
  db: AppDatabase,
  serverId: string,
  userId: string,
  channelId: string,
  left: boolean,
  voiceState: VoiceStateManager,
): Promise<void> {
  const user = await db.select().from(users).where(eq(users.id, userId)).then(r => r[0]);
  const participant = voiceState.getParticipant(userId);

  connectionManager.broadcastToServer(serverId, {
    op: WsOpcode.DISPATCH,
    t: DispatchEvent.VOICE_STATE_UPDATE,
    d: {
      userId,
      channelId: left ? null : channelId,
      serverId,
      muted: participant?.muted ?? false,
      deafened: participant?.deafened ?? false,
      screenSharing: participant?.screenSharing ?? false,
      username: user?.username ?? "",
      displayName: user?.displayName ?? "",
      avatarUrl: user?.avatarUrl ?? null,
    },
  });
}
