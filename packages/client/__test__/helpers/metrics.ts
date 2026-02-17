/**
 * Track frame timestamps and compute metrics.
 */
export class FrameMetrics {
  private timestamps: number[] = [];
  private byteCounts: number[] = [];

  record(timestampUs: number, bytes: number): void {
    this.timestamps.push(timestampUs);
    this.byteCounts.push(bytes);
  }

  get frameCount(): number {
    return this.timestamps.length;
  }

  get totalBytes(): number {
    return this.byteCounts.reduce((sum, b) => sum + b, 0);
  }

  get fps(): number {
    if (this.timestamps.length < 2) return 0;
    const durationUs =
      this.timestamps[this.timestamps.length - 1] - this.timestamps[0];
    if (durationUs <= 0) return 0;
    return ((this.timestamps.length - 1) / durationUs) * 1_000_000;
  }

  get intervals(): number[] {
    const intervals: number[] = [];
    for (let i = 1; i < this.timestamps.length; i++) {
      intervals.push((this.timestamps[i] - this.timestamps[i - 1]) / 1000);
    }
    return intervals;
  }

  get jitterMs(): number {
    const ints = this.intervals;
    if (ints.length < 2) return 0;
    const mean = ints.reduce((s, v) => s + v, 0) / ints.length;
    const variance =
      ints.reduce((s, v) => s + (v - mean) ** 2, 0) / ints.length;
    return Math.sqrt(variance);
  }

  droppedFrames(expectedFps: number): number {
    const expectedIntervalMs = 1000 / expectedFps;
    const threshold = expectedIntervalMs * 2;
    return this.intervals.filter((i) => i > threshold).length;
  }

  percentile(p: number): number {
    const sorted = [...this.intervals].sort((a, b) => a - b);
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }
}
