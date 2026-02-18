export {};

declare global {
  interface WindowAPI {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
    onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
  }

  interface WindowSource {
    handle: number;
    title: string;
    processName: string;
  }

  interface DisplaySource {
    index: number;
    name: string;
    width: number;
    height: number;
  }

  interface ScreenSources {
    windows: WindowSource[];
    displays: DisplaySource[];
  }

  interface EngineStats {
    fps: number;
    encodeMs: number;
    bitrateMbps: number;
    framesEncoded: number;
    bytesSent: number;
  }

  interface ScreenAPI {
    getSources: () => Promise<ScreenSources>;
    start: (options: {
      serverUrl: string;
      token: string;
      targetType: string;
      targetId: number;
      fps: number;
      bitrate: number;
      cursor?: boolean;
      captureAudio?: boolean;
    }) => Promise<void>;
    stop: () => void;
    forceKeyframe: () => void;
    onError: (cb: (message: string) => void) => () => void;
    onStopped: (cb: () => void) => () => void;
    onStats: (cb: (stats: EngineStats) => void) => () => void;
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
