import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { messages } from "./messages.js";
import { users } from "./users.js";

export const reactions = pgTable("reactions", {
  id: text("id").primaryKey(),
  messageId: text("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
});
