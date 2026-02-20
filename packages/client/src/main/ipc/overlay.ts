import { ipcMain } from "electron";
import { createOverlayWindow, destroyOverlayWindow, sendAnnotationEvents } from "../overlay-window";

export function registerOverlayIPC(): void {
  ipcMain.handle("overlay:create", (_event, displayIndex: number) => {
    return !!createOverlayWindow(displayIndex);
  });

  ipcMain.handle("overlay:destroy", () => {
    destroyOverlayWindow();
  });

  ipcMain.on("overlay:forward-events", (_event, events: any[]) => {
    sendAnnotationEvents(events);
  });
}
