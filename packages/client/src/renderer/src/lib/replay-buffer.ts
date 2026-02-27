/**
 * ReplayBuffer — continuously records a MediaStream into a rolling buffer.
 * On flush(), returns a single valid WebM Blob, then restarts recording.
 *
 * Design: Each MediaRecorder session produces a complete, valid WebM file
 * (all chunks from a single start→stop cycle). We periodically restart the
 * recorder (~45s) to bound memory, keeping the previous complete segment as
 * fallback for clips requested shortly after a restart.
 *
 * Previous approach (prune old chunks, keep header) was broken because
 * removing clusters from the middle of a WebM creates timecode gaps that
 * cause players to freeze after the first cluster in the header.
 */

const SEGMENT_DURATION_MS = 45_000;
const CHUNK_INTERVAL_MS = 1_000;

export class ReplayBuffer {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream;
  private mimeType = "video/webm";

  // Flush coordination
  private flushResolve: ((blob: Blob) => void) | null = null;

  // Segment rotation: keep the previous complete recording as fallback
  private previousSegment: Blob | null = null;
  private segmentStartTime = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stopReason: "flush" | "rotate" | null = null;

  constructor(stream: MediaStream) {
    this.stream = stream;
  }

  start(): void {
    if (this.recorder) return;
    this.previousSegment = null;
    this.startRecorder();
  }

  private startRecorder(): void {
    this.mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
      ? "video/webm;codecs=vp8,opus"
      : "video/webm";

    this.recorder = new MediaRecorder(this.stream, {
      mimeType: this.mimeType,
      videoBitsPerSecond: 8_000_000,
    });

    this.chunks = [];
    this.segmentStartTime = Date.now();

    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };

    this.recorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: this.mimeType });
      this.chunks = [];

      if (this.stopReason === "flush") {
        const segmentAge = Date.now() - this.segmentStartTime;
        // If current segment is too short (<5s, e.g. just rotated), use previous
        if (segmentAge < 5_000 && this.previousSegment && this.previousSegment.size > 0) {
          this.flushResolve!(this.previousSegment);
        } else {
          this.flushResolve!(blob);
        }
        this.flushResolve = null;
        this.previousSegment = null;
        this.stopReason = null;
        this.startRecorder();
      } else if (this.stopReason === "rotate") {
        this.previousSegment = blob;
        this.stopReason = null;
        this.startRecorder();
      }
    };

    this.recorder.start(CHUNK_INTERVAL_MS);
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => this.rotateSegment(), SEGMENT_DURATION_MS);
  }

  private rotateSegment(): void {
    if (!this.recorder || this.recorder.state !== "recording") return;
    if (this.flushResolve) return; // Don't rotate during a pending flush

    this.stopReason = "rotate";
    this.recorder.requestData();
    this.recorder.stop();
  }

  /**
   * Flush the buffer: stops the current recording, returns the complete WebM
   * Blob, then restarts recording for future clips.
   */
  async flush(): Promise<Blob> {
    if (!this.recorder || this.recorder.state !== "recording") {
      if (this.previousSegment) {
        const blob = this.previousSegment;
        this.previousSegment = null;
        return blob;
      }
      return new Blob([], { type: "video/webm" });
    }

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    return new Promise<Blob>((resolve) => {
      this.flushResolve = resolve;
      this.stopReason = "flush";
      this.recorder!.requestData();
      this.recorder!.stop();
    });
  }

  stop(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.recorder) {
      if (this.recorder.state !== "inactive") {
        try {
          this.recorder.stop();
        } catch {}
      }
      this.recorder = null;
    }
    this.chunks = [];
    this.previousSegment = null;
    this.flushResolve = null;
    this.stopReason = null;
  }

  get isRecording(): boolean {
    return this.recorder?.state === "recording";
  }
}
