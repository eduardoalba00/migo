import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const ENV_FILE = join(root, ".env.prod");
const COMPOSE_FILE = join(root, "docker-compose.prod.yml");
const PID_FILE = join(root, ".livekit", "livekit.pid");

// Load .env.prod into process.env
if (!existsSync(ENV_FILE)) {
  console.error("Missing .env.prod — run `pnpm prod:setup` first.");
  process.exit(1);
}

const envLines = readFileSync(ENV_FILE, "utf-8").split("\n");
for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq);
  const value = trimmed.slice(eq + 1);
  process.env[key] = value;
}

// Start Docker services
console.log("Starting Docker services (Postgres, Migo server, Watchtower)...");
try {
  execFileSync("docker", ["compose", "-f", COMPOSE_FILE, "--env-file", ENV_FILE, "up", "-d"], {
    stdio: "inherit",
    cwd: root,
  });
} catch {
  console.error("Failed to start Docker services. Check logs with:");
  console.error("  docker compose -f docker-compose.prod.yml --env-file .env.prod logs");
  process.exit(1);
}

// Start LiveKit natively in background
console.log("Starting LiveKit server (native)...");
const livekit = spawn("node", [join(__dirname, "start-livekit.mjs"), "--prod"], {
  stdio: "ignore",
  env: process.env,
  cwd: root,
  detached: true,
  windowsHide: true,
});
livekit.unref();

// Save PID so stop script can kill it
writeFileSync(PID_FILE, String(livekit.pid));

console.log("\nMigo backend is up and running!");
console.log("  Stop with: pnpm prod:stop");
