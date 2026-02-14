import { pgTable, text, integer } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const readStates = pgTable("read_states", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull(),
  lastReadMessageId: text("last_read_message_id"),
  mentionCount: integer("mention_count").notNull().default(0),
});
