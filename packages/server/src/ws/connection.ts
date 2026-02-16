import type { WebSocket } from "ws";
import type { PubSub } from "./pubsub.js";

export interface Connection {
  userId: string;
  socket: WebSocket;
  subscribedServers: Set<string>;
  heartbeatTimer: ReturnType<typeof setTimeout> | null;
  alive: boolean;
}

export class ConnectionManager {
  private connections = new Map<string, Connection>();

  constructor(private pubsub: PubSub) {}

  add(userId: string, socket: WebSocket, serverIds: string[]): Connection {
    // Close existing connection if any
    const existing = this.connections.get(userId);
    if (existing) {
      this.remove(userId);
      existing.socket.close(4000, "New connection opened");
    }

    const conn: Connection = {
      userId,
      socket,
      subscribedServers: new Set(serverIds),
      heartbeatTimer: null,
      alive: true,
    };

    this.connections.set(userId, conn);

    // Subscribe to all server topics
    for (const serverId of serverIds) {
      const handler = (message: unknown) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(message));
        }
      };
      this.pubsub.subscribe(`server:${serverId}`, handler);
      // Store handler for cleanup
      (conn as any)[`_handler_server:${serverId}`] = handler;
    }

    return conn;
  }

  remove(userId: string): void {
    const conn = this.connections.get(userId);
    if (!conn) return;

    if (conn.heartbeatTimer) clearTimeout(conn.heartbeatTimer);

    // Unsubscribe from all server topics
    for (const serverId of conn.subscribedServers) {
      const handler = (conn as any)[`_handler_server:${serverId}`];
      if (handler) {
        this.pubsub.unsubscribe(`server:${serverId}`, handler);
      }
    }

    this.connections.delete(userId);
  }

  get(userId: string): Connection | undefined {
    return this.connections.get(userId);
  }

  sendTo(userId: string, message: unknown): void {
    const conn = this.connections.get(userId);
    if (conn && conn.socket.readyState === conn.socket.OPEN) {
      conn.socket.send(JSON.stringify(message));
    }
  }

  addServerSubscription(userId: string, serverId: string): void {
    const conn = this.connections.get(userId);
    if (!conn || conn.subscribedServers.has(serverId)) return;

    const handler = (message: unknown) => {
      if (conn.socket.readyState === conn.socket.OPEN) {
        conn.socket.send(JSON.stringify(message));
      }
    };
    this.pubsub.subscribe(`server:${serverId}`, handler);
    conn.subscribedServers.add(serverId);
    (conn as any)[`_handler_server:${serverId}`] = handler;
  }

  removeServerSubscription(userId: string, serverId: string): void {
    const conn = this.connections.get(userId);
    if (!conn || !conn.subscribedServers.has(serverId)) return;

    const handler = (conn as any)[`_handler_server:${serverId}`];
    if (handler) {
      this.pubsub.unsubscribe(`server:${serverId}`, handler);
      delete (conn as any)[`_handler_server:${serverId}`];
    }
    conn.subscribedServers.delete(serverId);
  }

  broadcastToServer(serverId: string, message: unknown): void {
    this.pubsub.publish(`server:${serverId}`, message);
  }
}
