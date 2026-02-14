import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  passwordHash: text("password_hash").notNull(),
  status: text("status", { enum: ["online", "idle", "dnd", "offline"] })
    .notNull()
    .default("offline"),
  customStatus: text("custom_status"),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
});
