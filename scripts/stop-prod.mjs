import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const ENV_FILE = join(root, ".env.prod");
const COMPOSE_FILE = join(root, "docker-compose.prod.yml");
const PID_FILE = join(root, ".livekit", "livekit.pid");

console.log("Stopping Migo backend...\n");

// Kill LiveKit process
if (existsSync(PID_FILE)) {
  const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
  try {
    process.kill(pid);
    console.log(`Stopped LiveKit (PID ${pid})`);
  } catch {
    console.log("LiveKit was not running.");
  }
  try {
    unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
} else {
  console.log("No LiveKit PID file found.");
}

// Stop Docker services
console.log("Stopping Docker services...");
try {
  execFileSync("docker", ["compose", "-f", COMPOSE_FILE, "--env-file", ENV_FILE, "down"], {
    stdio: "inherit",
    cwd: root,
  });
} catch {
  console.error("Failed to stop Docker services.");
  process.exit(1);
}

console.log("\nMigo backend stopped.");
