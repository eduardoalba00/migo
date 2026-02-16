import { fileURLToPath } from "node:url";
import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/index.js";
import { buildApp } from "./app.js";

async function main() {
  const config = loadConfig();
  const { db } = createDatabase(config.databaseUrl);

  console.log("Running database migrations...");
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  await migrate(db, { migrationsFolder: path.join(__dirname, "../drizzle") });
  console.log("Migrations applied successfully");

  const app = await buildApp(config, db);

  await app.listen({ port: config.port, host: config.host });
  console.log(`Migo server running on http://${config.host}:${config.port}`);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log(`Received ${signal}, shutting down...`);
      app.close().then(() => {
        console.log("Server closed");
        process.exit(0);
      });
    });
  }
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
