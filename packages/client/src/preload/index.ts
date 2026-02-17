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
  start: (options: any) => ipcRenderer.invoke("screen:start", options),
  stop: () => ipcRenderer.send("screen:stop"),
  onVideoPacket: (cb: Function) => {
    const handler = (_e: any, packet: any) => cb(packet);
    ipcRenderer.on("screen:video-packet", handler);
    return () => ipcRenderer.removeListener("screen:video-packet", handler);
  },
  onAudioPacket: (cb: Function) => {
    const handler = (_e: any, packet: any) => cb(packet);
    ipcRenderer.on("screen:audio-packet", handler);
    return () => ipcRenderer.removeListener("screen:audio-packet", handler);
  },
  onError: (cb: Function) => {
    const handler = (_e: any, msg: string) => cb(msg);
    ipcRenderer.on("screen:error", handler);
    return () => ipcRenderer.removeListener("screen:error", handler);
  },
  onStopped: (cb: Function) => {
    const handler = () => cb();
    ipcRenderer.on("screen:stopped", handler);
    return () => ipcRenderer.removeListener("screen:stopped", handler);
  },
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
