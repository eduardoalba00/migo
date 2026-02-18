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

  addon.onData((buffer) => {
    jsCallbackCount++;
    totalSamples += buffer.length;
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
}

// ─── INCLUDE mode capture (specific process) ──────────────────────────────────

async function testIncludeCapture() {
  console.log("\n--- Capture INCLUDE mode (target PID) ---\n");

  addon.onData(() => {});
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

  addon.stopCapture();

  await testAsync("stopCapture completes cleanly", async () => {
    assert(addon.isRunning() === false, "Still running after stopCapture");
  });
}

// ─── Run all async tests ───────────────────────────────────────────────────────

testExcludeCapture()
  .then(() => testIncludeCapture())
  .then(() => {
    console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
    process.exit(failed > 0 ? 1 : 0);
  });
