import Fastify from "fastify";
import cors from "@fastify/cors";
import type { Config } from "./config.js";
import type { AppDatabase } from "./db/index.js";
import { AuthService } from "./services/auth.js";
import { ServerService } from "./services/server.js";
import { authRoutes } from "./routes/auth.js";
import { serverRoutes } from "./routes/servers.js";
import { channelRoutes } from "./routes/channels.js";
import { inviteRoutes } from "./routes/invites.js";
import { messageRoutes } from "./routes/messages.js";
import { createWsHandler } from "./ws/handler.js";

export async function buildApp(config: Config, db: AppDatabase) {
  const app = Fastify({
    logger: {
      transport: {
        target: "pino-pretty",
        options: { colorize: true },
      },
    },
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  const authService = new AuthService(config);
  const serverService = new ServerService(db);

  // WebSocket setup
  const { pubsub, connectionManager } = await createWsHandler(app, db, authService, config);

  // Health check
  app.get("/api/health", async () => ({ status: "ok" }));

  // Routes
  await app.register(authRoutes(db, authService));
  await app.register(serverRoutes(db, authService, serverService, pubsub));
  await app.register(channelRoutes(db, authService, serverService, pubsub));
  await app.register(inviteRoutes(db, authService, serverService, pubsub));
  await app.register(messageRoutes(db, authService, pubsub));

  return app;
}
