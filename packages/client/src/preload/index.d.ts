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
    hwnd: number;
    title: string;
    pid: number;
    exe: string;
  }

  interface DisplaySource {
    id: number;
    name: string;
    width: number;
    height: number;
    primary: boolean;
  }

  interface ScreenSources {
    windows: WindowSource[];
    displays: DisplaySource[];
  }

  interface VideoPacketData {
    data: Uint8Array;
    timestampUs: number;
    keyframe: boolean;
  }

  interface AudioPacketData {
    data: Uint8Array;
    timestampUs: number;
    samples: number;
  }

  interface ScreenAPI {
    getSources: () => Promise<ScreenSources>;
    start: (options: {
      targetType: string;
      targetId: number;
      fps: number;
      bitrate: number;
      cursor?: boolean;
      audioPid?: number;
    }) => Promise<void>;
    stop: () => void;
    onVideoPacket: (cb: (packet: VideoPacketData) => void) => () => void;
    onAudioPacket: (cb: (packet: AudioPacketData) => void) => () => void;
    onError: (cb: (message: string) => void) => () => void;
    onStopped: (cb: () => void) => () => void;
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
