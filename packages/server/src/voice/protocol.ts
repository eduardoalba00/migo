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
  const { channelId, serverId } = msg.d ?? {};

  // Handle leave first — serverId not needed since state manager tracks it
  if (!channelId) {
    handleLeave(userId, voiceState, connectionManager, db);
    return;
  }

  if (!serverId) return;

  // Join voice channel
  const { previousChannelId } = voiceState.join(userId, channelId, serverId);

  // Broadcast leave from previous channel if applicable
  if (previousChannelId && previousChannelId !== channelId) {
    broadcastVoiceState(connectionManager, db, serverId, userId, previousChannelId, true);
  }

  // Broadcast join to server members
  broadcastVoiceState(connectionManager, db, serverId, userId, channelId, false);
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
  broadcastVoiceState(connectionManager, db, serverId, userId, channelId, true);
}

export async function handleVoiceSignal(
  socket: WebSocket,
  userId: string,
  msg: any,
  livekit: LiveKitService,
  voiceState: VoiceStateManager,
): Promise<void> {
  const { requestId, action, data } = msg.d ?? {};
  if (!requestId || !action) return;

  if (action === "joinVoice") {
    const participant = voiceState.getParticipant(userId);
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
): Promise<void> {
  const user = await db.select().from(users).where(eq(users.id, userId)).then(r => r[0]);

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
