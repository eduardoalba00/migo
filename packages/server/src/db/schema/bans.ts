import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { servers } from "./servers.js";
import { users } from "./users.js";

export const bans = pgTable("bans", {
  id: text("id").primaryKey(),
  serverId: text("server_id")
    .notNull()
    .references(() => servers.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  reason: text("reason"),
  bannedBy: text("banned_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
});
