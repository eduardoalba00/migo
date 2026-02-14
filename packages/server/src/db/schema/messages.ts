import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { channels } from "./channels.js";
import { users } from "./users.js";

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  authorId: text("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  replyToId: text("reply_to_id"),
  editedAt: timestamp("edited_at"),
  pinnedAt: timestamp("pinned_at"),
  pinnedBy: text("pinned_by"),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
});
