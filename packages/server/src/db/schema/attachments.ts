import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const attachments = pgTable("attachments", {
  id: text("id").primaryKey(),
  // Shared by both channel messages and DM messages — no FK constraint
  messageId: text("message_id"),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  url: text("url").notNull(),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
});
