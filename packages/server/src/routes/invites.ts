import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import {
  SERVER_ROUTES,
  INVITE_ROUTES,
  createInviteSchema,
  joinServerSchema,
} from "@migo/shared";
import type { AppDatabase } from "../db/index.js";
import { servers, serverMembers } from "../db/schema/servers.js";
import { invites } from "../db/schema/invites.js";
import { bans } from "../db/schema/bans.js";
import { channels } from "../db/schema/channels.js";
import { users } from "../db/schema/users.js";
import type { AuthService } from "../services/auth.js";
import type { ServerService } from "../services/server.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { fastifyRoute } from "../lib/route-utils.js";
import { generateInviteCode } from "../lib/route-utils.js";
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

export function inviteRoutes(
  db: AppDatabase,
  authService: AuthService,
  serverService: ServerService,
  pubsub: PubSub,
) {
  return async function (app: FastifyInstance) {
    const requireAuth = createAuthMiddleware(authService);

    // POST /api/servers/:serverId/invites — create invite (any member)
    app.post(fastifyRoute(SERVER_ROUTES.INVITES_CREATE), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const isMember = await serverService.isMember(serverId, request.user.sub);
      if (!isMember) {
        return reply.status(403).send({ error: "Not a member of this server" });
      }

      const parsed = createInviteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation failed", issues: parsed.error.issues });
      }

      const id = crypto.randomUUID();
      const code = generateInviteCode();
      const now = new Date();
      let expiresAt: Date | null = null;

      if (parsed.data.expiresInHours) {
        expiresAt = new Date(now.getTime() + parsed.data.expiresInHours * 60 * 60 * 1000);
      }

      await db.insert(invites).values({
        id,
        serverId,
        code,
        creatorId: request.user.sub,
        maxUses: parsed.data.maxUses ?? null,
        uses: 0,
        expiresAt,
        createdAt: now,
      });

      const invite = (await db.select().from(invites).where(eq(invites.id, id)).then(r => r[0]))!;

      return reply.status(201).send({
        id: invite.id,
        serverId: invite.serverId,
        code: invite.code,
        creatorId: invite.creatorId,
        maxUses: invite.maxUses,
        uses: invite.uses,
        expiresAt: invite.expiresAt?.toISOString() ?? null,
        createdAt: invite.createdAt.toISOString(),
      });
    });

    // GET /api/servers/:serverId/invites — list invites (owner)
    app.get(fastifyRoute(SERVER_ROUTES.INVITES_LIST), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const isOwner = await serverService.isOwner(serverId, request.user.sub);
      if (!isOwner) {
        return reply.status(403).send({ error: "Only the server owner can view invites" });
      }

      const allInvites = await db
        .select()
        .from(invites)
        .where(eq(invites.serverId, serverId))
        ;

      return reply.send(
        allInvites.map((inv) => ({
          id: inv.id,
          serverId: inv.serverId,
          code: inv.code,
          creatorId: inv.creatorId,
          maxUses: inv.maxUses,
          uses: inv.uses,
          expiresAt: inv.expiresAt?.toISOString() ?? null,
          createdAt: inv.createdAt.toISOString(),
        })),
      );
    });

    // DELETE /api/servers/:serverId/invites/:inviteId — revoke invite (owner)
    app.delete(fastifyRoute(SERVER_ROUTES.INVITES_DELETE), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId, inviteId } = request.params as { serverId: string; inviteId: string };

      const isOwner = await serverService.isOwner(serverId, request.user.sub);
      if (!isOwner) {
        return reply.status(403).send({ error: "Only the server owner can revoke invites" });
      }

      await db
        .delete(invites)
        .where(and(eq(invites.id, inviteId), eq(invites.serverId, serverId)))
        ;

      return reply.status(204).send();
    });

    // POST /api/invites/join — join server via invite code
    app.post(fastifyRoute(INVITE_ROUTES.JOIN), { preHandler: requireAuth }, async (request, reply) => {
      const parsed = joinServerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation failed", issues: parsed.error.issues });
      }

      const invite = await db
        .select()
        .from(invites)
        .where(eq(invites.code, parsed.data.code))
        .then(r => r[0]);

      if (!invite) {
        return reply.status(404).send({ error: "Invalid invite code" });
      }

      // Check expiry
      if (invite.expiresAt && invite.expiresAt < new Date()) {
        return reply.status(410).send({ error: "This invite has expired" });
      }

      // Check max uses
      if (invite.maxUses && invite.uses >= invite.maxUses) {
        return reply.status(410).send({ error: "This invite has reached its maximum uses" });
      }

      // Check if banned
      const ban = await db
        .select()
        .from(bans)
        .where(and(eq(bans.serverId, invite.serverId), eq(bans.userId, request.user.sub)))
        .then(r => r[0]);
      if (ban) {
        return reply.status(403).send({ error: "You are banned from this server" });
      }

      // Check if already a member
      const alreadyMember = await serverService.isMember(invite.serverId, request.user.sub);
      if (alreadyMember) {
        return reply.status(409).send({ error: "Already a member of this server" });
      }

      const now = new Date();

      // Add as member
      await db.insert(serverMembers).values({
        id: crypto.randomUUID(),
        serverId: invite.serverId,
        userId: request.user.sub,
        joinedAt: now,
      });

      // Increment uses
      await db
        .update(invites)
        .set({ uses: invite.uses + 1 })
        .where(eq(invites.id, invite.id))
        ;

      const server = (await db.select().from(servers).where(eq(servers.id, invite.serverId)).then(r => r[0]))!;
      const user = (await db.select().from(users).where(eq(users.id, request.user.sub)).then(r => r[0]))!;

      pubsub.publish(`server:${invite.serverId}`, {
        op: 0,
        t: "MEMBER_JOIN",
        d: {
          id: crypto.randomUUID(),
          serverId: invite.serverId,
          userId: request.user.sub,
          user: userToPublic(user),
          joinedAt: now.toISOString(),
        },
      });

      return reply.status(200).send({
        id: server.id,
        name: server.name,
        iconUrl: server.iconUrl,
        ownerId: server.ownerId,
        createdAt: server.createdAt.toISOString(),
        updatedAt: server.updatedAt.toISOString(),
      });
    });
  };
}
