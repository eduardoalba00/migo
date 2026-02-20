import { spawn, execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Start Postgres container
console.log("Starting Postgres...");
try {
  execFileSync("docker", ["compose", "up", "-d", "--wait", "postgres"], {
    stdio: "inherit",
    cwd: root,
  });
} catch {
  console.error("Failed to start Postgres.");
  process.exit(1);
}

// Spawn LiveKit and server
const livekit = spawn("node", [join(__dirname, "start-livekit.mjs")], {
  stdio: ["ignore", "pipe", "pipe"],
  cwd: root,
});

const server = spawn("pnpm", ["--filter", "@migo/server", "dev"], {
  stdio: ["ignore", "pipe", "pipe"],
  shell: true,
  cwd: root,
});

// Prefix output lines with labels
function pipe(proc, name, color) {
  const prefix = `${color}[${name}]\x1b[0m `;
  for (const stream of [proc.stdout, proc.stderr]) {
    if (!stream) continue;
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete line in buffer
      for (const line of lines) {
        process.stdout.write(`${prefix}${line}\n`);
      }
    });
    stream.on("end", () => {
      if (buffer) process.stdout.write(`${prefix}${buffer}\n`);
    });
  }
}

pipe(livekit, "livekit", "\x1b[35m"); // magenta
pipe(server, "server", "\x1b[32m");   // green

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nShutting down...");

  livekit.kill();
  server.kill();

  // Fire-and-forget: detached docker compose down runs independently
  spawn("docker", ["compose", "down"], {
    stdio: "ignore",
    cwd: root,
    detached: true,
  }).unref();

  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

livekit.on("exit", (code) => {
  if (!shuttingDown) {
    console.error(`LiveKit exited with code ${code}`);
    shutdown();
  }
});

server.on("exit", (code) => {
  if (!shuttingDown) {
    console.error(`Server exited with code ${code}`);
    shutdown();
  }
});
