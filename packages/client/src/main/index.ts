import { app, shell, BrowserWindow } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { destroyOverlayWindow } from "./overlay-window";
import { registerScreenCaptureIPC } from "./ipc/screen-capture";
import { registerAudioCaptureIPC } from "./ipc/audio-capture";
import { registerOverlayIPC } from "./ipc/overlay";
import { registerWindowControlsIPC } from "./ipc/window-controls";
import { checkForUpdatesSplash, setupRuntimeUpdater } from "./auto-updater";
import {
  createSplashWindow,
  splashSetStatus,
  splashSetProgress,
  splashSetVersion,
  splashHideProgress,
} from "./splash-window";

// GPU acceleration for video decode
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-accelerated-video-decode");
// Prevent Chromium from throttling when a game covers the Migo window
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

if (process.env.MIGO_INSTANCE) {
  app.setPath("userData", app.getPath("userData") + "-" + process.env.MIGO_INSTANCE);
}

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
      backgroundThrottling: false,
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

  registerScreenCaptureIPC(mainWindow);
  registerAudioCaptureIPC(mainWindow);
  registerOverlayIPC();
  registerWindowControlsIPC(mainWindow);

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return mainWindow;
}

function launchMainWindow(): void {
  const mainWindow = createWindow();
  if (!is.dev) {
    setupRuntimeUpdater(mainWindow);
  }
}

app.whenReady().then(async () => {
  if (is.dev) {
    // Dev mode: skip splash, open main window immediately
    launchMainWindow();
  } else {
    // Production: show splash, check for updates before opening main window
    const splash = createSplashWindow();

    splash.webContents.on("did-finish-load", () => {
      splashSetVersion(splash, app.getVersion());
    });

    const result = await checkForUpdatesSplash(
      (text) => splashSetStatus(splash, text),
      (percent) => splashSetProgress(splash, percent),
    );

    if (result === "no-update") {
      splashSetStatus(splash, "Launching...");
      splashHideProgress(splash);
      await new Promise((r) => setTimeout(r, 500));
      if (!splash.isDestroyed()) splash.close();
      launchMainWindow();
    }
    // "installing" — quitAndInstall handles the restart
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      launchMainWindow();
    }
  });
});

app.on("before-quit", () => {
  destroyOverlayWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
