import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { servers } from "./servers.js";
import { users } from "./users.js";

export const invites = pgTable("invites", {
  id: text("id").primaryKey(),
  serverId: text("server_id")
    .notNull()
    .references(() => servers.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  creatorId: text("creator_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  maxUses: integer("max_uses"),
  uses: integer("uses").notNull().default(0),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
});
