import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type { AuthService } from "../services/auth.js";
import type { AppDatabase } from "../db/index.js";
import type { Config } from "../config.js";
import { PubSub } from "./pubsub.js";
import { ConnectionManager } from "./connection.js";
import { handleConnection } from "./protocol.js";
import { LiveKitService } from "../voice/livekit.js";
import { VoiceStateManager } from "../voice/state.js";
import { MediasoupManager } from "../screenshare/mediasoup-manager.js";

export async function createWsHandler(
  app: FastifyInstance,
  db: AppDatabase,
  authService: AuthService,
  config: Config,
) {
  const pubsub = new PubSub();
  const connectionManager = new ConnectionManager(pubsub);

  const livekitService = new LiveKitService(config);

  const voiceStateManager = new VoiceStateManager();

  const mediasoupManager = new MediasoupManager(config);
  await mediasoupManager.init();

  await app.register(websocket);

  app.get("/ws", { websocket: true }, (socket) => {
    handleConnection(socket, db, authService, connectionManager, livekitService, voiceStateManager, mediasoupManager);
  });

  return { pubsub, connectionManager };
}
