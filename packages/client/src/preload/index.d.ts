export {};

declare global {
  interface WindowAPI {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
    onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
  }

  interface ScreenSource {
    id: string;
    name: string;
    thumbnail: string;
    display_id: string;
  }

  interface ScreenAPI {
    getSources: () => Promise<ScreenSource[]>;
  }

  interface UpdaterStatus {
    status: "checking" | "available" | "not-available" | "downloaded" | "error";
    version?: string;
    error?: string;
  }

  interface UpdaterProgress {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
  }

  interface UpdaterAPI {
    onStatus: (callback: (data: UpdaterStatus) => void) => () => void;
    onProgress: (callback: (data: UpdaterProgress) => void) => () => void;
    install: () => void;
    check: () => Promise<unknown>;
    getVersion: () => Promise<string>;
  }

  interface Window {
    windowAPI: WindowAPI;
    screenAPI: ScreenAPI;
    updaterAPI: UpdaterAPI;
  }
}
