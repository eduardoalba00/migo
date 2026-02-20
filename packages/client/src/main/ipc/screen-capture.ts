import { BrowserWindow, ipcMain, desktopCapturer, screen } from "electron";

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
