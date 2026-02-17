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
const buttercap = require("buttercap");

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

  // --- Screen capture via buttercap ---
  let captureSession: any = null;

  // System executables to hide from the screen share picker
  const HIDDEN_EXES = new Set([
    "textinputhost.exe",
    "applicationframehost.exe",
    "searchhost.exe",
    "startmenuexperiencehost.exe",
    "shellexperiencehost.exe",
    "lockapp.exe",
    "systemsettings.exe",
  ]);

  ipcMain.handle("screen:getSources", () => ({
    windows: buttercap.listWindows().filter((w: any) => {
      // Hide system windows and our own Electron windows
      if (HIDDEN_EXES.has(w.exe.toLowerCase())) return false;
      if (w.pid === process.pid) return false;
      return true;
    }),
    displays: buttercap.listDisplays(),
  }));

  ipcMain.handle("screen:start", (_event, options) => {
    if (captureSession) {
      captureSession.stop();
      captureSession = null;
    }

    // Per-process audio only works for processes with active audio sessions;
    // fall back to system audio for display capture, no audio for window capture for now.
    const audioMode = options.targetType === "display" ? "system" : "none";

    console.log("[buttercap] createSession:", JSON.stringify({
      target: { type: options.targetType, id: options.targetId },
      fps: options.fps, bitrate: options.bitrate, audioMode,
    }));

    // Log window info for debugging
    if (options.targetType === "window") {
      const wins = buttercap.listWindows();
      const match = wins.find((w: any) => w.hwnd === options.targetId);
      console.log("[buttercap] target window:", match ? JSON.stringify(match) : "NOT FOUND");
    }

    captureSession = buttercap.createSession({
      target: { type: options.targetType, id: options.targetId },
      video: {
        fps: options.fps,
        codec: "h264",
        preferHardware: true,
        bitrate: options.bitrate,
      },
      cursor: options.cursor ?? true,
      audio: { mode: audioMode },
    });

    captureSession.on("video-packet", (packet: any) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send("screen:video-packet", {
          data: new Uint8Array(packet.data),
          timestampUs: packet.timestampUs,
          keyframe: packet.keyframe,
        });
      }
    });

    captureSession.on("audio-packet", (packet: any) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send("screen:audio-packet", {
          data: new Uint8Array(packet.data),
          timestampUs: packet.timestampUs,
          samples: packet.samples,
        });
      }
    });

    captureSession.on("error", (err: Error) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send("screen:error", err.message);
      }
    });

    captureSession.on("stopped", () => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send("screen:stopped");
      }
      captureSession = null;
    });

    captureSession.start();
  });

  ipcMain.on("screen:stop", () => {
    captureSession?.stop();
    captureSession = null;
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
