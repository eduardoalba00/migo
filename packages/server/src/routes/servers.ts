import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { SERVER_ROUTES, createServerSchema, updateServerSchema } from "@migo/shared";
import type { AppDatabase } from "../db/index.js";
import { users } from "../db/schema/users.js";
import { servers, serverMembers } from "../db/schema/servers.js";
import { channels } from "../db/schema/channels.js";
import { bans } from "../db/schema/bans.js";
import { roles } from "../db/schema/roles.js";
import { Permission } from "@migo/shared";
import type { AuthService } from "../services/auth.js";
import type { ServerService } from "../services/server.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { fastifyRoute } from "../lib/route-utils.js";
import type { PubSub } from "../ws/pubsub.js";
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

export function serverRoutes(
  db: AppDatabase,
  authService: AuthService,
  serverService: ServerService,
  pubsub: PubSub,
  connectionManager: ConnectionManager,
) {
  return async function (app: FastifyInstance) {
    const requireAuth = createAuthMiddleware(authService);

    // POST /api/servers — create server
    app.post(fastifyRoute(SERVER_ROUTES.CREATE), { preHandler: requireAuth }, async (request, reply) => {
      const parsed = createServerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation failed", issues: parsed.error.issues });
      }

      const serverId = crypto.randomUUID();
      const now = new Date();

      await db.insert(servers).values({
        id: serverId,
        name: parsed.data.name,
        ownerId: request.user.sub,
        createdAt: now,
        updatedAt: now,
      });

      // Auto-add creator as member
      await db.insert(serverMembers).values({
        id: crypto.randomUUID(),
        serverId,
        userId: request.user.sub,
        joinedAt: now,
      });

      // Auto-create "general" text channel
      await db.insert(channels).values({
        id: crypto.randomUUID(),
        serverId,
        name: "general",
        type: "text",
        position: 0,
      });

      // Auto-create @everyone default role
      await db.insert(roles).values({
        id: crypto.randomUUID(),
        serverId,
        name: "@everyone",
        position: 0,
        permissions: Permission.SEND_MESSAGES,
        isDefault: true,
        createdAt: now,
      });

      const server = (await db.select().from(servers).where(eq(servers.id, serverId)).then(r => r[0]))!;

      return reply.status(201).send({
        id: server.id,
        name: server.name,
        iconUrl: server.iconUrl,
        ownerId: server.ownerId,
        createdAt: server.createdAt.toISOString(),
        updatedAt: server.updatedAt.toISOString(),
      });
    });

    // GET /api/servers — list user's servers
    app.get(fastifyRoute(SERVER_ROUTES.LIST), { preHandler: requireAuth }, async (request, reply) => {
      const memberships = await db
        .select()
        .from(serverMembers)
        .innerJoin(servers, eq(serverMembers.serverId, servers.id))
        .where(eq(serverMembers.userId, request.user.sub))
        ;

      const result = memberships.map((row) => ({
        id: row.servers.id,
        name: row.servers.name,
        iconUrl: row.servers.iconUrl,
        ownerId: row.servers.ownerId,
        createdAt: row.servers.createdAt.toISOString(),
        updatedAt: row.servers.updatedAt.toISOString(),
      }));

      return reply.send(result);
    });

    // GET /api/servers/:serverId
    app.get(fastifyRoute(SERVER_ROUTES.GET), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const isMember = await serverService.isMember(serverId, request.user.sub);
      if (!isMember) {
        return reply.status(403).send({ error: "Not a member of this server" });
      }

      const server = await serverService.getServerOrNull(serverId);
      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      return reply.send({
        id: server.id,
        name: server.name,
        iconUrl: server.iconUrl,
        ownerId: server.ownerId,
        createdAt: server.createdAt.toISOString(),
        updatedAt: server.updatedAt.toISOString(),
      });
    });

    // PATCH /api/servers/:serverId — update (owner only)
    app.patch(fastifyRoute(SERVER_ROUTES.UPDATE), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const isOwner = await serverService.isOwner(serverId, request.user.sub);
      if (!isOwner) {
        return reply.status(403).send({ error: "Only the server owner can update the server" });
      }

      const parsed = updateServerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation failed", issues: parsed.error.issues });
      }

      await db
        .update(servers)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(servers.id, serverId))
        ;

      const server = (await db.select().from(servers).where(eq(servers.id, serverId)).then(r => r[0]))!;

      return reply.send({
        id: server.id,
        name: server.name,
        iconUrl: server.iconUrl,
        ownerId: server.ownerId,
        createdAt: server.createdAt.toISOString(),
        updatedAt: server.updatedAt.toISOString(),
      });
    });

    // DELETE /api/servers/:serverId — delete (owner only)
    app.delete(fastifyRoute(SERVER_ROUTES.DELETE), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const isOwner = await serverService.isOwner(serverId, request.user.sub);
      if (!isOwner) {
        return reply.status(403).send({ error: "Only the server owner can delete the server" });
      }

      await db.delete(servers).where(eq(servers.id, serverId));

      return reply.status(204).send();
    });

    // GET /api/servers/:serverId/members
    app.get(fastifyRoute(SERVER_ROUTES.MEMBERS), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const isMember = await serverService.isMember(serverId, request.user.sub);
      if (!isMember) {
        return reply.status(403).send({ error: "Not a member of this server" });
      }

      const members = await db
        .select()
        .from(serverMembers)
        .innerJoin(users, eq(serverMembers.userId, users.id))
        .where(eq(serverMembers.serverId, serverId))
        ;

      const result = members.map((row) => ({
        id: row.server_members.id,
        serverId: row.server_members.serverId,
        userId: row.server_members.userId,
        user: userToPublic(row.users),
        joinedAt: row.server_members.joinedAt.toISOString(),
      }));

      return reply.send(result);
    });

    // DELETE /api/servers/:serverId/members/me — leave server
    app.delete(fastifyRoute(SERVER_ROUTES.LEAVE), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const isOwner = await serverService.isOwner(serverId, request.user.sub);
      if (isOwner) {
        return reply.status(400).send({ error: "Server owner cannot leave. Transfer ownership or delete the server." });
      }

      const member = await db
        .select()
        .from(serverMembers)
        .where(
          and(
            eq(serverMembers.serverId, serverId),
            eq(serverMembers.userId, request.user.sub),
          ),
        )
        .then(r => r[0]);

      if (!member) {
        return reply.status(404).send({ error: "Not a member of this server" });
      }

      await db
        .delete(serverMembers)
        .where(eq(serverMembers.id, member.id))
        ;

      connectionManager.removeServerSubscription(request.user.sub, serverId);

      pubsub.publish(`server:${serverId}`, {
        op: 0,
        t: "MEMBER_LEAVE",
        d: { userId: request.user.sub, serverId },
      });

      return reply.status(204).send();
    });

    // DELETE /api/servers/:serverId/members/:userId — kick member (owner only)
    app.delete(fastifyRoute(SERVER_ROUTES.KICK_MEMBER), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId, userId } = request.params as { serverId: string; userId: string };

      const isOwner = await serverService.isOwner(serverId, request.user.sub);
      if (!isOwner) {
        return reply.status(403).send({ error: "Only the server owner can kick members" });
      }

      if (userId === request.user.sub) {
        return reply.status(400).send({ error: "Cannot kick yourself" });
      }

      const member = await db
        .select()
        .from(serverMembers)
        .where(
          and(
            eq(serverMembers.serverId, serverId),
            eq(serverMembers.userId, userId),
          ),
        )
        .then(r => r[0]);

      if (!member) {
        return reply.status(404).send({ error: "Member not found" });
      }

      await db
        .delete(serverMembers)
        .where(eq(serverMembers.id, member.id))
        ;

      connectionManager.removeServerSubscription(userId, serverId);

      pubsub.publish(`server:${serverId}`, {
        op: 0,
        t: "MEMBER_LEAVE",
        d: { userId, serverId },
      });

      return reply.status(204).send();
    });

    // PUT /api/servers/:serverId/bans/:userId — ban member (owner only)
    app.put(fastifyRoute(SERVER_ROUTES.BAN_CREATE), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId, userId } = request.params as { serverId: string; userId: string };

      const isOwner = await serverService.isOwner(serverId, request.user.sub);
      if (!isOwner) {
        return reply.status(403).send({ error: "Only the server owner can ban members" });
      }

      if (userId === request.user.sub) {
        return reply.status(400).send({ error: "Cannot ban yourself" });
      }

      const body = request.body as { reason?: string } | undefined;

      // Remove from server
      await db
        .delete(serverMembers)
        .where(
          and(
            eq(serverMembers.serverId, serverId),
            eq(serverMembers.userId, userId),
          ),
        )
        ;

      connectionManager.removeServerSubscription(userId, serverId);

      // Create ban record
      await db.insert(bans).values({
        id: crypto.randomUUID(),
        serverId,
        userId,
        reason: body?.reason || null,
        bannedBy: request.user.sub,
        createdAt: new Date(),
      });

      pubsub.publish(`server:${serverId}`, {
        op: 0,
        t: "MEMBER_LEAVE",
        d: { userId, serverId },
      });

      return reply.status(204).send();
    });

    // DELETE /api/servers/:serverId/bans/:userId — unban (owner only)
    app.delete(fastifyRoute(SERVER_ROUTES.BAN_DELETE), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId, userId } = request.params as { serverId: string; userId: string };

      const isOwner = await serverService.isOwner(serverId, request.user.sub);
      if (!isOwner) {
        return reply.status(403).send({ error: "Only the server owner can unban members" });
      }

      await db
        .delete(bans)
        .where(and(eq(bans.serverId, serverId), eq(bans.userId, userId)))
        ;

      return reply.status(204).send();
    });

    // GET /api/servers/:serverId/bans — list bans (owner only)
    app.get(fastifyRoute(SERVER_ROUTES.BANS_LIST), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const isOwner = await serverService.isOwner(serverId, request.user.sub);
      if (!isOwner) {
        return reply.status(403).send({ error: "Only the server owner can view bans" });
      }

      const allBans = await db
        .select()
        .from(bans)
        .innerJoin(users, eq(bans.userId, users.id))
        .where(eq(bans.serverId, serverId))
        ;

      return reply.send(
        allBans.map((row) => ({
          id: row.bans.id,
          userId: row.bans.userId,
          user: userToPublic(row.users),
          reason: row.bans.reason,
          createdAt: row.bans.createdAt.toISOString(),
        })),
      );
    });
  };
}
