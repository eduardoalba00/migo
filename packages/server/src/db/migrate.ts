import { migrate } from "drizzle-orm/postgres-js/migrator";
import { loadConfig } from "../config.js";
import { createDatabase } from "./index.js";

const config = loadConfig();
const { db, client } = createDatabase(config.databaseUrl);

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations applied successfully");
await client.end();
