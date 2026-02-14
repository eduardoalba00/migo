import type { FastifyInstance } from "fastify";
import { eq, and, like } from "drizzle-orm";
import { SEARCH_ROUTES } from "@migo/shared";
import type { AppDatabase } from "../db/index.js";
import { messages } from "../db/schema/messages.js";
import { channels } from "../db/schema/channels.js";
import { users } from "../db/schema/users.js";
import type { AuthService } from "../services/auth.js";
import type { ServerService } from "../services/server.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { fastifyRoute } from "../lib/route-utils.js";

function userToPublic(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    status: user.status,
    customStatus: user.customStatus,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function searchRoutes(
  db: AppDatabase,
  authService: AuthService,
  serverService: ServerService,
) {
  return async function (app: FastifyInstance) {
    const requireAuth = createAuthMiddleware(authService);

    // GET /api/servers/:serverId/search?q=query
    app.get(fastifyRoute(SEARCH_ROUTES.SEARCH), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId } = request.params as { serverId: string };
      const query = request.query as { q?: string; limit?: string };

      const isMember = await serverService.isMember(serverId, request.user.sub);
      if (!isMember) {
        return reply.status(403).send({ error: "Not a member of this server" });
      }

      if (!query.q?.trim()) {
        return reply.status(400).send({ error: "Search query is required" });
      }

      const limit = Math.min(parseInt(query.limit || "25", 10), 50);
      const searchTerm = `%${query.q.trim()}%`;

      // Get all channel IDs in this server
      const serverChannels = await db
        .select()
        .from(channels)
        .where(eq(channels.serverId, serverId))
        ;
      const channelIds = serverChannels.map((c) => c.id);

      if (channelIds.length === 0) {
        return reply.send([]);
      }

      // Search messages using LIKE (for servers with moderate message count)
      const results = [];
      for (const chId of channelIds) {
        const msgs = await db
          .select()
          .from(messages)
          .innerJoin(users, eq(messages.authorId, users.id))
          .where(and(eq(messages.channelId, chId), like(messages.content, searchTerm)))
          .limit(limit)
          ;
        for (const row of msgs) {
          results.push({
            id: row.messages.id,
            channelId: row.messages.channelId,
            author: userToPublic(row.users),
            content: row.messages.content,
            createdAt: row.messages.createdAt.toISOString(),
          });
        }
        if (results.length >= limit) break;
      }

      // Sort by createdAt descending and limit
      results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return reply.send(results.slice(0, limit));
    });
  };
}
