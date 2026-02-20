import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "path";

// WASAPI process audio capture (Windows only)
type AudioCaptureAddon = {
  startCapture: (pid: number, excludeMode: boolean) => void;
  stopCapture: () => void;
  onData: (callback: (buffer: Float32Array) => void) => void;
  hwndToPid: (hwnd: number) => number;
};
let audioCapture: AudioCaptureAddon | null = null;
let addonLoadAttempted = false;

function loadAudioCapture(): AudioCaptureAddon | null {
  if (addonLoadAttempted) return audioCapture;
  addonLoadAttempted = true;
  if (process.platform !== "win32") return null;
  try {
    // In production, extraResources places the .node file in resources/
    // In dev, it's at the project root build/Release/
    const addonPath = app.isPackaged
      ? join(process.resourcesPath, "audio_capture.node")
      : join(app.getAppPath(), "build", "Release", "audio_capture.node");
    const mod = { exports: {} as AudioCaptureAddon };
    process.dlopen(mod, addonPath);
    audioCapture = mod.exports;
  } catch {
    // Not available (macOS, or addon not compiled)
  }
  return audioCapture;
}

export function registerAudioCaptureIPC(mainWindow: BrowserWindow): void {
  ipcMain.handle("audio-capture:isAvailable", () => !!loadAudioCapture());

  ipcMain.handle(
    "audio-capture:start",
    async (_event, sourceId: string, sourceType: "window" | "screen") => {
      const addon = loadAudioCapture();
      if (!addon) return false;

      try {
        let pid: number;
        let excludeMode: boolean;

        if (sourceType === "window") {
          const parts = sourceId.split(":");
          const hwnd = parseInt(parts[1], 10);
          pid = addon.hwndToPid(hwnd);
          if (!pid) throw new Error(`Could not resolve PID for HWND ${hwnd}`);
          excludeMode = false; // INCLUDE target process tree
        } else {
          pid = process.pid;
          excludeMode = true; // EXCLUDE self
        }

        // Set up data callback BEFORE starting capture (worker thread needs it)
        addon.onData((buffer: Float32Array) => {
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send("audio-capture:data", buffer.buffer);
          }
        });

        // Start capture on a dedicated MTA thread (returns immediately)
        addon.startCapture(pid, excludeMode);

        return true;
      } catch (err) {
        console.error("audio-capture:start failed:", err);
        return false;
      }
    },
  );

  ipcMain.handle("audio-capture:stop", () => {
    if (!audioCapture) return;
    try {
      audioCapture.stopCapture();
    } catch (err) {
      console.error("audio-capture:stop failed:", err);
    }
  });
}
