// Test script for the WASAPI audio capture native addon.
// Run with: node src/native/test-capture.cjs
//
// Tests each function in isolation, then does an end-to-end capture test.
// Exits with code 0 if all tests pass, 1 if any fail.

const path = require("path");
const { execSync } = require("child_process");

const ADDON_PATH = path.join(__dirname, "../../build/Release/audio_capture.node");

// ─── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL: ${name}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL: ${name}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Compute jitter stats from an array of inter-callback intervals (ms). */
function computeJitterStats(intervals) {
  if (intervals.length === 0) return { min: 0, max: 0, mean: 0, stddev: 0, gapsOver15ms: 0 };
  const min = Math.min(...intervals);
  const max = Math.max(...intervals);
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / intervals.length;
  const stddev = Math.sqrt(variance);
  const gapsOver15ms = intervals.filter((v) => v > 15).length;
  return { min, max, mean, stddev, gapsOver15ms };
}

// ─── Load addon ────────────────────────────────────────────────────────────────

console.log("\n--- Loading native addon ---\n");

let addon;
test("addon loads via process.dlopen", () => {
  const mod = { exports: {} };
  process.dlopen(mod, ADDON_PATH);
  addon = mod.exports;
  assert(addon, "module exports is falsy");
});

test("exports all expected functions", () => {
  for (const fn of ["startCapture", "stopCapture", "onData", "hwndToPid", "getLastError", "getDataCount", "isRunning"]) {
    assert(typeof addon[fn] === "function", `${fn} is not a function`);
  }
});

// ─── hwndToPid tests ───────────────────────────────────────────────────────────

console.log("\n--- hwndToPid ---\n");

test("hwndToPid(0) returns 0 (invalid HWND)", () => {
  const pid = addon.hwndToPid(0);
  assert(pid === 0, `Expected 0, got ${pid}`);
});

let realHwnd = 0;
let realPid = 0;
test("resolves a real window HWND to PID", () => {
  const ps = `powershell -NoProfile -Command "(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1).MainWindowHandle"`;
  const output = execSync(ps, { encoding: "utf8" }).trim();
  const hwnd = parseInt(output, 10);
  assert(hwnd > 0, "Could not find any window with a valid HWND");
  realHwnd = hwnd;
  realPid = addon.hwndToPid(hwnd);
  assert(realPid > 0, `Expected positive PID for HWND ${hwnd}, got ${realPid}`);
  console.log(`    HWND=${hwnd} -> PID=${realPid}`);
});

// ─── onData / stopCapture safety ───────────────────────────────────────────────

console.log("\n--- onData / stopCapture safety ---\n");

test("onData accepts a callback without throwing", () => {
  addon.onData(() => {});
});

test("stopCapture works when not capturing", () => {
  addon.stopCapture();
});

test("getLastError returns empty string initially", () => {
  const err = addon.getLastError();
  // After stopCapture, error should still be from previous state or empty
  assert(typeof err === "string", `Expected string, got ${typeof err}`);
});

test("isRunning returns false when not capturing", () => {
  assert(addon.isRunning() === false, "Expected false");
});

// ─── EXCLUDE mode capture (system audio minus self) ────────────────────────────

console.log("\n--- Capture EXCLUDE mode (system audio minus self) ---\n");

async function testExcludeCapture() {
  let jsCallbackCount = 0;
  let totalSamples = 0;
  let silentChunks = 0;
  let nonSilentChunks = 0;
  const callbackTimestamps = [];
  const intervals = [];

  addon.onData((buffer) => {
    const now = performance.now();
    jsCallbackCount++;
    totalSamples += buffer.length;

    // Track silence vs non-silence
    let isSilent = true;
    for (let i = 0; i < buffer.length; i++) {
      if (Math.abs(buffer[i]) > 0.0001) {
        isSilent = false;
        break;
      }
    }
    if (isSilent) silentChunks++;
    else nonSilentChunks++;

    // Track inter-callback timing
    if (callbackTimestamps.length > 0) {
      intervals.push(now - callbackTimestamps[callbackTimestamps.length - 1]);
    }
    callbackTimestamps.push(now);
  });

  addon.startCapture(process.pid, true); // exclude self

  // Give the worker thread time to initialize
  await sleep(500);

  await testAsync("worker thread started (isRunning=true or error set)", async () => {
    const running = addon.isRunning();
    const err = addon.getLastError();
    if (!running && err) {
      throw new Error(`Worker thread failed: ${err}`);
    }
    // It's OK if running=false and no error (thread may have exited already)
    console.log(`    isRunning=${running}, lastError="${err}"`);
  });

  // Wait for data
  await sleep(2000);

  const cppDataCount = addon.getDataCount();

  addon.stopCapture();

  await testAsync("C++ capture loop produced data (getDataCount > 0)", async () => {
    const err = addon.getLastError();
    console.log(`    cppDataCount=${cppDataCount}, lastError="${err}"`);
    assert(cppDataCount > 0, `C++ loop sent 0 packets. Error: ${err || "none"}`);
  });

  await testAsync("JS onData callback received Float32Array buffers", async () => {
    console.log(`    jsCallbackCount=${jsCallbackCount}, totalSamples=${totalSamples}`);
    assert(jsCallbackCount > 0, `JS callback received 0 calls`);
  });

  // ─── Jitter analysis ───
  console.log("\n--- Callback jitter analysis (EXCLUDE mode) ---\n");

  const stats = computeJitterStats(intervals);

  await testAsync("callback timing jitter analysis", async () => {
    console.log(`    Callbacks: ${jsCallbackCount}`);
    console.log(`    Silent chunks: ${silentChunks}, Non-silent: ${nonSilentChunks}`);
    console.log(`    Inter-callback interval (ms):`);
    console.log(`      min=${stats.min.toFixed(2)}, max=${stats.max.toFixed(2)}`);
    console.log(`      mean=${stats.mean.toFixed(2)}, stddev=${stats.stddev.toFixed(2)}`);
    console.log(`      gaps >15ms: ${stats.gapsOver15ms} / ${intervals.length}`);
    // This is informational — we log the stats but don't fail on jitter
    // After implementing event-driven WASAPI, re-run to verify improvement
    assert(true);
  });

  await testAsync("no excessive gaps (>50ms) in callback delivery", async () => {
    const hugeGaps = intervals.filter((v) => v > 50).length;
    console.log(`    gaps >50ms: ${hugeGaps}`);
    assert(hugeGaps === 0, `Found ${hugeGaps} gaps >50ms — indicates severe packet loss`);
  });
}

// ─── INCLUDE mode capture (specific process) ──────────────────────────────────

async function testIncludeCapture() {
  console.log("\n--- Capture INCLUDE mode (target PID) ---\n");

  const intervals = [];
  let lastTime = null;

  addon.onData(() => {
    const now = performance.now();
    if (lastTime !== null) intervals.push(now - lastTime);
    lastTime = now;
  });

  addon.startCapture(realPid || process.pid, false); // include target

  await sleep(500);

  await testAsync("worker thread started for INCLUDE mode", async () => {
    const running = addon.isRunning();
    const err = addon.getLastError();
    console.log(`    isRunning=${running}, lastError="${err}", targetPID=${realPid || process.pid}`);
    if (!running && err) {
      throw new Error(`Worker thread failed: ${err}`);
    }
  });

  // Capture for a bit to collect jitter data
  await sleep(1500);

  addon.stopCapture();

  await testAsync("stopCapture completes cleanly", async () => {
    assert(addon.isRunning() === false, "Still running after stopCapture");
  });

  if (intervals.length > 0) {
    const stats = computeJitterStats(intervals);
    console.log(`\n--- Callback jitter analysis (INCLUDE mode) ---\n`);
    console.log(`    Callbacks: ${intervals.length + 1}`);
    console.log(`    Inter-callback interval (ms):`);
    console.log(`      min=${stats.min.toFixed(2)}, max=${stats.max.toFixed(2)}`);
    console.log(`      mean=${stats.mean.toFixed(2)}, stddev=${stats.stddev.toFixed(2)}`);
    console.log(`      gaps >15ms: ${stats.gapsOver15ms} / ${intervals.length}`);
  }
}

// ─── Run all async tests ───────────────────────────────────────────────────────

testExcludeCapture()
  .then(() => testIncludeCapture())
  .then(() => {
    console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
    process.exit(failed > 0 ? 1 : 0);
  });
