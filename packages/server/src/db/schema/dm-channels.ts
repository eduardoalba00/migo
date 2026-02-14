import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const dmChannels = pgTable("dm_channels", {
  id: text("id").primaryKey(),
  lastMessageAt: timestamp("last_message_at"),
  createdAt: timestamp("created_at").notNull(),
});

export const dmMembers = pgTable("dm_members", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => dmChannels.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
});
