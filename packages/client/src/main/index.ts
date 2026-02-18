import { app, shell, BrowserWindow, ipcMain, desktopCapturer } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;

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
    // In production, asarUnpack puts .node files in app.asar.unpacked/
    const appPath = app.isPackaged
      ? app.getAppPath().replace("app.asar", "app.asar.unpacked")
      : app.getAppPath();
    const addonPath = join(appPath, "build", "Release", "audio_capture.node");
    const mod = { exports: {} as AudioCaptureAddon };
    process.dlopen(mod, addonPath);
    audioCapture = mod.exports;
  } catch {
    // Not available (macOS, or addon not compiled)
  }
  return audioCapture;
}

// GPU acceleration for video decode
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-accelerated-video-decode");

if (process.env.MIGO_INSTANCE) {
  app.setPath("userData", app.getPath("userData") + "-" + process.env.MIGO_INSTANCE);
}

// System executables to hide from the screen share picker
const HIDDEN_PROCESS_NAMES = new Set([
  "textinputhost.exe",
  "applicationframehost.exe",
  "searchhost.exe",
  "startmenuexperiencehost.exe",
  "shellexperiencehost.exe",
  "lockapp.exe",
  "systemsettings.exe",
]);

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      contextIsolation: true,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
    if (is.dev) mainWindow.webContents.openDevTools();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // Enable getDisplayMedia() for screen share via LiveKit SDK.
  // Store the pending source selection so the handler can provide it.
  let pendingScreenSource: Electron.DesktopCapturerSource | null = null;

  mainWindow.webContents.session.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      if (pendingScreenSource) {
        callback({ video: pendingScreenSource });
        pendingScreenSource = null;
      } else {
        // Fallback: auto-select primary display
        const sources = await desktopCapturer.getSources({ types: ["screen"] });
        callback({ video: sources[0] });
      }
    },
  );

  // Pre-select a source before getDisplayMedia() is called
  ipcMain.handle("screen:selectSource", async (_event, targetType?: string, targetId?: number) => {
    const types: Array<"screen" | "window"> =
      targetType === "window" ? ["window"] : ["screen"];
    const sources = await desktopCapturer.getSources({
      types,
      thumbnailSize: { width: 0, height: 0 },
    });

    if (targetType === "window") {
      // Match by source name — desktopCapturer window names are the window titles
      const allWindows = await desktopCapturer.getSources({
        types: ["window"],
        thumbnailSize: { width: 0, height: 0 },
      });
      // targetId is the index into our filtered list; find the matching source
      pendingScreenSource = allWindows[targetId ?? 0] ?? sources[0] ?? null;
    } else {
      const idx = targetId ?? 0;
      pendingScreenSource = sources[idx] ?? sources[0] ?? null;
    }

    return pendingScreenSource ? pendingScreenSource.id : null;
  });

  // List available screens and windows for the picker
  ipcMain.handle("screen:getSources", async () => {
    const [screenSources, windowSources] = await Promise.all([
      desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } }),
      desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 0, height: 0 } }),
    ]);

    const displays = screenSources.map((s, i) => ({
      id: s.id,
      name: s.name,
      index: i,
    }));

    const windows = windowSources
      .filter((s) => {
        // Filter out system processes by checking the source name
        const lower = s.name.toLowerCase();
        for (const hidden of HIDDEN_PROCESS_NAMES) {
          if (lower.includes(hidden.replace(".exe", ""))) return false;
        }
        return true;
      })
      .map((s, i) => ({
        id: s.id,
        name: s.name,
        index: i,
      }));

    return { displays, windows };
  });

  // ─── Audio capture IPC (WASAPI process loopback) ──────────────────────────

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

  // IPC handlers for frameless window controls
  ipcMain.on("window:minimize", () => mainWindow.minimize());
  ipcMain.on("window:maximize", () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.on("window:close", () => mainWindow.close());
  ipcMain.handle("window:isMaximized", () => mainWindow.isMaximized());

  mainWindow.on("maximize", () => {
    mainWindow.webContents.send("window:maximized-change", true);
  });
  mainWindow.on("unmaximize", () => {
    mainWindow.webContents.send("window:maximized-change", false);
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return mainWindow;
}

function setupAutoUpdater(mainWindow: BrowserWindow): void {
  if (is.dev) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (channel: string, data: unknown) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  };

  autoUpdater.on("checking-for-update", () => {
    send("updater:status", { status: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    send("updater:status", { status: "available", version: info.version });
  });

  autoUpdater.on("update-not-available", () => {
    send("updater:status", { status: "not-available" });
  });

  autoUpdater.on("download-progress", (progress) => {
    send("updater:progress", {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    send("updater:status", { status: "downloaded", version: info.version });
  });

  autoUpdater.on("error", (err) => {
    send("updater:status", { status: "error", error: err.message });
  });

  ipcMain.on("updater:install", () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle("updater:check", () => {
    return autoUpdater.checkForUpdates();
  });

  ipcMain.handle("updater:getVersion", () => {
    return app.getVersion();
  });

  // Re-check for updates every 5 minutes during long sessions
  // (initial check is triggered by the renderer after it mounts)
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5 * 60 * 1000);
}

app.whenReady().then(() => {
  const mainWindow = createWindow();
  setupAutoUpdater(mainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const win = createWindow();
      setupAutoUpdater(win);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
