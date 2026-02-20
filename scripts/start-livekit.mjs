import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const livekitDir = join(root, ".livekit");

const VERSION = "1.9.11";
const isProd = process.argv.includes("--prod");

// Platform detection
const platformMap = { win32: "windows", linux: "linux", darwin: "darwin" };
const platform = platformMap[process.platform];
if (!platform) {
  console.error(`Unsupported platform: ${process.platform}`);
  process.exit(1);
}

const isWindows = process.platform === "win32";
const bin = join(livekitDir, isWindows ? "livekit-server.exe" : "livekit-server");

// Download LiveKit binary if missing
if (!existsSync(bin)) {
  console.log(`Downloading LiveKit server v${VERSION}...`);
  mkdirSync(livekitDir, { recursive: true });

  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const ext = isWindows ? "zip" : "tar.gz";
  const url = `https://github.com/livekit/livekit/releases/download/v${VERSION}/livekit_${VERSION}_${platform}_${arch}.${ext}`;
  const archive = join(livekitDir, `livekit.${ext}`);

  execFileSync("curl", ["-fsSL", url, "-o", archive], { stdio: "inherit" });

  if (isWindows) {
    execFileSync("tar", ["-xf", archive, "-C", livekitDir], { stdio: "inherit" });
  } else {
    execFileSync("tar", ["-xzf", archive, "-C", livekitDir], { stdio: "inherit" });
  }

  unlinkSync(archive);

  // Make binary executable on Unix
  if (!isWindows) {
    execFileSync("chmod", ["+x", bin]);
  }

  console.log(`LiveKit server downloaded.`);
}

// Generate config YAML dynamically
const configPath = join(livekitDir, "livekit.yaml");

if (isProd) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    console.error("LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set for production.");
    process.exit(1);
  }
  writeFileSync(
    configPath,
    `port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
keys:
  ${apiKey}: ${apiSecret}
logging:
  level: info
`
  );
} else {
  writeFileSync(
    configPath,
    `port: 7890
rtc:
  tcp_port: 7891
  port_range_start: 50200
  port_range_end: 50400
  use_external_ip: false
keys:
  devkey: dev-secret-do-not-use-in-production!
logging:
  level: info
`
  );
}

const child = spawn(bin, ["--config", configPath], { stdio: "inherit", shell: false });
child.on("exit", (code) => process.exit(code ?? 0));

process.on("SIGINT", () => child.kill());
process.on("SIGTERM", () => child.kill());
