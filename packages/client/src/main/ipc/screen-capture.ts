import {
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  screen,
  globalShortcut,
} from "electron";

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

export function registerScreenCaptureIPC(mainWindow: BrowserWindow): void {
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
  ipcMain.handle(
    "screen:selectSource",
    async (_event, targetType?: string, targetId?: number) => {
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
    },
  );

  // List available screens and windows for the picker
  ipcMain.handle("screen:getSources", async () => {
    const [screenSources, windowSources] = await Promise.all([
      desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 },
      }),
      desktopCapturer.getSources({
        types: ["window"],
        thumbnailSize: { width: 0, height: 0 },
      }),
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

  // --- Clip shortcut (Ctrl+Shift+C) ---
  let clipShortcutRegistered = false;

  ipcMain.handle("screen:registerClipShortcut", () => {
    if (clipShortcutRegistered) return;
    const registered = globalShortcut.register(
      "CommandOrControl+Shift+C",
      () => {
        mainWindow.webContents.send("screen:clip-triggered");
      },
    );
    clipShortcutRegistered = registered;
    return registered;
  });

  ipcMain.handle("screen:unregisterClipShortcut", () => {
    if (clipShortcutRegistered) {
      globalShortcut.unregister("CommandOrControl+Shift+C");
      clipShortcutRegistered = false;
    }
  });

  // --- Clip notification overlay ---
  let clipNotificationWindow: BrowserWindow | null = null;

  ipcMain.handle("screen:showClipNotification", () => {
    // Close any existing notification
    if (clipNotificationWindow && !clipNotificationWindow.isDestroyed()) {
      clipNotificationWindow.close();
      clipNotificationWindow = null;
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width } = primaryDisplay.workAreaSize;
    const notifWidth = 300;
    const notifHeight = 60;

    clipNotificationWindow = new BrowserWindow({
      width: notifWidth,
      height: notifHeight,
      x: Math.round(width / 2 - notifWidth / 2),
      y: 20,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focusable: false,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // Prevent the notification from stealing focus
    clipNotificationWindow.setAlwaysOnTop(true, "screen-saver");

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: transparent;
            overflow: hidden;
            -webkit-app-region: no-drag;
          }
          .notification {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            background: rgba(30, 30, 30, 0.92);
            color: #fff;
            border-radius: 12px;
            padding: 12px 24px;
            font-size: 14px;
            font-weight: 500;
            backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            animation: slideDown 0.3s ease-out, fadeOut 0.4s ease-in 2.3s forwards;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
          }
          .icon { font-size: 18px; }
          @keyframes slideDown {
            from { transform: translateY(-20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
          @keyframes fadeOut {
            from { opacity: 1; }
            to { opacity: 0; }
          }
        </style>
      </head>
      <body>
        <div class="notification">
          <span class="icon">🎬</span>
          <span>Clip saved!</span>
        </div>
      </body>
      </html>
    `;

    clipNotificationWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );

    clipNotificationWindow.once("ready-to-show", () => {
      clipNotificationWindow?.showInactive();
    });

    // Auto-close after 3 seconds
    setTimeout(() => {
      if (clipNotificationWindow && !clipNotificationWindow.isDestroyed()) {
        clipNotificationWindow.close();
        clipNotificationWindow = null;
      }
    }, 3000);
  });

  ipcMain.handle("screen:getDisplayIndex", (_event, sourceId: string) => {
    // desktopCapturer source IDs for screens: "screen:0:0", "screen:1:0", etc.
    // The first number after "screen:" is the display index
    const match = sourceId.match(/^screen:(\d+):/);
    if (match) {
      return parseInt(match[1], 10);
    }
    // Fallback: primary display
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    return displays.indexOf(primary);
  });
}
