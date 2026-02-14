import type { FastifyInstance } from "fastify";
import { eq, and, asc, isNull } from "drizzle-orm";
import {
  SERVER_ROUTES,
  READ_STATE_ROUTES,
  createCategorySchema,
  createChannelSchema,
  updateChannelSchema,
} from "@migo/shared";
import type { AppDatabase } from "../db/index.js";
import { categories, channels } from "../db/schema/channels.js";
import { readStates } from "../db/schema/read-states.js";
import type { AuthService } from "../services/auth.js";
import type { ServerService } from "../services/server.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { fastifyRoute } from "../lib/route-utils.js";
import type { PubSub } from "../ws/pubsub.js";

export function channelRoutes(
  db: AppDatabase,
  authService: AuthService,
  serverService: ServerService,
  pubsub: PubSub,
) {
  return async function (app: FastifyInstance) {
    const requireAuth = createAuthMiddleware(authService);

    // POST /api/servers/:serverId/categories — create category (owner)
    app.post(fastifyRoute(SERVER_ROUTES.CATEGORIES_CREATE), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const isOwner = await serverService.isOwner(serverId, request.user.sub);
      if (!isOwner) {
        return reply.status(403).send({ error: "Only the server owner can create categories" });
      }

      const parsed = createCategorySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation failed", issues: parsed.error.issues });
      }

      // Get next position
      const existing = await db
        .select()
        .from(categories)
        .where(eq(categories.serverId, serverId))
        ;

      const id = crypto.randomUUID();
      await db.insert(categories).values({
        id,
        serverId,
        name: parsed.data.name,
        position: existing.length,
      });

      const category = (await db.select().from(categories).where(eq(categories.id, id)).then(r => r[0]))!;

      return reply.status(201).send({
        id: category.id,
        serverId: category.serverId,
        name: category.name,
        position: category.position,
      });
    });

    // DELETE /api/servers/:serverId/categories/:categoryId — delete category (owner)
    app.delete(fastifyRoute(SERVER_ROUTES.CATEGORIES_DELETE), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId, categoryId } = request.params as { serverId: string; categoryId: string };

      const isOwner = await serverService.isOwner(serverId, request.user.sub);
      if (!isOwner) {
        return reply.status(403).send({ error: "Only the server owner can delete categories" });
      }

      const category = await db
        .select()
        .from(categories)
        .where(and(eq(categories.id, categoryId), eq(categories.serverId, serverId)))
        .then(r => r[0]);

      if (!category) {
        return reply.status(404).send({ error: "Category not found" });
      }

      await db.delete(categories).where(eq(categories.id, categoryId));

      return reply.status(204).send();
    });

    // POST /api/servers/:serverId/channels — create channel (owner)
    app.post(fastifyRoute(SERVER_ROUTES.CHANNELS_CREATE), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const isOwner = await serverService.isOwner(serverId, request.user.sub);
      if (!isOwner) {
        return reply.status(403).send({ error: "Only the server owner can create channels" });
      }

      const parsed = createChannelSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation failed", issues: parsed.error.issues });
      }

      // Validate categoryId if provided
      if (parsed.data.categoryId) {
        const cat = await db
          .select()
          .from(categories)
          .where(and(eq(categories.id, parsed.data.categoryId), eq(categories.serverId, serverId)))
          .then(r => r[0]);
        if (!cat) {
          return reply.status(400).send({ error: "Category not found in this server" });
        }
      }

      // Get next position
      const existing = await db
        .select()
        .from(channels)
        .where(eq(channels.serverId, serverId))
        ;

      const id = crypto.randomUUID();
      await db.insert(channels).values({
        id,
        serverId,
        categoryId: parsed.data.categoryId || null,
        name: parsed.data.name,
        type: parsed.data.type || "text",
        topic: parsed.data.topic || null,
        position: existing.length,
      });

      const channel = (await db.select().from(channels).where(eq(channels.id, id)).then(r => r[0]))!;

      const channelData = {
        id: channel.id,
        serverId: channel.serverId,
        categoryId: channel.categoryId,
        name: channel.name,
        type: channel.type,
        topic: channel.topic,
        position: channel.position,
      };

      pubsub.publish(`server:${serverId}`, {
        op: 0,
        t: "CHANNEL_CREATE",
        d: channelData,
      });

      return reply.status(201).send(channelData);
    });

    // GET /api/servers/:serverId/channels — list channels (nested)
    app.get(fastifyRoute(SERVER_ROUTES.CHANNELS_LIST), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const isMember = await serverService.isMember(serverId, request.user.sub);
      if (!isMember) {
        return reply.status(403).send({ error: "Not a member of this server" });
      }

      const allCategories = await db
        .select()
        .from(categories)
        .where(eq(categories.serverId, serverId))
        .orderBy(asc(categories.position))
        ;

      const allChannels = await db
        .select()
        .from(channels)
        .where(eq(channels.serverId, serverId))
        .orderBy(asc(channels.position))
        ;

      const uncategorized = allChannels
        .filter((ch) => !ch.categoryId)
        .map((ch) => ({
          id: ch.id,
          serverId: ch.serverId,
          categoryId: ch.categoryId,
          name: ch.name,
          type: ch.type,
          topic: ch.topic,
          position: ch.position,
        }));

      const categoriesWithChannels = allCategories.map((cat) => ({
        id: cat.id,
        serverId: cat.serverId,
        name: cat.name,
        position: cat.position,
        channels: allChannels
          .filter((ch) => ch.categoryId === cat.id)
          .map((ch) => ({
            id: ch.id,
            serverId: ch.serverId,
            categoryId: ch.categoryId,
            name: ch.name,
            type: ch.type,
            topic: ch.topic,
            position: ch.position,
          })),
      }));

      return reply.send({
        uncategorized,
        categories: categoriesWithChannels,
      });
    });

    // PATCH /api/servers/:serverId/channels/:channelId — update channel (owner)
    app.patch(fastifyRoute(SERVER_ROUTES.CHANNELS_UPDATE), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId, channelId } = request.params as { serverId: string; channelId: string };

      const isOwner = await serverService.isOwner(serverId, request.user.sub);
      if (!isOwner) {
        return reply.status(403).send({ error: "Only the server owner can update channels" });
      }

      const parsed = updateChannelSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation failed", issues: parsed.error.issues });
      }

      const existing = await db
        .select()
        .from(channels)
        .where(and(eq(channels.id, channelId), eq(channels.serverId, serverId)))
        .then(r => r[0]);

      if (!existing) {
        return reply.status(404).send({ error: "Channel not found" });
      }

      await db
        .update(channels)
        .set(parsed.data)
        .where(eq(channels.id, channelId))
        ;

      const channel = (await db.select().from(channels).where(eq(channels.id, channelId)).then(r => r[0]))!;

      const channelData = {
        id: channel.id,
        serverId: channel.serverId,
        categoryId: channel.categoryId,
        name: channel.name,
        type: channel.type,
        topic: channel.topic,
        position: channel.position,
      };

      pubsub.publish(`server:${serverId}`, {
        op: 0,
        t: "CHANNEL_UPDATE",
        d: channelData,
      });

      return reply.send(channelData);
    });

    // DELETE /api/servers/:serverId/channels/:channelId — delete channel (owner)
    app.delete(fastifyRoute(SERVER_ROUTES.CHANNELS_DELETE), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId, channelId } = request.params as { serverId: string; channelId: string };

      const isOwner = await serverService.isOwner(serverId, request.user.sub);
      if (!isOwner) {
        return reply.status(403).send({ error: "Only the server owner can delete channels" });
      }

      const channel = await db
        .select()
        .from(channels)
        .where(and(eq(channels.id, channelId), eq(channels.serverId, serverId)))
        .then(r => r[0]);

      if (!channel) {
        return reply.status(404).send({ error: "Channel not found" });
      }

      await db.delete(channels).where(eq(channels.id, channelId));

      pubsub.publish(`server:${serverId}`, {
        op: 0,
        t: "CHANNEL_DELETE",
        d: { id: channelId, serverId },
      });

      return reply.status(204).send();
    });

    // POST /api/channels/:channelId/ack — mark channel as read
    app.post(fastifyRoute(READ_STATE_ROUTES.ACK), { preHandler: requireAuth }, async (request, reply) => {
      const { channelId } = request.params as { channelId: string };
      const body = request.body as { messageId: string };

      if (!body.messageId) {
        return reply.status(400).send({ error: "messageId is required" });
      }

      const existing = await db
        .select()
        .from(readStates)
        .where(and(eq(readStates.userId, request.user.sub), eq(readStates.channelId, channelId)))
        .then(r => r[0]);

      if (existing) {
        await db
          .update(readStates)
          .set({ lastReadMessageId: body.messageId, mentionCount: 0 })
          .where(eq(readStates.id, existing.id))
          ;
      } else {
        await db.insert(readStates).values({
          id: crypto.randomUUID(),
          userId: request.user.sub,
          channelId,
          lastReadMessageId: body.messageId,
          mentionCount: 0,
        });
      }

      return reply.status(200).send({ ok: true });
    });
  };
}
