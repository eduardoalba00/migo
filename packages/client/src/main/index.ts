import { app, shell, BrowserWindow, ipcMain } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;

// Keep GPU rasterization + video decode flags for the receiver
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-accelerated-video-decode");

if (process.env.MIGO_INSTANCE) {
  app.setPath("userData", app.getPath("userData") + "-" + process.env.MIGO_INSTANCE);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mediaEngine = require("@migo/media-engine");

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

  // --- Screen capture via media-engine ---

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

  ipcMain.handle("screen:getSources", () => ({
    windows: mediaEngine.listWindows().filter((w: any) => {
      if (HIDDEN_PROCESS_NAMES.has(w.processName.toLowerCase())) return false;
      return true;
    }),
    displays: mediaEngine.listDisplays(),
  }));

  ipcMain.handle("screen:start", async (_event, options) => {
    if (mediaEngine.isScreenShareRunning()) {
      mediaEngine.stopScreenShare();
    }

    console.log("[media-engine] startScreenShare:", JSON.stringify({
      serverUrl: options.serverUrl,
      targetType: options.targetType, targetId: options.targetId,
      fps: options.fps, bitrate: options.bitrate,
      captureAudio: options.captureAudio,
    }));

    try {
      await mediaEngine.startScreenShare(
        {
          serverUrl: options.serverUrl,
          token: options.token,
          targetType: options.targetType,
          targetId: options.targetId,
          fps: options.fps,
          bitrate: options.bitrate,
          showCursor: options.cursor ?? true,
          captureAudio: options.captureAudio ?? false,
        },
        // NAPI-RS ThreadsafeFunction uses error-first callbacks:
        // Ok(value) → callback(null, value), Err(e) → callback(e)
        (...args: any[]) => {
          const error = args[0] ?? args[1] ?? "Unknown error";
          console.error("[media-engine] onError:", error);
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send("screen:error", String(error));
          }
        },
        (...args: any[]) => {
          console.log("[media-engine] onStopped");
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send("screen:stopped");
          }
        },
        (...args: any[]) => {
          // stats is in args[1] (error-first) or args[0]
          const stats = args[1] ?? args[0];
          if (stats) {
            console.log(`[media-engine] stats: ${stats.fps?.toFixed(1)}fps, encode=${stats.encodeMs?.toFixed(1)}ms, bitrate=${stats.bitrateMbps?.toFixed(1)}Mbps, frames=${stats.framesEncoded}, sent=${stats.bytesSent}`);
          }
          if (stats && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("screen:stats", stats);
          }
        },
      );
      console.log("[media-engine] startScreenShare resolved successfully");
    } catch (err: any) {
      console.error("[media-engine] startScreenShare rejected:", err);
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send("screen:error", err?.message ?? String(err));
      }
    }
  });

  ipcMain.on("screen:stop", () => {
    mediaEngine.stopScreenShare();
  });

  ipcMain.on("screen:forceKeyframe", () => {
    mediaEngine.forceKeyframe();
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
