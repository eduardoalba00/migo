import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { registerSchema, loginSchema, refreshSchema, AUTH_ROUTES } from "@migo/shared";
import type { AppDatabase } from "../db/index.js";
import { users } from "../db/schema/users.js";
import type { AuthService } from "../services/auth.js";
import { createAuthMiddleware } from "../middleware/auth.js";

function userToPublic(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    status: user.status,
    customStatus: user.customStatus,
    joinSoundUrl: user.joinSoundUrl,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function authRoutes(db: AppDatabase, authService: AuthService) {
  return async function (app: FastifyInstance) {
    const requireAuth = createAuthMiddleware(authService);

    // POST /api/auth/register
    app.post(AUTH_ROUTES.REGISTER, async (request, reply) => {
      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation failed", issues: parsed.error.issues });
      }

      const { username, displayName, password } = parsed.data;

      const existing = await db.select().from(users).where(eq(users.username, username)).then(r => r[0]);
      if (existing) {
        return reply.status(409).send({ error: "Username already taken" });
      }

      const passwordHash = await authService.hashPassword(password);
      const id = crypto.randomUUID();
      const now = new Date();

      await db.insert(users)
        .values({
          id,
          username,
          displayName: displayName || username,
          passwordHash,
          createdAt: now,
          updatedAt: now,
        })
        ;

      const user = (await db.select().from(users).where(eq(users.id, id)).then(r => r[0]))!;
      const tokens = await authService.generateTokenPair(user.id, user.username);

      return reply.status(201).send({
        user: userToPublic(user),
        tokens,
      });
    });

    // POST /api/auth/login
    app.post(AUTH_ROUTES.LOGIN, async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation failed", issues: parsed.error.issues });
      }

      const { username, password } = parsed.data;

      const user = await db.select().from(users).where(eq(users.username, username)).then(r => r[0]);
      if (!user) {
        return reply.status(401).send({ error: "Invalid username or password" });
      }

      const valid = await authService.verifyPassword(user.passwordHash, password);
      if (!valid) {
        return reply.status(401).send({ error: "Invalid username or password" });
      }

      const tokens = await authService.generateTokenPair(user.id, user.username);

      return reply.status(200).send({
        user: userToPublic(user),
        tokens,
      });
    });

    // POST /api/auth/refresh
    app.post(AUTH_ROUTES.REFRESH, async (request, reply) => {
      const parsed = refreshSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation failed", issues: parsed.error.issues });
      }

      try {
        const payload = await authService.verifyRefreshToken(parsed.data.refreshToken);
        const user = await db.select().from(users).where(eq(users.id, payload.sub)).then(r => r[0]);
        if (!user) {
          return reply.status(401).send({ error: "User not found" });
        }

        const tokens = await authService.generateTokenPair(user.id, user.username);

        return reply.status(200).send({
          user: userToPublic(user),
          tokens,
        });
      } catch {
        return reply.status(401).send({ error: "Invalid or expired refresh token" });
      }
    });

    // GET /api/auth/me
    app.get(AUTH_ROUTES.ME, { preHandler: requireAuth }, async (request, reply) => {
      const user = await db.select().from(users).where(eq(users.id, request.user.sub)).then(r => r[0]);
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }

      return reply.status(200).send({ user: userToPublic(user) });
    });

    // PATCH /api/auth/me — update profile
    app.patch(AUTH_ROUTES.ME, { preHandler: requireAuth }, async (request, reply) => {
      const user = await db.select().from(users).where(eq(users.id, request.user.sub)).then(r => r[0]);
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }

      const body = request.body as Record<string, unknown>;
      const updates: Record<string, unknown> = {};
      if (typeof body.displayName === "string" && body.displayName.trim()) updates.displayName = body.displayName.trim();
      if (typeof body.avatarUrl === "string" || body.avatarUrl === null) updates.avatarUrl = body.avatarUrl;
      if (typeof body.customStatus === "string" || body.customStatus === null) updates.customStatus = body.customStatus;
      if (typeof body.status === "string" && ["online", "idle", "dnd", "offline"].includes(body.status)) updates.status = body.status;
      if (typeof body.joinSoundUrl === "string" || body.joinSoundUrl === null) updates.joinSoundUrl = body.joinSoundUrl;

      if (Object.keys(updates).length === 0) {
        return reply.status(400).send({ error: "No valid fields to update" });
      }

      updates.updatedAt = new Date();

      await db.update(users).set(updates).where(eq(users.id, request.user.sub));

      const updated = (await db.select().from(users).where(eq(users.id, request.user.sub)).then(r => r[0]))!;
      return reply.status(200).send({ user: userToPublic(updated) });
    });

    // POST /api/auth/change-password
    app.post("/api/auth/change-password", { preHandler: requireAuth }, async (request, reply) => {
      const user = await db.select().from(users).where(eq(users.id, request.user.sub)).then(r => r[0]);
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }

      const body = request.body as { currentPassword: string; newPassword: string };
      if (!body.currentPassword || !body.newPassword) {
        return reply.status(400).send({ error: "Current and new passwords required" });
      }
      if (body.newPassword.length < 8) {
        return reply.status(400).send({ error: "New password must be at least 8 characters" });
      }

      const valid = await authService.verifyPassword(user.passwordHash, body.currentPassword);
      if (!valid) {
        return reply.status(401).send({ error: "Current password is incorrect" });
      }

      const passwordHash = await authService.hashPassword(body.newPassword);
      await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, request.user.sub));

      return reply.status(200).send({ message: "Password changed successfully" });
    });
  };
}
