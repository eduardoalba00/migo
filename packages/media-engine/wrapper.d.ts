export function version(): string;

export interface JsDisplayInfo {
  index: number;
  name: string;
  width: number;
  height: number;
}

export interface JsWindowInfo {
  handle: number;
  title: string;
  processName: string;
}

export interface JsScreenShareConfig {
  /** LiveKit server URL (e.g., "ws://localhost:7880"). */
  serverUrl: string;
  /** LiveKit access token. */
  token: string;
  /** Capture target type: "primary", "display", or "window". */
  targetType: "primary" | "display" | "window";
  /** Display index (for "display") or window handle (for "window"). */
  targetId?: number;
  /** Target FPS. */
  fps: number;
  /** Target bitrate in bits/sec. */
  bitrate: number;
  /** Whether to show cursor in capture. */
  showCursor: boolean;
  /** Whether to capture system audio. */
  captureAudio: boolean;
  /** Audio mode: "system" or process PID as string. */
  audioMode?: string;
}

export interface JsEngineStats {
  fps: number;
  encodeMs: number;
  bitrateMbps: number;
  framesEncoded: number;
  bytesSent: number;
}

export function listDisplays(): JsDisplayInfo[];
export function listWindows(): JsWindowInfo[];

export function startScreenShare(
  config: JsScreenShareConfig,
  onError: (error: string) => void,
  onStopped: () => void,
  onStats: (stats: JsEngineStats) => void,
): Promise<void>;

export function stopScreenShare(): void;
export function forceKeyframe(): void;
export function isScreenShareRunning(): boolean;
