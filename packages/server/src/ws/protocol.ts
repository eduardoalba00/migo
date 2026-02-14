import type { WebSocket } from "ws";
import { eq, and, inArray } from "drizzle-orm";
import { WsOpcode, DispatchEvent, PROTOCOL_VERSION, MIN_CLIENT_VERSION } from "@migo/shared";
import type { AuthService } from "../services/auth.js";
import type { AppDatabase } from "../db/index.js";
import { serverMembers } from "../db/schema/servers.js";
import { channels } from "../db/schema/channels.js";
import { users } from "../db/schema/users.js";
import type { ConnectionManager } from "./connection.js";
import type { LiveKitService } from "../voice/livekit.js";
import type { VoiceStateManager } from "../voice/state.js";
import { handleVoiceStateUpdate, handleVoiceSignal, handleLeave } from "../voice/protocol.js";

const HEARTBEAT_INTERVAL = 30_000;
const HEARTBEAT_TIMEOUT = 45_000;
const CLOSE_CLIENT_OUTDATED = 4010;

function isVersionAtLeast(version: string, minimum: string): boolean {
  const v = version.split(".").map(Number);
  const m = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((v[i] || 0) > (m[i] || 0)) return true;
    if ((v[i] || 0) < (m[i] || 0)) return false;
  }
  return true; // equal
}

export function handleConnection(
  socket: WebSocket,
  db: AppDatabase,
  authService: AuthService,
  connectionManager: ConnectionManager,
  livekitService: LiveKitService,
  voiceStateManager: VoiceStateManager,
) {
  let userId: string | null = null;
  let identified = false;

  // Must identify within 10 seconds
  const identifyTimeout = setTimeout(() => {
    if (!identified) {
      socket.close(4001, "Identify timeout");
    }
  }, 10_000);

  socket.on("message", async (raw: import("ws").RawData) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.op === WsOpcode.IDENTIFY && !identified) {
      clearTimeout(identifyTimeout);

      try {
        // Check client version before auth
        const clientVersion = msg.d?.version;
        if (!clientVersion || !isVersionAtLeast(clientVersion, MIN_CLIENT_VERSION)) {
          socket.close(CLOSE_CLIENT_OUTDATED, "Client outdated");
          return;
        }

        const payload = await authService.verifyAccessToken(msg.d?.token);
        userId = payload.sub;
        identified = true;

        // Get user's server memberships
        const memberships = await db
          .select()
          .from(serverMembers)
          .where(eq(serverMembers.userId, userId))
          ;

        const serverIds = memberships.map((m) => m.serverId);
        const conn = connectionManager.add(userId, socket, serverIds);

        // Start heartbeat
        conn.alive = true;
        conn.heartbeatTimer = setInterval(() => {
          if (!conn.alive) {
            socket.close(4002, "Heartbeat timeout");
            return;
          }
          conn.alive = false;
        }, HEARTBEAT_TIMEOUT);

        // Set user online and broadcast presence
        await db
          .update(users)
          .set({ status: "online" })
          .where(eq(users.id, userId))
          ;

        for (const serverId of serverIds) {
          connectionManager.broadcastToServer(serverId, {
            op: 0,
            t: "PRESENCE_UPDATE",
            d: { userId, status: "online" },
          });
        }

        // Send READY
        socket.send(
          JSON.stringify({
            op: WsOpcode.READY,
            d: { heartbeatInterval: HEARTBEAT_INTERVAL, serverVersion: PROTOCOL_VERSION },
          }),
        );

        // Send current voice states for all servers the user is in
        const voiceStates = voiceStateManager.getStatesForServers(serverIds);
        if (voiceStates.length > 0) {
          // Look up user info for all voice participants
          const voiceUserIds = [...new Set(voiceStates.map((s) => s.userId))];
          const voiceUsers = voiceUserIds.length > 0
            ? await db.select().from(users).where(inArray(users.id, voiceUserIds))            : [];
          const userMap = new Map(voiceUsers.map((u) => [u.id, u]));

          for (const vs of voiceStates) {
            const u = userMap.get(vs.userId);
            socket.send(
              JSON.stringify({
                op: WsOpcode.DISPATCH,
                t: DispatchEvent.VOICE_STATE_UPDATE,
                d: {
                  userId: vs.userId,
                  channelId: vs.channelId,
                  serverId: vs.serverId,
                  muted: vs.muted,
                  deafened: vs.deafened,
                  username: u?.username ?? "",
                  displayName: u?.displayName ?? "",
                  avatarUrl: u?.avatarUrl ?? null,
                },
              }),
            );
          }
        }
      } catch {
        socket.close(4003, "Authentication failed");
      }
      return;
    }

    if (msg.op === WsOpcode.HEARTBEAT && identified && userId) {
      const conn = connectionManager.get(userId);
      if (conn) conn.alive = true;

      socket.send(
        JSON.stringify({
          op: WsOpcode.HEARTBEAT_ACK,
          d: null,
        }),
      );
      return;
    }

    if (msg.op === WsOpcode.VOICE_STATE_UPDATE && identified && userId) {
      handleVoiceStateUpdate(socket, userId, msg, livekitService, voiceStateManager, connectionManager, db);
      return;
    }

    if (msg.op === WsOpcode.VOICE_SIGNAL && identified && userId) {
      handleVoiceSignal(socket, userId, msg, livekitService, voiceStateManager);
      return;
    }

    if (msg.op === WsOpcode.TYPING_START && identified && userId) {
      const channelId = msg.d?.channelId;
      if (!channelId) return;

      // Find the channel's server and verify membership
      const channel = await db
        .select()
        .from(channels)
        .where(eq(channels.id, channelId))
        .then(r => r[0]);
      if (!channel) return;

      const member = await db
        .select()
        .from(serverMembers)
        .where(
          and(
            eq(serverMembers.serverId, channel.serverId),
            eq(serverMembers.userId, userId),
          ),
        )
        .then(r => r[0]);
      if (!member) return;

      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .then(r => r[0]);
      if (!user) return;

      connectionManager.broadcastToServer(channel.serverId, {
        op: 0,
        t: "TYPING_START",
        d: {
          channelId,
          userId,
          username: user.username,
          displayName: user.displayName,
        },
      });
      return;
    }
  });

  socket.on("close", async () => {
    clearTimeout(identifyTimeout);
    if (userId) {
      // Stale-socket guard: if a new connection already replaced this one,
      // the close event is from the old socket — bail out to avoid destroying
      // the new connection's subscriptions.
      const conn = connectionManager.get(userId);
      if (conn && conn.socket !== socket) {
        return;
      }

      // Set user offline and broadcast presence
      await db
        .update(users)
        .set({ status: "offline" })
        .where(eq(users.id, userId))
        ;

      if (conn) {
        for (const serverId of conn.subscribedServers) {
          connectionManager.broadcastToServer(serverId, {
            op: 0,
            t: "PRESENCE_UPDATE",
            d: { userId, status: "offline" },
          });
        }
      }

      // Auto-leave voice channel on disconnect
      handleLeave(userId, voiceStateManager, connectionManager, db);
      connectionManager.remove(userId);
    }
  });
}
