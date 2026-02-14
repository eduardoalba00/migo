import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { ROLE_ROUTES, createRoleSchema, updateRoleSchema, Permission } from "@migo/shared";
import type { AppDatabase } from "../db/index.js";
import { roles, memberRoles } from "../db/schema/roles.js";
import { servers, serverMembers } from "../db/schema/servers.js";
import type { AuthService } from "../services/auth.js";
import type { ServerService } from "../services/server.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { fastifyRoute } from "../lib/route-utils.js";

function roleToPublic(role: typeof roles.$inferSelect) {
  return {
    id: role.id,
    serverId: role.serverId,
    name: role.name,
    color: role.color,
    position: role.position,
    permissions: role.permissions,
    isDefault: role.isDefault,
    createdAt: role.createdAt.toISOString(),
  };
}

export function roleRoutes(
  db: AppDatabase,
  authService: AuthService,
  serverService: ServerService,
) {
  return async function (app: FastifyInstance) {
    const requireAuth = createAuthMiddleware(authService);

    // GET /api/servers/:serverId/roles
    app.get(fastifyRoute(ROLE_ROUTES.LIST), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const isMember = await serverService.isMember(serverId, request.user.sub);
      if (!isMember) {
        return reply.status(403).send({ error: "Not a member of this server" });
      }

      const allRoles = await db
        .select()
        .from(roles)
        .where(eq(roles.serverId, serverId))
        ;

      return reply.send(allRoles.map(roleToPublic));
    });

    // POST /api/servers/:serverId/roles
    app.post(fastifyRoute(ROLE_ROUTES.CREATE), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const isOwner = await serverService.isOwner(serverId, request.user.sub);
      if (!isOwner) {
        return reply.status(403).send({ error: "Only the server owner can create roles" });
      }

      const parsed = createRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation failed", issues: parsed.error.issues });
      }

      // Get max position
      const existing = await db
        .select()
        .from(roles)
        .where(eq(roles.serverId, serverId))
        ;
      const maxPosition = existing.reduce((max, r) => Math.max(max, r.position), 0);

      const id = crypto.randomUUID();
      const now = new Date();

      await db.insert(roles).values({
        id,
        serverId,
        name: parsed.data.name,
        color: parsed.data.color ?? null,
        position: maxPosition + 1,
        permissions: parsed.data.permissions ?? 0,
        isDefault: false,
        createdAt: now,
      });

      const role = (await db.select().from(roles).where(eq(roles.id, id)).then(r => r[0]))!;
      return reply.status(201).send(roleToPublic(role));
    });

    // PATCH /api/servers/:serverId/roles/:roleId
    app.patch(fastifyRoute(ROLE_ROUTES.UPDATE), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId, roleId } = request.params as { serverId: string; roleId: string };

      const isOwner = await serverService.isOwner(serverId, request.user.sub);
      if (!isOwner) {
        return reply.status(403).send({ error: "Only the server owner can update roles" });
      }

      const parsed = updateRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation failed", issues: parsed.error.issues });
      }

      const existing = await db
        .select()
        .from(roles)
        .where(and(eq(roles.id, roleId), eq(roles.serverId, serverId)))
        .then(r => r[0]);
      if (!existing) {
        return reply.status(404).send({ error: "Role not found" });
      }

      const updates: Record<string, unknown> = {};
      if (parsed.data.name !== undefined) updates.name = parsed.data.name;
      if (parsed.data.color !== undefined) updates.color = parsed.data.color;
      if (parsed.data.permissions !== undefined) updates.permissions = parsed.data.permissions;
      if (parsed.data.position !== undefined) updates.position = parsed.data.position;

      if (Object.keys(updates).length > 0) {
        await db.update(roles).set(updates).where(eq(roles.id, roleId));
      }

      const role = (await db.select().from(roles).where(eq(roles.id, roleId)).then(r => r[0]))!;
      return reply.send(roleToPublic(role));
    });

    // DELETE /api/servers/:serverId/roles/:roleId
    app.delete(fastifyRoute(ROLE_ROUTES.DELETE), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId, roleId } = request.params as { serverId: string; roleId: string };

      const isOwner = await serverService.isOwner(serverId, request.user.sub);
      if (!isOwner) {
        return reply.status(403).send({ error: "Only the server owner can delete roles" });
      }

      const existing = await db
        .select()
        .from(roles)
        .where(and(eq(roles.id, roleId), eq(roles.serverId, serverId)))
        .then(r => r[0]);
      if (!existing) {
        return reply.status(404).send({ error: "Role not found" });
      }
      if (existing.isDefault) {
        return reply.status(400).send({ error: "Cannot delete the default role" });
      }

      await db.delete(roles).where(eq(roles.id, roleId));
      return reply.status(204).send();
    });

    // PUT /api/servers/:serverId/members/:userId/roles/:roleId — assign role
    app.put(fastifyRoute(ROLE_ROUTES.ASSIGN), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId, userId, roleId } = request.params as { serverId: string; userId: string; roleId: string };

      const isOwner = await serverService.isOwner(serverId, request.user.sub);
      if (!isOwner) {
        return reply.status(403).send({ error: "Only the server owner can assign roles" });
      }

      const role = await db.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.serverId, serverId))).then(r => r[0]);
      if (!role) {
        return reply.status(404).send({ error: "Role not found" });
      }

      const member = await db
        .select()
        .from(serverMembers)
        .where(and(eq(serverMembers.serverId, serverId), eq(serverMembers.userId, userId)))
        .then(r => r[0]);
      if (!member) {
        return reply.status(404).send({ error: "Member not found" });
      }

      // Check if already assigned
      const existing = await db
        .select()
        .from(memberRoles)
        .where(and(eq(memberRoles.roleId, roleId), eq(memberRoles.userId, userId), eq(memberRoles.serverId, serverId)))
        .then(r => r[0]);
      if (existing) {
        return reply.status(409).send({ error: "Role already assigned" });
      }

      await db.insert(memberRoles).values({
        id: crypto.randomUUID(),
        memberId: member.id,
        roleId,
        serverId,
        userId,
      });

      return reply.status(204).send();
    });

    // DELETE /api/servers/:serverId/members/:userId/roles/:roleId — remove role
    app.delete(fastifyRoute(ROLE_ROUTES.REMOVE), { preHandler: requireAuth }, async (request, reply) => {
      const { serverId, userId, roleId } = request.params as { serverId: string; userId: string; roleId: string };

      const isOwner = await serverService.isOwner(serverId, request.user.sub);
      if (!isOwner) {
        return reply.status(403).send({ error: "Only the server owner can remove roles" });
      }

      await db
        .delete(memberRoles)
        .where(and(eq(memberRoles.roleId, roleId), eq(memberRoles.userId, userId), eq(memberRoles.serverId, serverId)))
        ;

      return reply.status(204).send();
    });
  };
}
