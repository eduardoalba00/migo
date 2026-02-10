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
  getSources: () => ipcRenderer.invoke("screen:getSources") as Promise<
    Array<{ id: string; name: string; thumbnail: string; display_id: string }>
  >,
};

contextBridge.exposeInMainWorld("screenAPI", screenAPI);
