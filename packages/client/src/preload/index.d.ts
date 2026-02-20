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
    index: number;
  }

  interface ScreenSources {
    windows: ScreenSource[];
    displays: ScreenSource[];
  }

  interface ScreenAPI {
    getSources: () => Promise<ScreenSources>;
    selectSource: (targetType?: string, targetId?: number) => Promise<string | null>;
    getDisplayIndex: (sourceId: string) => Promise<number>;
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

  interface AudioCaptureAPI {
    isAvailable: () => Promise<boolean>;
    start: (sourceId: string, sourceType: "window" | "screen") => Promise<boolean>;
    stop: () => Promise<void>;
    onData: (callback: (buffer: Float32Array) => void) => () => void;
  }

  interface OverlayBridgeAPI {
    create: (displayIndex: number) => Promise<boolean>;
    destroy: () => Promise<void>;
    forwardEvents: (events: any[]) => void;
  }

  interface OverlayAPI {
    onAnnotationEvents: (callback: (events: any[]) => void) => () => void;
    onClear: (callback: () => void) => () => void;
  }

  interface Window {
    windowAPI: WindowAPI;
    screenAPI: ScreenAPI;
    updaterAPI: UpdaterAPI;
    audioCaptureAPI: AudioCaptureAPI;
    overlayBridgeAPI: OverlayBridgeAPI;
    overlayAPI: OverlayAPI;
  }
}
