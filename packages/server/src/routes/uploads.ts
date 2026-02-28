import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { UPLOAD_ROUTES } from "@migo/shared";
import type { AppDatabase } from "../db/index.js";
import type { AuthService } from "../services/auth.js";
import type { Config } from "../config.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { attachments } from "../db/schema/attachments.js";
import { fastifyRoute } from "../lib/route-utils.js";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

const MAX_FILE_SIZE_MB = 50;
const MAX_SOUND_SIZE_MB = 2;

export function uploadRoutes(
  db: AppDatabase,
  authService: AuthService,
  config: Config,
) {
  return async function (app: FastifyInstance) {
    const requireAuth = createAuthMiddleware(authService);

    // Ensure upload directories exist
    const dirs = ["avatars", "icons", "attachments", "sounds"];
    for (const dir of dirs) {
      const fullPath = path.join(config.uploadDir, dir);
      fs.mkdirSync(fullPath, { recursive: true });
    }

    // POST /api/upload — upload a file
    app.post(fastifyRoute(UPLOAD_ROUTES.UPLOAD), { preHandler: requireAuth }, async (request, reply) => {
      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ error: "No file uploaded" });
      }

      // Read file into buffer
      const chunks: Buffer[] = [];
      const maxBytes = MAX_FILE_SIZE_MB * 1024 * 1024;
      let totalSize = 0;

      for await (const chunk of file.file) {
        totalSize += chunk.length;
        if (totalSize > maxBytes) {
          return reply.status(413).send({ error: `File too large (max ${MAX_FILE_SIZE_MB}MB)` });
        }
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);

      // Determine subfolder based on field name or default to attachments
      const subfolder = file.fieldname === "avatar"
        ? "avatars"
        : file.fieldname === "icon"
          ? "icons"
          : file.fieldname === "sound"
            ? "sounds"
            : "attachments";

      // Enforce stricter size limit for sounds
      if (subfolder === "sounds") {
        const maxSoundBytes = MAX_SOUND_SIZE_MB * 1024 * 1024;
        if (buffer.length > maxSoundBytes) {
          return reply.status(413).send({ error: `Sound file too large (max ${MAX_SOUND_SIZE_MB}MB)` });
        }
        const audioMimeTypes = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/webm", "audio/mp4", "audio/x-wav"];
        if (!audioMimeTypes.includes(file.mimetype)) {
          return reply.status(400).send({ error: "Sound must be an audio file (mp3, wav, ogg, webm)" });
        }
      }

      const ext = path.extname(file.filename) || "";
      const uniqueName = `${crypto.randomUUID()}${ext}`;
      const filePath = path.join(config.uploadDir, subfolder, uniqueName);
      const url = `/uploads/${subfolder}/${uniqueName}`;

      await fsPromises.writeFile(filePath, buffer);

      // If it's an attachment, create a pending attachment record
      if (subfolder === "attachments") {
        const id = crypto.randomUUID();
        await db.insert(attachments).values({
          id,
          messageId: null,
          filename: uniqueName,
          originalName: file.filename,
          mimeType: file.mimetype,
          size: buffer.length,
          url,
          createdAt: new Date(),
        });

        return reply.status(201).send({ id, url, filename: uniqueName, originalName: file.filename, mimeType: file.mimetype, size: buffer.length });
      }

      return reply.status(201).send({ url, filename: uniqueName, originalName: file.filename, mimeType: file.mimetype, size: buffer.length });
    });
  };
}
