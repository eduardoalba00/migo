import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { servers } from "./servers.js";

export const roles = pgTable("roles", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color"),
  position: integer("position").notNull().default(0),
  permissions: integer("permissions").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull(),
});

export const memberRoles = pgTable("member_roles", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull(),
  roleId: text("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
});
