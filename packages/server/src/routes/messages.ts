import type { FastifyInstance } from "fastify";
import { eq, and, lt, desc, sql, isNull } from "drizzle-orm";
import { MESSAGE_ROUTES, sendMessageSchema, editMessageSchema, getMessagesSchema } from "@migo/shared";
import type { AppDatabase } from "../db/index.js";
import { messages } from "../db/schema/messages.js";
import { channels } from "../db/schema/channels.js";
import { users } from "../db/schema/users.js";
import { serverMembers } from "../db/schema/servers.js";
import { reactions } from "../db/schema/reactions.js";
import { attachments } from "../db/schema/attachments.js";
import type { AuthService } from "../services/auth.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { fastifyRoute } from "../lib/route-utils.js";
import type { PubSub } from "../ws/pubsub.js";

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

async function getReactionsForMessage(db: AppDatabase, messageId: string, currentUserId: string) {
  const allReactions = await db
    .select()
    .from(reactions)
    .where(eq(reactions.messageId, messageId))
    ;

  const grouped: Record<string, { count: number; me: boolean }> = {};
  for (const r of allReactions) {
    if (!grouped[r.emoji]) grouped[r.emoji] = { count: 0, me: false };
    grouped[r.emoji].count++;
    if (r.userId === currentUserId) grouped[r.emoji].me = true;
  }

  return Object.entries(grouped).map(([emoji, { count, me }]) => ({ emoji, count, me }));
}

async function getAttachmentsForMessage(db: AppDatabase, messageId: string) {
  const rows = await db
    .select()
    .from(attachments)
    .where(eq(attachments.messageId, messageId))
    ;

  return rows.map((a) => ({
    id: a.id,
    filename: a.filename,
    originalName: a.originalName,
    mimeType: a.mimeType,
    size: a.size,
    url: a.url,
  }));
}

async function getReplyRef(db: AppDatabase, replyToId: string | null) {
  if (!replyToId) return null;
  const row = await db
    .select()
    .from(messages)
    .innerJoin(users, eq(messages.authorId, users.id))
    .where(eq(messages.id, replyToId))
    .then(r => r[0]);

  if (!row) return null;
  return {
    id: row.messages.id,
    author: userToPublic(row.users),
    content: row.messages.content.length > 200
      ? row.messages.content.slice(0, 200) + "..."
      : row.messages.content,
  };
}

export function messageRoutes(
  db: AppDatabase,
  authService: AuthService,
  pubsub: PubSub,
) {
  return async function (app: FastifyInstance) {
    const requireAuth = createAuthMiddleware(authService);

    // Helper: get channel and verify membership
    async function getChannelAndVerify(channelId: string, userId: string) {
      const channel = await db
        .select()
        .from(channels)
        .where(eq(channels.id, channelId))
        .then(r => r[0]);

      if (!channel) return { error: "Channel not found", status: 404, channel: null };

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

      if (!member) return { error: "Not a member of this server", status: 403, channel: null };

      return { error: null, status: 200, channel };
    }

    // POST /api/channels/:channelId/messages — send message
    app.post(fastifyRoute(MESSAGE_ROUTES.CREATE), { preHandler: requireAuth }, async (request, reply) => {
      const { channelId } = request.params as { channelId: string };

      const { error, status, channel } = await getChannelAndVerify(channelId, request.user.sub);
      if (error) return reply.status(status).send({ error });

      const parsed = sendMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation failed", issues: parsed.error.issues });
      }

      const id = crypto.randomUUID();
      const now = new Date();

      await db.insert(messages).values({
        id,
        channelId,
        authorId: request.user.sub,
        content: parsed.data.content,
        replyToId: parsed.data.replyToId ?? null,
        createdAt: now,
      });

      // Link attachments if provided
      if (parsed.data.attachmentIds?.length) {
        for (const attachmentId of parsed.data.attachmentIds) {
          await db
            .update(attachments)
            .set({ messageId: id })
            .where(and(eq(attachments.id, attachmentId), isNull(attachments.messageId)))
            ;
        }
      }

      const author = (await db.select().from(users).where(eq(users.id, request.user.sub)).then(r => r[0]))!;
      const replyTo = await getReplyRef(db, parsed.data.replyToId ?? null);
      const messageAttachments = await getAttachmentsForMessage(db, id);

      const messageData = {
        id,
        channelId,
        author: userToPublic(author),
        content: parsed.data.content,
        editedAt: null,
        createdAt: now.toISOString(),
        replyTo,
        reactions: [],
        attachments: messageAttachments,
        pinnedAt: null,
      };

      pubsub.publish(`server:${channel!.serverId}`, {
        op: 0,
        t: "MESSAGE_CREATE",
        d: messageData,
      });

      return reply.status(201).send(messageData);
    });

    // GET /api/channels/:channelId/messages — list messages (cursor pagination)
    app.get(fastifyRoute(MESSAGE_ROUTES.LIST), { preHandler: requireAuth }, async (request, reply) => {
      const { channelId } = request.params as { channelId: string };

      const { error, status } = await getChannelAndVerify(channelId, request.user.sub);
      if (error) return reply.status(status).send({ error });

      const parsed = getMessagesSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation failed", issues: parsed.error.issues });
      }

      const { before, limit } = parsed.data;

      let query = db
        .select()
        .from(messages)
        .innerJoin(users, eq(messages.authorId, users.id))
        .where(
          before
            ? and(eq(messages.channelId, channelId), lt(messages.id, before))
            : eq(messages.channelId, channelId),
        )
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(limit);

      const rows = await query;
      const reversed = rows.reverse();

      const result = await Promise.all(
        reversed.map(async (row) => {
          const replyTo = await getReplyRef(db, row.messages.replyToId);
          const messageReactions = await getReactionsForMessage(db, row.messages.id, request.user.sub);
          const messageAttachments = await getAttachmentsForMessage(db, row.messages.id);

          return {
            id: row.messages.id,
            channelId: row.messages.channelId,
            author: userToPublic(row.users),
            content: row.messages.content,
            editedAt: row.messages.editedAt?.toISOString() ?? null,
            createdAt: row.messages.createdAt.toISOString(),
            replyTo,
            reactions: messageReactions,
            attachments: messageAttachments,
            pinnedAt: row.messages.pinnedAt?.toISOString() ?? null,
          };
        }),
      );

      return reply.send(result);
    });

    // PATCH /api/channels/:channelId/messages/:messageId — edit message (author only)
    app.patch(fastifyRoute(MESSAGE_ROUTES.UPDATE), { preHandler: requireAuth }, async (request, reply) => {
      const { channelId, messageId } = request.params as { channelId: string; messageId: string };

      const { error, status, channel } = await getChannelAndVerify(channelId, request.user.sub);
      if (error) return reply.status(status).send({ error });

      const message = await db
        .select()
        .from(messages)
        .where(and(eq(messages.id, messageId), eq(messages.channelId, channelId)))
        .then(r => r[0]);

      if (!message) {
        return reply.status(404).send({ error: "Message not found" });
      }

      if (message.authorId !== request.user.sub) {
        return reply.status(403).send({ error: "You can only edit your own messages" });
      }

      const parsed = editMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation failed", issues: parsed.error.issues });
      }

      const now = new Date();
      await db
        .update(messages)
        .set({ content: parsed.data.content, editedAt: now })
        .where(eq(messages.id, messageId))
        ;

      const author = (await db.select().from(users).where(eq(users.id, request.user.sub)).then(r => r[0]))!;
      const replyTo = await getReplyRef(db, message.replyToId);
      const messageReactions = await getReactionsForMessage(db, messageId, request.user.sub);
      const messageAttachments = await getAttachmentsForMessage(db, messageId);

      const messageData = {
        id: messageId,
        channelId,
        author: userToPublic(author),
        content: parsed.data.content,
        editedAt: now.toISOString(),
        createdAt: message.createdAt.toISOString(),
        replyTo,
        reactions: messageReactions,
        attachments: messageAttachments,
        pinnedAt: message.pinnedAt?.toISOString() ?? null,
      };

      pubsub.publish(`server:${channel!.serverId}`, {
        op: 0,
        t: "MESSAGE_UPDATE",
        d: messageData,
      });

      return reply.send(messageData);
    });

    // DELETE /api/channels/:channelId/messages/:messageId — delete (author or server owner)
    app.delete(fastifyRoute(MESSAGE_ROUTES.DELETE), { preHandler: requireAuth }, async (request, reply) => {
      const { channelId, messageId } = request.params as { channelId: string; messageId: string };

      const { error, status, channel } = await getChannelAndVerify(channelId, request.user.sub);
      if (error) return reply.status(status).send({ error });

      const message = await db
        .select()
        .from(messages)
        .where(and(eq(messages.id, messageId), eq(messages.channelId, channelId)))
        .then(r => r[0]);

      if (!message) {
        return reply.status(404).send({ error: "Message not found" });
      }

      if (message.authorId !== request.user.sub) {
        const { servers } = await import("../db/schema/servers.js");
        const srv = await db
          .select()
          .from(servers)
          .where(eq(servers.id, channel!.serverId))
          .then(r => r[0]);
        if (!srv || srv.ownerId !== request.user.sub) {
          return reply.status(403).send({ error: "You can only delete your own messages" });
        }
      }

      await db.delete(messages).where(eq(messages.id, messageId));

      pubsub.publish(`server:${channel!.serverId}`, {
        op: 0,
        t: "MESSAGE_DELETE",
        d: { id: messageId, channelId },
      });

      return reply.status(204).send();
    });

    // PUT /api/channels/:channelId/messages/:messageId/reactions/:emoji — add reaction
    app.put(fastifyRoute(MESSAGE_ROUTES.REACTION_PUT), { preHandler: requireAuth }, async (request, reply) => {
      const { channelId, messageId, emoji } = request.params as { channelId: string; messageId: string; emoji: string };

      const { error, status, channel } = await getChannelAndVerify(channelId, request.user.sub);
      if (error) return reply.status(status).send({ error });

      const message = await db
        .select()
        .from(messages)
        .where(and(eq(messages.id, messageId), eq(messages.channelId, channelId)))
        .then(r => r[0]);
      if (!message) return reply.status(404).send({ error: "Message not found" });

      // Check if already reacted with this emoji
      const existing = await db
        .select()
        .from(reactions)
        .where(
          and(
            eq(reactions.messageId, messageId),
            eq(reactions.userId, request.user.sub),
            eq(reactions.emoji, decodeURIComponent(emoji)),
          ),
        )
        .then(r => r[0]);

      if (existing) {
        return reply.status(204).send();
      }

      await db.insert(reactions).values({
        id: crypto.randomUUID(),
        messageId,
        userId: request.user.sub,
        emoji: decodeURIComponent(emoji),
        createdAt: new Date(),
      });

      pubsub.publish(`server:${channel!.serverId}`, {
        op: 0,
        t: "REACTION_ADD",
        d: { messageId, channelId, userId: request.user.sub, emoji: decodeURIComponent(emoji) },
      });

      return reply.status(204).send();
    });

    // DELETE /api/channels/:channelId/messages/:messageId/reactions/:emoji — remove reaction
    app.delete(fastifyRoute(MESSAGE_ROUTES.REACTION_DELETE), { preHandler: requireAuth }, async (request, reply) => {
      const { channelId, messageId, emoji } = request.params as { channelId: string; messageId: string; emoji: string };

      const { error, status, channel } = await getChannelAndVerify(channelId, request.user.sub);
      if (error) return reply.status(status).send({ error });

      await db
        .delete(reactions)
        .where(
          and(
            eq(reactions.messageId, messageId),
            eq(reactions.userId, request.user.sub),
            eq(reactions.emoji, decodeURIComponent(emoji)),
          ),
        )
        ;

      pubsub.publish(`server:${channel!.serverId}`, {
        op: 0,
        t: "REACTION_REMOVE",
        d: { messageId, channelId, userId: request.user.sub, emoji: decodeURIComponent(emoji) },
      });

      return reply.status(204).send();
    });

    // PUT /api/channels/:channelId/messages/:messageId/pin — pin message
    app.put(fastifyRoute(MESSAGE_ROUTES.PIN), { preHandler: requireAuth }, async (request, reply) => {
      const { channelId, messageId } = request.params as { channelId: string; messageId: string };

      const { error, status, channel } = await getChannelAndVerify(channelId, request.user.sub);
      if (error) return reply.status(status).send({ error });

      const message = await db
        .select()
        .from(messages)
        .where(and(eq(messages.id, messageId), eq(messages.channelId, channelId)))
        .then(r => r[0]);
      if (!message) return reply.status(404).send({ error: "Message not found" });

      const now = new Date();
      await db
        .update(messages)
        .set({ pinnedAt: now, pinnedBy: request.user.sub })
        .where(eq(messages.id, messageId))
        ;

      pubsub.publish(`server:${channel!.serverId}`, {
        op: 0,
        t: "MESSAGE_PIN",
        d: { messageId, channelId },
      });

      return reply.status(204).send();
    });

    // DELETE /api/channels/:channelId/messages/:messageId/pin — unpin message
    app.delete(fastifyRoute(MESSAGE_ROUTES.UNPIN), { preHandler: requireAuth }, async (request, reply) => {
      const { channelId, messageId } = request.params as { channelId: string; messageId: string };

      const { error, status, channel } = await getChannelAndVerify(channelId, request.user.sub);
      if (error) return reply.status(status).send({ error });

      await db
        .update(messages)
        .set({ pinnedAt: null, pinnedBy: null })
        .where(and(eq(messages.id, messageId), eq(messages.channelId, channelId)))
        ;

      pubsub.publish(`server:${channel!.serverId}`, {
        op: 0,
        t: "MESSAGE_UNPIN",
        d: { messageId, channelId },
      });

      return reply.status(204).send();
    });

    // GET /api/channels/:channelId/pins — list pinned messages
    app.get(fastifyRoute(MESSAGE_ROUTES.PINS_LIST), { preHandler: requireAuth }, async (request, reply) => {
      const { channelId } = request.params as { channelId: string };

      const { error, status } = await getChannelAndVerify(channelId, request.user.sub);
      if (error) return reply.status(status).send({ error });

      const rows = await db
        .select()
        .from(messages)
        .innerJoin(users, eq(messages.authorId, users.id))
        .where(and(eq(messages.channelId, channelId), sql`${messages.pinnedAt} IS NOT NULL`))
        .orderBy(desc(messages.pinnedAt))
        ;

      const result = await Promise.all(
        rows.map(async (row) => {
          const replyTo = await getReplyRef(db, row.messages.replyToId);
          const messageReactions = await getReactionsForMessage(db, row.messages.id, request.user.sub);
          const messageAttachments = await getAttachmentsForMessage(db, row.messages.id);

          return {
            id: row.messages.id,
            channelId: row.messages.channelId,
            author: userToPublic(row.users),
            content: row.messages.content,
            editedAt: row.messages.editedAt?.toISOString() ?? null,
            createdAt: row.messages.createdAt.toISOString(),
            replyTo,
            reactions: messageReactions,
            attachments: messageAttachments,
            pinnedAt: row.messages.pinnedAt?.toISOString() ?? null,
          };
        }),
      );

      return reply.send(result);
    });
  };
}
