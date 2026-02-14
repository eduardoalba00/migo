import { loadConfig } from "./config.js";
import { createDatabase } from "./db/index.js";
import { buildApp } from "./app.js";

async function main() {
  const config = loadConfig();
  const { db } = createDatabase(config.databaseUrl);

  const app = await buildApp(config, db);

  await app.listen({ port: config.port, host: config.host });
  console.log(`Migo server running on http://${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
