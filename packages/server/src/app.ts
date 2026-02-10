import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import path from "node:path";
import type { Config } from "./config.js";
import type { AppDatabase } from "./db/index.js";
import { AuthService } from "./services/auth.js";
import { ServerService } from "./services/server.js";
import { authRoutes } from "./routes/auth.js";
import { serverRoutes } from "./routes/servers.js";
import { channelRoutes } from "./routes/channels.js";
import { inviteRoutes } from "./routes/invites.js";
import { messageRoutes } from "./routes/messages.js";
import { uploadRoutes } from "./routes/uploads.js";
import { roleRoutes } from "./routes/roles.js";
import { dmRoutes } from "./routes/dms.js";
import { searchRoutes } from "./routes/search.js";
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
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    allowList: (req) => req.url === "/ws",
  });

  await app.register(multipart, {
    limits: {
      fileSize: config.maxFileSizeMb * 1024 * 1024,
    },
  });

  // Serve uploaded files
  await app.register(fastifyStatic, {
    root: path.resolve(config.uploadDir),
    prefix: "/uploads/",
    decorateReply: false,
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
  await app.register(uploadRoutes(db, authService, config));
  await app.register(roleRoutes(db, authService, serverService));
  await app.register(dmRoutes(db, authService, connectionManager));
  await app.register(searchRoutes(db, authService, serverService));

  return app;
}
