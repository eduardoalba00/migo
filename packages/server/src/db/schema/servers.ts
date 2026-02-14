import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const servers = pgTable("servers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  iconUrl: text("icon_url"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

export const serverMembers = pgTable("server_members", {
  id: text("id").primaryKey(),
  serverId: text("server_id")
    .notNull()
    .references(() => servers.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at")
    .notNull()
    .$defaultFn(() => new Date()),
});
