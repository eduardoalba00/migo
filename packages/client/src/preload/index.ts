import { contextBridge, ipcRenderer } from "electron";

const windowAPI = {
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  onMaximizedChange: (callback: (maximized: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized);
    ipcRenderer.on("window:maximized-change", handler);
    return () => ipcRenderer.removeListener("window:maximized-change", handler);
  },
};

contextBridge.exposeInMainWorld("windowAPI", windowAPI);

const screenAPI = {
  getSources: () => ipcRenderer.invoke("screen:getSources"),
  selectSource: (targetType?: string, targetId?: number) =>
    ipcRenderer.invoke("screen:selectSource", targetType, targetId) as Promise<string | null>,
};

contextBridge.exposeInMainWorld("screenAPI", screenAPI);

const updaterAPI = {
  onStatus: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("updater:status", handler);
    return () => ipcRenderer.removeListener("updater:status", handler);
  },
  onProgress: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("updater:progress", handler);
    return () => ipcRenderer.removeListener("updater:progress", handler);
  },
  install: () => ipcRenderer.send("updater:install"),
  check: () => ipcRenderer.invoke("updater:check"),
  getVersion: () => ipcRenderer.invoke("updater:getVersion") as Promise<string>,
};

contextBridge.exposeInMainWorld("updaterAPI", updaterAPI);

const audioCaptureAPI = {
  isAvailable: () => ipcRenderer.invoke("audio-capture:isAvailable") as Promise<boolean>,
  start: (sourceId: string, sourceType: "window" | "screen") =>
    ipcRenderer.invoke("audio-capture:start", sourceId, sourceType) as Promise<boolean>,
  stop: () => ipcRenderer.invoke("audio-capture:stop") as Promise<void>,
  onData: (callback: (buffer: Float32Array) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, buf: ArrayBuffer) =>
      callback(new Float32Array(buf));
    ipcRenderer.on("audio-capture:data", handler);
    return () => ipcRenderer.removeListener("audio-capture:data", handler);
  },
};

contextBridge.exposeInMainWorld("audioCaptureAPI", audioCaptureAPI);
