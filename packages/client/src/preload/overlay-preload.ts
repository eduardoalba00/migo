import { contextBridge, ipcRenderer } from "electron";

const overlayAPI = {
  onAnnotationEvents: (callback: (events: any[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, events: any[]) => callback(events);
    ipcRenderer.on("overlay:annotation-events", handler);
    return () => ipcRenderer.removeListener("overlay:annotation-events", handler);
  },
  onClear: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("overlay:clear", handler);
    return () => ipcRenderer.removeListener("overlay:clear", handler);
  },
};

contextBridge.exposeInMainWorld("overlayAPI", overlayAPI);
