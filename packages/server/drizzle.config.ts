import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/*",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgres://localhost:5432/migo",
  },
});
