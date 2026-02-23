/**
 * Lock-free single-producer single-consumer ring buffer for interleaved stereo audio.
 *
 * Designed to be used in an AudioWorklet where:
 * - `onmessage` (producer) calls `write()`
 * - `process()` (consumer) calls `readStereoInterleaved()`
 *
 * Both run on the same AudioWorklet thread in Chromium, so no atomics needed,
 * but `available` is derived from positions (not a separate counter) to avoid drift.
 *
 * The buffer holds `size - 1` usable slots to distinguish full from empty.
 */
export class RingBuffer {
  private buffer: Float32Array;
  private writePos = 0;
  private readPos = 0;
  private _size: number;

  // Diagnostic counters
  private _overrunSamples = 0;
  private _underrunCount = 0;

  constructor(size: number) {
    this._size = size;
    this.buffer = new Float32Array(size);
  }

  /** Number of samples available to read. */
  get available(): number {
    const diff = this.writePos - this.readPos;
    return diff >= 0 ? diff : diff + this._size;
  }

  /** Number of samples that can be written before the buffer is full. */
  get free(): number {
    return this._size - 1 - this.available;
  }

  /** Total capacity (usable slots = size - 1). */
  get capacity(): number {
    return this._size - 1;
  }

  /** Cumulative count of samples dropped due to overrun. */
  get overrunSamples(): number {
    return this._overrunSamples;
  }

  /** Cumulative count of underrun events (process() called with insufficient data). */
  get underrunCount(): number {
    return this._underrunCount;
  }

  /**
   * Write interleaved stereo samples into the buffer.
   * @returns Number of samples dropped (0 if all fit).
   */
  write(data: Float32Array): number {
    const len = data.length;
    const freeSpace = this.free;
    const toWrite = Math.min(len, freeSpace);
    const dropped = len - toWrite;

    if (dropped > 0) {
      this._overrunSamples += dropped;
    }

    // Fast path: no wraparound
    const endPos = this.writePos + toWrite;
    if (endPos <= this._size) {
      this.buffer.set(data.subarray(0, toWrite), this.writePos);
      this.writePos = endPos === this._size ? 0 : endPos;
    } else {
      // Wraps around
      const firstChunk = this._size - this.writePos;
      this.buffer.set(data.subarray(0, firstChunk), this.writePos);
      const secondChunk = toWrite - firstChunk;
      this.buffer.set(data.subarray(firstChunk, firstChunk + secondChunk), 0);
      this.writePos = secondChunk;
    }

    return dropped;
  }

  /**
   * Read interleaved stereo samples into separate left/right channel buffers.
   * @returns `true` if enough data was available, `false` on underrun (outputs untouched).
   */
  readStereoInterleaved(left: Float32Array, right: Float32Array, frames: number): boolean {
    const samplesNeeded = frames * 2;
    if (this.available < samplesNeeded) {
      this._underrunCount++;
      return false;
    }

    for (let i = 0; i < frames; i++) {
      left[i] = this.buffer[this.readPos];
      this.readPos = (this.readPos + 1) % this._size;
      right[i] = this.buffer[this.readPos];
      this.readPos = (this.readPos + 1) % this._size;
    }

    return true;
  }

  /** Reset buffer state and counters. */
  reset(): void {
    this.writePos = 0;
    this.readPos = 0;
    this._overrunSamples = 0;
    this._underrunCount = 0;
  }
}
