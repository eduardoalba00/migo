import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { OVERLAY_HTML, OVERLAY_SCRIPT } from "./overlay-renderer";

let overlayWindow: BrowserWindow | null = null;

export function createOverlayWindow(displayIndex: number): BrowserWindow | null {
  // Always recreate to avoid stale state
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
    overlayWindow = null;
  }

  const displays = screen.getAllDisplays();
  const display = displays[displayIndex];
  if (!display) return null;

  const { x, y, width, height } = display.bounds;

  overlayWindow = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    resizable: false,
    type: "toolbar",
    webPreferences: {
      preload: join(__dirname, "../preload/overlay-preload.mjs"),
      sandbox: false,
      contextIsolation: true,
    },
  });

  overlayWindow.setAlwaysOnTop(true, "pop-up-menu");
  overlayWindow.setIgnoreMouseEvents(true);

  overlayWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(OVERLAY_HTML));
  overlayWindow.webContents.on("did-finish-load", () => {
    overlayWindow?.webContents.executeJavaScript(OVERLAY_SCRIPT).catch(() => {});
  });

  // Auto-resize if display metrics change
  const onDisplayChange = () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    const updated = screen.getAllDisplays()[displayIndex];
    if (updated) overlayWindow.setBounds(updated.bounds);
  };
  screen.on("display-metrics-changed", onDisplayChange);

  overlayWindow.on("closed", () => {
    screen.removeListener("display-metrics-changed", onDisplayChange);
    overlayWindow = null;
  });

  return overlayWindow;
}

export function destroyOverlayWindow(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
    overlayWindow = null;
  }
}

export function sendAnnotationEvents(events: unknown[]): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("overlay:annotation-events", events);
  }
}
