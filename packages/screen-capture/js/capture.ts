import type { CaptureOptions } from "./types.js";

// NativeCapture is loaded from the napi-rs addon at runtime
let nativeBinding: any;

try {
  nativeBinding = require("../screen-capture.node");
} catch {
  // In dev, the addon may be at a different path depending on build mode
  try {
    nativeBinding = require("../index.node");
  } catch {
    throw new Error(
      "@migo/screen-capture: Failed to load native addon. Run `pnpm build` in packages/screen-capture first.",
    );
  }
}

const { NativeCapture: NativeCaptureClass } = nativeBinding;

export class ScreenCapture {
  private native: InstanceType<typeof NativeCaptureClass>;
  private generator: any; // MediaStreamTrackGenerator
  private writer: WritableStreamDefaultWriter | null = null;
  private running = false;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private frameInterval: number;

  constructor(options: CaptureOptions) {
    const maxWidth = options.maxWidth ?? 1920;
    const maxHeight = options.maxHeight ?? 1080;
    const maxFrameRate = options.maxFrameRate ?? 60;

    this.native = new NativeCaptureClass(options.sourceId, maxWidth, maxHeight, maxFrameRate);
    this.frameInterval = Math.floor(1000 / maxFrameRate);

    // MediaStreamTrackGenerator is available in Chromium (Electron)
    const Generator = (globalThis as any).MediaStreamTrackGenerator;
    if (!Generator) {
      throw new Error("MediaStreamTrackGenerator is not available in this environment");
    }
    this.generator = new Generator({ kind: "video" });
    this.writer = this.generator.writable.getWriter();
  }

  async start(): Promise<MediaStreamTrack> {
    this.native.start();
    this.running = true;
    this.captureLoop();
    return this.generator as MediaStreamTrack;
  }

  private captureLoop() {
    if (!this.running) return;

    const buffer = this.native.getFrame();
    if (buffer && this.writer) {
      try {
        const frame = new VideoFrame(buffer, {
          format: "BGRA",
          codedWidth: this.native.width,
          codedHeight: this.native.height,
          timestamp: performance.now() * 1000, // microseconds
        });
        this.writer.write(frame);
        frame.close();
      } catch {
        // Frame creation can fail if dimensions change mid-capture
      }
    }

    // Use setTimeout for precise frame timing rather than requestAnimationFrame
    // since we want consistent capture rate independent of renderer vsync
    this.loopTimer = setTimeout(() => this.captureLoop(), this.frameInterval);
  }

  stop() {
    this.running = false;
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    this.native.stop();
    if (this.writer) {
      this.writer.close().catch(() => {});
      this.writer = null;
    }
    if (this.generator) {
      this.generator.stop();
    }
  }
}
