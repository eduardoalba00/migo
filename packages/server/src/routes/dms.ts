import type { FastifyInstance } from "fastify";
import { eq, and, desc } from "drizzle-orm";
import { DM_ROUTES } from "@migo/shared";
import type { AppDatabase } from "../db/index.js";
import { dmChannels, dmMembers } from "../db/schema/dm-channels.js";
import { users } from "../db/schema/users.js";
import { messages } from "../db/schema/messages.js";
import type { AuthService } from "../services/auth.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { fastifyRoute } from "../lib/route-utils.js";
import type { ConnectionManager } from "../ws/connection.js";

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

export function dmRoutes(
  db: AppDatabase,
  authService: AuthService,
  connectionManager: ConnectionManager,
) {
  return async function (app: FastifyInstance) {
    const requireAuth = createAuthMiddleware(authService);

    // GET /api/dms — list DM channels
    app.get(fastifyRoute(DM_ROUTES.LIST), { preHandler: requireAuth }, async (request, reply) => {
      const myDms = await db
        .select()
        .from(dmMembers)
        .innerJoin(dmChannels, eq(dmMembers.channelId, dmChannels.id))
        .where(eq(dmMembers.userId, request.user.sub))
        ;

      const result = [];
      for (const row of myDms) {
        // Get all members of this DM channel (excluding current user)
        const members = await db
          .select()
          .from(dmMembers)
          .innerJoin(users, eq(dmMembers.userId, users.id))
          .where(and(eq(dmMembers.channelId, row.dm_channels.id)))
          ;

        const recipients = members
          .filter((m) => m.dm_members.userId !== request.user.sub)
          .map((m) => userToPublic(m.users));

        result.push({
          id: row.dm_channels.id,
          recipients,
          lastMessageAt: row.dm_channels.lastMessageAt?.toISOString() ?? null,
          createdAt: row.dm_channels.createdAt.toISOString(),
        });
      }

      // Sort by last message time descending
      result.sort((a, b) => {
        const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return bTime - aTime;
      });

      return reply.send(result);
    });

    // POST /api/dms — create or get existing DM channel
    app.post(fastifyRoute(DM_ROUTES.CREATE), { preHandler: requireAuth }, async (request, reply) => {
      const body = request.body as { recipientId: string };
      if (!body.recipientId) {
        return reply.status(400).send({ error: "recipientId is required" });
      }

      if (body.recipientId === request.user.sub) {
        return reply.status(400).send({ error: "Cannot DM yourself" });
      }

      const recipient = await db.select().from(users).where(eq(users.id, body.recipientId)).then(r => r[0]);
      if (!recipient) {
        return reply.status(404).send({ error: "User not found" });
      }

      // Check if DM channel already exists between these two users
      const myDms = await db
        .select()
        .from(dmMembers)
        .where(eq(dmMembers.userId, request.user.sub))
        ;

      for (const dm of myDms) {
        const otherMember = await db
          .select()
          .from(dmMembers)
          .where(and(eq(dmMembers.channelId, dm.channelId), eq(dmMembers.userId, body.recipientId)))
          .then(r => r[0]);
        if (otherMember) {
          // Existing DM found
          const channel = (await db.select().from(dmChannels).where(eq(dmChannels.id, dm.channelId)).then(r => r[0]))!;
          return reply.send({
            id: channel.id,
            recipients: [userToPublic(recipient)],
            lastMessageAt: channel.lastMessageAt?.toISOString() ?? null,
            createdAt: channel.createdAt.toISOString(),
          });
        }
      }

      // Create new DM channel
      const channelId = crypto.randomUUID();
      const now = new Date();

      await db.insert(dmChannels).values({
        id: channelId,
        createdAt: now,
      });

      await db.insert(dmMembers).values({
        id: crypto.randomUUID(),
        channelId,
        userId: request.user.sub,
      });

      await db.insert(dmMembers).values({
        id: crypto.randomUUID(),
        channelId,
        userId: body.recipientId,
      });

      const currentUser = (await db.select().from(users).where(eq(users.id, request.user.sub)).then(r => r[0]))!;

      // Notify both users via WS
      connectionManager.sendTo(body.recipientId, {
        op: 0,
        t: "DM_CHANNEL_CREATE",
        d: {
          id: channelId,
          recipients: [userToPublic(currentUser)],
          lastMessageAt: null,
          createdAt: now.toISOString(),
        },
      });

      return reply.status(201).send({
        id: channelId,
        recipients: [userToPublic(recipient)],
        lastMessageAt: null,
        createdAt: now.toISOString(),
      });
    });

    // GET /api/dms/:channelId/messages — list DM messages
    app.get(fastifyRoute(DM_ROUTES.MESSAGES_LIST), { preHandler: requireAuth }, async (request, reply) => {
      const { channelId } = request.params as { channelId: string };

      // Verify membership
      const membership = await db
        .select()
        .from(dmMembers)
        .where(and(eq(dmMembers.channelId, channelId), eq(dmMembers.userId, request.user.sub)))
        .then(r => r[0]);
      if (!membership) {
        return reply.status(403).send({ error: "Not a member of this DM" });
      }

      const query = request.query as { before?: string; limit?: string };
      const limit = Math.min(parseInt(query.limit || "50", 10), 100);

      let msgs = await db
        .select()
        .from(messages)
        .innerJoin(users, eq(messages.authorId, users.id))
        .where(eq(messages.channelId, channelId))
        .orderBy(desc(messages.createdAt))
        .limit(limit)
        ;

      if (query.before) {
        const beforeMsg = await db.select().from(messages).where(eq(messages.id, query.before)).then(r => r[0]);
        if (beforeMsg) {
          msgs = msgs.filter((m) => m.messages.createdAt < beforeMsg.createdAt);
        }
      }

      const result = msgs.map((row) => ({
        id: row.messages.id,
        channelId: row.messages.channelId,
        author: userToPublic(row.users),
        content: row.messages.content,
        editedAt: row.messages.editedAt?.toISOString() ?? null,
        createdAt: row.messages.createdAt.toISOString(),
        replyTo: null,
        reactions: [],
        attachments: [],
        pinnedAt: null,
      }));

      return reply.send(result.reverse());
    });

    // POST /api/dms/:channelId/messages — send DM message
    app.post(fastifyRoute(DM_ROUTES.MESSAGES_CREATE), { preHandler: requireAuth }, async (request, reply) => {
      const { channelId } = request.params as { channelId: string };

      // Verify membership
      const membership = await db
        .select()
        .from(dmMembers)
        .where(and(eq(dmMembers.channelId, channelId), eq(dmMembers.userId, request.user.sub)))
        .then(r => r[0]);
      if (!membership) {
        return reply.status(403).send({ error: "Not a member of this DM" });
      }

      const body = request.body as { content: string };
      if (!body.content?.trim()) {
        return reply.status(400).send({ error: "Content is required" });
      }

      const id = crypto.randomUUID();
      const now = new Date();

      await db.insert(messages).values({
        id,
        channelId,
        authorId: request.user.sub,
        content: body.content.trim(),
        createdAt: now,
      });

      // Update last message time
      await db.update(dmChannels).set({ lastMessageAt: now }).where(eq(dmChannels.id, channelId));

      const author = (await db.select().from(users).where(eq(users.id, request.user.sub)).then(r => r[0]))!;

      const message = {
        id,
        channelId,
        author: userToPublic(author),
        content: body.content.trim(),
        editedAt: null,
        createdAt: now.toISOString(),
        replyTo: null,
        reactions: [],
        attachments: [],
        pinnedAt: null,
      };

      // Notify all DM members via WS
      const allMembers = await db
        .select()
        .from(dmMembers)
        .where(eq(dmMembers.channelId, channelId))
        ;

      for (const member of allMembers) {
        connectionManager.sendTo(member.userId, {
          op: 0,
          t: "DM_MESSAGE_CREATE",
          d: message,
        });
      }

      return reply.status(201).send(message);
    });
  };
}
