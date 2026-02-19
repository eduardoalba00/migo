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

export const dmMessages = pgTable("dm_messages", {
  id: text("id").primaryKey(),
  channelId: text("channel_id")
    .notNull()
    .references(() => dmChannels.id, { onDelete: "cascade" }),
  authorId: text("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  editedAt: timestamp("edited_at"),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
});
