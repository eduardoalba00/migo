/**
 * Screen capture utility for Electron.
 *
 * Uses Electron's desktopCapturer-compatible getUserMedia to capture
 * screen/window sources as MediaStreamTracks. The native @migo/screen-capture
 * addon (Rust + scap) can be integrated later for true 60fps capture by
 * replacing the getUserMedia call with the native frame pipeline.
 */

export interface CaptureOptions {
  sourceId: string;
  maxWidth?: number;
  maxHeight?: number;
  maxFrameRate?: number;
}

export const CapturePresets = {
  "1080p60": { maxWidth: 1920, maxHeight: 1080, maxFrameRate: 60 },
  "1440p60": { maxWidth: 2560, maxHeight: 1440, maxFrameRate: 60 },
  "4k30": { maxWidth: 3840, maxHeight: 2160, maxFrameRate: 30 },
} as const;

export type CapturePreset = keyof typeof CapturePresets;

export class ScreenCapture {
  private stream: MediaStream | null = null;
  private options: CaptureOptions;

  constructor(options: CaptureOptions) {
    this.options = options;
  }

  async start(): Promise<MediaStreamTrack> {
    const { sourceId, maxWidth = 1920, maxHeight = 1080, maxFrameRate = 60 } = this.options;

    // Use Electron's desktopCapturer-compatible getUserMedia
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: sourceId,
          maxWidth,
          maxHeight,
          minFrameRate: maxFrameRate,
          maxFrameRate,
        },
      } as any,
    });

    const track = this.stream.getVideoTracks()[0];
    track.contentHint = "motion";
    return track;
  }

  stop(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
  }
}
