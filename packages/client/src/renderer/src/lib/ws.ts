import { WsOpcode, PROTOCOL_VERSION } from "@migo/shared";
import type { WsServerMessage, WsDispatch } from "@migo/shared";

export type DispatchHandler = (event: WsDispatch) => void;
export type VoiceSignalHandler = (msg: any) => void;

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private token: string | null = null;
  private wsUrl: string = "ws://localhost:3000/ws";
  private dispatchHandler: DispatchHandler | null = null;
  private voiceSignalHandler: VoiceSignalHandler | null = null;
  private onStatusChange: ((connected: boolean) => void) | null = null;
  private onVersionMismatch: (() => void) | null = null;
  private tokenRefresher: (() => Promise<string | null>) | null = null;
  private intentionalClose = false;

  setUrl(url: string) {
    this.wsUrl = url;
  }

  connect(token: string) {
    this.token = token;
    this.intentionalClose = false;

    // Already connected — just update the stored token for future reconnects
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    this.reconnectAttempts = 0;
    this.doConnect();
  }

  disconnect() {
    this.intentionalClose = true;
    this.cleanup();
  }

  setDispatchHandler(handler: DispatchHandler) {
    this.dispatchHandler = handler;
  }

  setStatusChangeHandler(handler: (connected: boolean) => void) {
    this.onStatusChange = handler;
  }

  setVoiceSignalHandler(handler: VoiceSignalHandler) {
    this.voiceSignalHandler = handler;
  }

  setVersionMismatchHandler(handler: () => void) {
    this.onVersionMismatch = handler;
  }

  /** Register a callback that refreshes auth and returns the new access token (or null on failure) */
  setTokenRefresher(handler: () => Promise<string | null>) {
    this.tokenRefresher = handler;
  }

  send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private doConnect() {
    if (!this.token) return;

    this.cleanup();

    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      // Send Identify
      this.ws!.send(
        JSON.stringify({
          op: WsOpcode.IDENTIFY,
          d: { token: this.token, version: PROTOCOL_VERSION },
        }),
      );
    };

    this.ws.onmessage = (event) => {
      let msg: WsServerMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if ((msg as any).op === WsOpcode.READY) {
        const { heartbeatInterval } = (msg as any).d;

        this.startHeartbeat(heartbeatInterval);
        this.reconnectAttempts = 0;
        this.onStatusChange?.(true);
        return;
      }

      if ((msg as any).op === WsOpcode.HEARTBEAT_ACK) {
        return;
      }

      if ((msg as any).op === WsOpcode.DISPATCH) {
        this.dispatchHandler?.(msg as WsDispatch);
        return;
      }

      if ((msg as any).op === WsOpcode.VOICE_SIGNAL) {
        this.voiceSignalHandler?.(msg);
        return;
      }
    };

    this.ws.onclose = (event) => {
      this.onStatusChange?.(false);
      this.stopHeartbeat();

      if (event.code === 4010) {
        this.onVersionMismatch?.();
        return;
      }

      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };
  }

  private startHeartbeat(intervalMs: number) {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            op: WsOpcode.HEARTBEAT,
            d: null,
          }),
        );
      }
    }, intervalMs);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts++;

    this.reconnectTimeout = setTimeout(async () => {
      // Refresh token before reconnecting so we don't send an expired one
      if (this.tokenRefresher) {
        const newToken = await this.tokenRefresher();
        if (newToken) {
          this.token = newToken;
        } else {
          // Refresh failed (user logged out) — stop reconnecting
          return;
        }
      }
      this.doConnect();
    }, delay);
  }

  private cleanup() {
    this.stopHeartbeat();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }
}

export const wsManager = new WebSocketManager();
