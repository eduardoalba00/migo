// Test the WASAPI addon inside Electron's main process.
// Run with: npx electron src/native/test-capture-electron.cjs
const path = require("path");
const { app } = require("electron");

const ADDON_PATH = path.join(__dirname, "../../build/Release/audio_capture.node");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.whenReady().then(async () => {
  console.log("--- Electron WASAPI test ---\n");

  // Load addon
  const mod = { exports: {} };
  process.dlopen(mod, ADDON_PATH);
  const addon = mod.exports;
  console.log("Addon loaded, exports:", Object.keys(addon));

  // Set up data callback
  let count = 0;
  let samples = 0;
  addon.onData((buffer) => {
    count++;
    samples += buffer.length;
  });

  // Try EXCLUDE mode (capture system audio except self)
  console.log("\nStarting capture (EXCLUDE self, PID=" + process.pid + ")...");
  try {
    addon.startCapture(process.pid, true);
    console.log("startCapture succeeded, isRunning:", addon.isRunning());
  } catch (err) {
    console.log("startCapture FAILED:", err.message);
    console.log("lastError:", addon.getLastError());
    app.quit();
    return;
  }

  // Wait 2 seconds
  await sleep(2000);

  console.log("\nAfter 2s:");
  console.log("  isRunning:", addon.isRunning());
  console.log("  cppDataCount:", addon.getDataCount());
  console.log("  jsCallbackCount:", count);
  console.log("  totalSamples:", samples);
  console.log("  lastError:", addon.getLastError());

  addon.stopCapture();
  console.log("\nCapture stopped. Test complete.");
  app.quit();
});
