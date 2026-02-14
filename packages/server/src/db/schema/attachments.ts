import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { messages } from "./messages.js";

export const attachments = pgTable("attachments", {
  id: text("id").primaryKey(),
  messageId: text("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  url: text("url").notNull(),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
});
