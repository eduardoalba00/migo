/**
 * ReplayBuffer — continuously records a MediaStream into a rolling buffer
 * of WebM chunks, keeping the last ~30 seconds. On flush(), returns a single
 * Blob containing the buffered video, then restarts recording.
 */

const BUFFER_DURATION_MS = 30_000;
const CHUNK_INTERVAL_MS = 1_000;

interface TimedChunk {
  blob: Blob;
  timestamp: number;
}

export class ReplayBuffer {
  private recorder: MediaRecorder | null = null;
  private chunks: TimedChunk[] = [];
  private stream: MediaStream;
  private flushResolve: ((blob: Blob) => void) | null = null;

  constructor(stream: MediaStream) {
    this.stream = stream;
  }

  start(): void {
    if (this.recorder) return;
    this.chunks = [];
    this.createRecorder();
  }

  private createRecorder(): void {
    // Prefer VP9+Opus WebM, fall back to VP8
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";

    this.recorder = new MediaRecorder(this.stream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
    });

    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push({ blob: event.data, timestamp: Date.now() });
        this.pruneOldChunks();
      }
    };

    this.recorder.onstop = () => {
      // If a flush was requested, resolve the promise with the buffered data
      if (this.flushResolve) {
        const blob = new Blob(
          this.chunks.map((c) => c.blob),
          { type: this.recorder?.mimeType ?? "video/webm" },
        );
        this.flushResolve(blob);
        this.flushResolve = null;
        this.chunks = [];

        // Restart recording for future clips
        this.createRecorder();
      }
    };

    this.recorder.start(CHUNK_INTERVAL_MS);
  }

  private pruneOldChunks(): void {
    const cutoff = Date.now() - BUFFER_DURATION_MS;
    // Keep at least the first chunk (contains WebM header) and all recent chunks
    while (this.chunks.length > 1 && this.chunks[1].timestamp < cutoff) {
      this.chunks.shift();
    }
  }

  /**
   * Flush the buffer: stops the current recording, collects all chunks into
   * a single Blob, then restarts recording. Returns the WebM Blob.
   */
  async flush(): Promise<Blob> {
    if (!this.recorder || this.recorder.state !== "recording") {
      // Nothing to flush — return empty blob
      return new Blob([], { type: "video/webm" });
    }

    return new Promise<Blob>((resolve) => {
      this.flushResolve = resolve;
      // Request any pending data before stopping
      this.recorder!.requestData();
      this.recorder!.stop();
    });
  }

  stop(): void {
    if (this.recorder) {
      if (this.recorder.state !== "inactive") {
        try {
          this.recorder.stop();
        } catch {}
      }
      this.recorder = null;
    }
    this.chunks = [];
    this.flushResolve = null;
  }

  get isRecording(): boolean {
    return this.recorder?.state === "recording";
  }
}
