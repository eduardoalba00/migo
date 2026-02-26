import { app, BrowserWindow, ipcMain } from "electron";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;

/**
 * Phase 1: Splash-screen update check.
 * Resolves "no-update" if up-to-date or on error, "installing" if an update
 * was downloaded and quitAndInstall was called. Cleans up all listeners so
 * the autoUpdater singleton is clean for the runtime phase.
 */
export function checkForUpdatesSplash(
  onStatus: (text: string) => void,
  onProgress: (percent: number) => void,
): Promise<"no-update" | "installing"> {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  return new Promise((resolve) => {
    let settled = false;

    const settle = (result: "no-update" | "installing") => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      cleanup();
      resolve(result);
    };

    const onChecking = () => {
      onStatus("Checking for updates...");
    };

    const onAvailable = (info: { version: string }) => {
      onStatus(`Downloading v${info.version}...`);
    };

    const onNotAvailable = () => {
      settle("no-update");
    };

    const onDownloadProgress = (progress: { percent: number }) => {
      onProgress(progress.percent);
    };

    const onDownloaded = (info: { version: string }) => {
      onStatus(`Installing v${info.version}...`);
      settle("installing");
      setTimeout(() => {
        autoUpdater.quitAndInstall(true, true);
      }, 1500);
    };

    const onError = () => {
      settle("no-update");
    };

    function cleanup() {
      autoUpdater.removeListener("checking-for-update", onChecking);
      autoUpdater.removeListener("update-available", onAvailable);
      autoUpdater.removeListener("update-not-available", onNotAvailable);
      autoUpdater.removeListener("download-progress", onDownloadProgress);
      autoUpdater.removeListener("update-downloaded", onDownloaded);
      autoUpdater.removeListener("error", onError);
    }

    // Safety timeout — don't block launch if the update server is unreachable
    const timeoutId = setTimeout(() => {
      settle("no-update");
    }, 15_000);

    autoUpdater.on("checking-for-update", onChecking);
    autoUpdater.on("update-available", onAvailable);
    autoUpdater.on("update-not-available", onNotAvailable);
    autoUpdater.on("download-progress", onDownloadProgress);
    autoUpdater.on("update-downloaded", onDownloaded);
    autoUpdater.on("error", onError);

    autoUpdater.checkForUpdates().catch(() => {
      settle("no-update");
    });
  });
}

/**
 * Phase 2: Runtime updater for the main window.
 * Registers IPC handlers and periodic background checks.
 */
export function setupRuntimeUpdater(mainWindow: BrowserWindow): void {
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
    // Don't force-restart while the user is active.
    // autoInstallOnAppQuit ensures it installs on the next quit.
  });

  autoUpdater.on("error", (err) => {
    send("updater:status", { status: "error", error: err.message });
  });

  ipcMain.on("updater:install", () => {
    autoUpdater.quitAndInstall(true, true);
  });

  ipcMain.handle("updater:check", () => {
    return autoUpdater.checkForUpdates();
  });

  ipcMain.handle("updater:getVersion", () => {
    return app.getVersion();
  });

  // Periodic re-check (splash already did the initial check)
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5 * 60 * 1000);
}
