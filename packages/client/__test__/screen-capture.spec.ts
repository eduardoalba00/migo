import { describe, it, expect, afterAll } from "vitest";
import { createRequire } from "module";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { FrameMetrics } from "./helpers/metrics.js";
import { parseNalTypes, parseSpsResolution } from "./helpers/h264.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const electronPath: string = require("electron") as unknown as string;
const testMainJs = path.join(__dirname, "electron", "test-main.cjs");

interface SpawnResult {
  proc: ChildProcess;
  waitForLine: () => Promise<string>;
}

function spawnElectron(mode: string, env?: Record<string, string>): SpawnResult {
  const proc = spawn(electronPath, [testMainJs, mode], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });

  const waitForLine = (): Promise<string> =>
    new Promise((resolve, reject) => {
      let buffer = "";
      let resolved = false;

      const tryParseLine = () => {
        while (true) {
          const newline = buffer.indexOf("\n");
          if (newline === -1) break;
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line.length > 0) {
            resolved = true;
            proc.stdout!.removeAllListeners("data");
            resolve(line);
            return;
          }
        }
      };

      proc.stdout!.on("data", (chunk: Buffer) => {
        if (resolved) return;
        buffer += chunk.toString();
        tryParseLine();
      });

      proc.on("error", (err) => {
        if (!resolved) reject(err);
      });

      proc.stdout!.on("end", () => {
        if (!resolved) {
          const trimmed = buffer.trim();
          if (trimmed) {
            resolved = true;
            resolve(trimmed);
          } else {
            reject(new Error("Electron stdout closed without output"));
          }
        }
      });
    });

  return { proc, waitForLine };
}

function killProc(proc: ChildProcess | null): void {
  if (proc && !proc.killed) proc.kill();
}

// ---------------------------------------------------------------------------
// Tests — all buttercap calls happen inside spawned Electron processes
// ---------------------------------------------------------------------------

describe("buttercap integration", { timeout: 60_000 }, () => {
  let colorbarsProc: ChildProcess | null = null;

  afterAll(() => {
    killProc(colorbarsProc);
  });

  it("loads buttercap in Electron main process", async () => {
    const { proc, waitForLine } = spawnElectron("load-test");
    try {
      const line = await waitForLine();
      const results = JSON.parse(line);

      expect(results.success).toBe(true);
      expect(results.windowCount).toBeGreaterThan(0);
      expect(results.displayCount).toBeGreaterThan(0);
      expect(results.packetCount).toBeGreaterThan(10);
      expect(results.firstKeyframe).toBe(true);
      expect(results.errors).toHaveLength(0);
    } finally {
      killProc(proc);
    }
  });

  it("enumerates windows and displays", async () => {
    const { proc, waitForLine } = spawnElectron("enumerate");
    try {
      const line = await waitForLine();
      const results = JSON.parse(line);

      expect(results.windows.length).toBeGreaterThan(0);
      expect(results.displays.length).toBeGreaterThan(0);

      // Verify window structure
      const win = results.windows[0];
      expect(win).toHaveProperty("hwnd");
      expect(win).toHaveProperty("title");
      expect(win).toHaveProperty("pid");
      expect(win).toHaveProperty("exe");

      // Verify display structure
      const display = results.displays[0];
      expect(display).toHaveProperty("id");
      expect(display).toHaveProperty("name");
      expect(display).toHaveProperty("width");
      expect(display).toHaveProperty("height");
      expect(display).toHaveProperty("primary");

      console.log(
        `Enumerated: ${results.windows.length} windows, ${results.displays.length} displays`
      );
    } finally {
      killProc(proc);
    }
  });

  it("captures window to H.264 via IPC pipeline", async () => {
    // Spawn colorbars test window
    const { proc, waitForLine } = spawnElectron("colorbars");
    colorbarsProc = proc;

    const line = await waitForLine();
    const ready = JSON.parse(line);
    expect(ready.ready).toBe(true);

    // Let window render
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Use ipc-capture with TEST_TARGET_TITLE — finds the window by title inside Electron
    const { proc: captureProc, waitForLine: waitCapture } = spawnElectron("ipc-capture", {
      TEST_TARGET_TITLE: "migo-test-colorbars",
      TEST_DURATION_MS: "5000",
    });

    try {
      const captureLine = await waitCapture();
      const results = JSON.parse(captureLine);

      expect(results.errors).toHaveLength(0);
      expect(results.videoPackets.length).toBeGreaterThan(10);

      // Verify keyframes exist
      const keyframes = results.videoPackets.filter((p: any) => p.keyframe);
      expect(keyframes.length).toBeGreaterThanOrEqual(1);

      // Verify H.264 NAL structure in first keyframe
      const firstKeyframe = keyframes[0];
      expect(firstKeyframe.data).toBeDefined();
      const nalData = Buffer.from(firstKeyframe.data);
      const nalTypes = parseNalTypes(nalData);
      expect(nalTypes).toContain(7); // SPS
      expect(nalTypes).toContain(8); // PPS
      expect(nalTypes).toContain(5); // IDR

      // Verify SPS resolution matches colorbars window (3440x1392)
      const resolution = parseSpsResolution(nalData);
      expect(resolution).not.toBeNull();
      expect(resolution!.width).toBe(3440);
      expect(resolution!.height).toBe(1392);

      // Verify monotonic timestamps
      for (let i = 1; i < results.videoPackets.length; i++) {
        expect(results.videoPackets[i].timestampUs).toBeGreaterThanOrEqual(
          results.videoPackets[i - 1].timestampUs
        );
      }

      console.log(
        `Window capture: ${results.videoPackets.length} packets (${keyframes.length} keyframes), ` +
          `resolution: ${resolution!.width}x${resolution!.height}`
      );
    } finally {
      killProc(captureProc);
    }
  });

  it("captures display to H.264", async () => {
    // ipc-capture defaults to primary display when no target specified
    const { proc, waitForLine } = spawnElectron("ipc-capture", {
      TEST_TARGET_TYPE: "display",
      TEST_DURATION_MS: "3000",
    });

    try {
      const line = await waitForLine();
      const results = JSON.parse(line);

      expect(results.errors).toHaveLength(0);
      expect(results.videoPackets.length).toBeGreaterThan(10);

      const keyframes = results.videoPackets.filter((p: any) => p.keyframe);
      expect(keyframes.length).toBeGreaterThanOrEqual(1);

      console.log(
        `Display capture: ${results.videoPackets.length} packets (${keyframes.length} keyframes)`
      );
    } finally {
      killProc(proc);
    }
  });

  it("captures system audio with display share", async () => {
    const { proc, waitForLine } = spawnElectron("ipc-capture", {
      TEST_TARGET_TYPE: "display",
      TEST_DURATION_MS: "3000",
    });

    try {
      const line = await waitForLine();
      const results = JSON.parse(line);

      expect(results.errors).toHaveLength(0);

      // Audio packets should be received (WASAPI loopback always generates data, even silence)
      expect(results.audioPackets.length).toBeGreaterThan(0);

      // Verify audio packet structure
      const firstAudio = results.audioPackets[0];
      expect(firstAudio.size).toBeGreaterThan(0);
      expect(firstAudio.samples).toBeGreaterThan(0);
      // 48kHz stereo float32: packet size = samples * 2 channels * 4 bytes
      expect(firstAudio.size).toBe(firstAudio.samples * 2 * 4);

      console.log(
        `Audio capture: ${results.audioPackets.length} packets, ` +
          `first packet: ${firstAudio.samples} samples (${firstAudio.size} bytes)`
      );
    } finally {
      killProc(proc);
    }
  });

  it("achieves target frame rate", async () => {
    // Reuse colorbars window if alive
    if (!colorbarsProc || colorbarsProc.killed) {
      const { proc, waitForLine } = spawnElectron("colorbars");
      colorbarsProc = proc;
      const line = await waitForLine();
      expect(JSON.parse(line).ready).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const { proc, waitForLine } = spawnElectron("ipc-capture", {
      TEST_TARGET_TITLE: "migo-test-colorbars",
      TEST_DURATION_MS: "5000",
    });

    try {
      const line = await waitForLine();
      const results = JSON.parse(line);

      expect(results.errors).toHaveLength(0);

      const metrics = new FrameMetrics();
      for (const pkt of results.videoPackets) {
        metrics.record(pkt.timestampUs, pkt.size);
      }

      // Conservative threshold — should easily exceed 25fps at 60fps target
      expect(metrics.fps).toBeGreaterThanOrEqual(25);
      expect(results.videoPackets.length).toBeGreaterThan(100);

      console.log(
        `Frame rate: ${metrics.fps.toFixed(1)} fps, ` +
          `${metrics.frameCount} frames, ` +
          `jitter: ${metrics.jitterMs.toFixed(1)}ms, ` +
          `p99 interval: ${metrics.percentile(99).toFixed(1)}ms`
      );
    } finally {
      killProc(proc);
    }
  });

  it("clean stop flushes remaining packets", async () => {
    const { proc, waitForLine } = spawnElectron("ipc-capture", {
      TEST_TARGET_TYPE: "display",
      TEST_DURATION_MS: "2000",
    });

    try {
      const line = await waitForLine();
      const results = JSON.parse(line);

      expect(results.errors).toHaveLength(0);
      expect(results.videoPackets.length).toBeGreaterThan(0);

      console.log(
        `Clean stop: ${results.videoPackets.length} video, ${results.audioPackets.length} audio packets`
      );
    } finally {
      killProc(proc);
    }
  });
});
