/**
 * Pure audio analysis utilities for testing the screen share audio pipeline.
 * No Electron or WASAPI dependencies — runs in vitest.
 */

export interface AudioQualityReport {
  /** Total output frames produced. */
  totalFrames: number;
  /** Number of times the consumer had insufficient data (silence inserted). */
  underrunCount: number;
  /** Number of samples dropped because the buffer was full. */
  overrunSamples: number;
  /** Longest consecutive silence gap in milliseconds. */
  maxGapMs: number;
  /** Number of phase discontinuities detected in a sine wave signal. */
  discontinuities: number;
  /** Whether any non-zero samples were present in the output. */
  signalPresent: boolean;
  /** Number of drift correction skip events. */
  driftCorrections: number;
}

/**
 * Generate a known sine wave as interleaved stereo Float32Array.
 * Both channels get the same signal for simplicity.
 */
export function generateSineWave(
  durationMs: number,
  sampleRate = 48000,
  freq = 440,
): Float32Array {
  const totalFrames = Math.floor((sampleRate * durationMs) / 1000);
  const buffer = new Float32Array(totalFrames * 2); // interleaved stereo
  const angularFreq = (2 * Math.PI * freq) / sampleRate;

  for (let i = 0; i < totalFrames; i++) {
    const sample = Math.sin(angularFreq * i);
    buffer[i * 2] = sample; // left
    buffer[i * 2 + 1] = sample; // right
  }

  return buffer;
}

/**
 * Detect phase discontinuities in a mono sine wave output.
 *
 * Computes the expected phase increment per sample and checks for jumps
 * that exceed a threshold. A perfect pipeline produces 0 discontinuities.
 *
 * @param output - Mono audio output (one channel extracted from stereo)
 * @param freq - Expected sine wave frequency in Hz
 * @param sampleRate - Sample rate in Hz
 * @returns Number of discontinuities detected
 */
export function detectDiscontinuities(
  output: Float32Array,
  freq: number,
  sampleRate: number,
): number {
  if (output.length < 3) return 0;

  const phaseIncrement = (2 * Math.PI * freq) / sampleRate;
  let discontinuities = 0;

  // Skip silent regions at the start (pre-buffering) and find the first non-zero sample
  let startIdx = 0;
  while (startIdx < output.length && Math.abs(output[startIdx]) < 0.001) {
    startIdx++;
  }

  if (startIdx >= output.length - 2) return 0;

  // Estimate the initial phase from the first non-silent sample
  let prevSample = output[startIdx];

  for (let i = startIdx + 1; i < output.length; i++) {
    const sample = output[i];

    // Skip regions that are entirely silent (underrun gaps)
    if (Math.abs(sample) < 0.001 && Math.abs(prevSample) < 0.001) {
      prevSample = sample;
      continue;
    }

    // Detect discontinuity: a sudden jump in sample value that's inconsistent
    // with the expected sine wave progression.
    // For a sine wave, consecutive samples differ by at most sin(phaseIncrement) ≈ phaseIncrement
    // We use a generous threshold to avoid false positives.
    const maxExpectedDelta = Math.sin(phaseIncrement) * 1.5 + 0.05;
    const actualDelta = Math.abs(sample - prevSample);

    // A transition from silence to signal (or vice versa) is an underrun gap, not a discontinuity
    const silenceTransition =
      (Math.abs(sample) < 0.001 && Math.abs(prevSample) > 0.01) ||
      (Math.abs(sample) > 0.01 && Math.abs(prevSample) < 0.001);

    if (actualDelta > maxExpectedDelta && !silenceTransition) {
      discontinuities++;
    }

    prevSample = sample;
  }

  return discontinuities;
}

/**
 * Chunk an interleaved stereo buffer into timed packets simulating WASAPI delivery.
 */
export function chunkBuffer(
  buffer: Float32Array,
  chunkSizeSamples: number,
  intervalMs: number,
  jitterMs = 0,
): { data: Float32Array; timestampMs: number }[] {
  const chunks: { data: Float32Array; timestampMs: number }[] = [];
  let offset = 0;
  let time = 0;

  while (offset < buffer.length) {
    const end = Math.min(offset + chunkSizeSamples, buffer.length);
    chunks.push({
      data: buffer.slice(offset, end),
      timestampMs: time,
    });
    offset = end;

    // Add jitter: uniform random in [-jitterMs, +jitterMs]
    const jitter = jitterMs > 0 ? (Math.random() * 2 - 1) * jitterMs : 0;
    time += intervalMs + jitter;
  }

  return chunks;
}

/**
 * Simulate the ring buffer pipeline and measure audio quality.
 *
 * Models the timing of the full pipeline:
 * - Producer writes chunks at their scheduled timestamps
 * - Consumer reads at fixed intervals (simulating AudioWorklet process())
 *
 * @param chunks - Timed audio packets (from chunkBuffer)
 * @param processIntervalMs - How often process() runs (e.g., 128/48000*1000 ≈ 2.667ms)
 * @param processFrames - Frames per process() call (e.g., 128)
 * @param bufferSize - Ring buffer size in samples
 * @param preBufferThreshold - Minimum samples before first read (0 to disable)
 */
export function simulatePipeline(
  chunks: { data: Float32Array; timestampMs: number }[],
  processIntervalMs: number,
  processFrames: number,
  bufferSize: number,
  preBufferThreshold = 0,
  driftThreshold = 0,
  driftTarget = 0,
): AudioQualityReport {
  // Simple ring buffer simulation matching RingBuffer class behavior
  const buffer = new Float32Array(bufferSize);
  let writePos = 0;
  let readPos = 0;
  let overrunSamples = 0;
  let underrunCount = 0; // mid-stream underruns only (while chunks are still arriving)
  let driftCorrections = 0;
  let started = preBufferThreshold === 0;
  let allChunksDelivered = false;

  function available(): number {
    const diff = writePos - readPos;
    return diff >= 0 ? diff : diff + bufferSize;
  }

  function free(): number {
    return bufferSize - 1 - available();
  }

  function write(data: Float32Array): void {
    const len = data.length;
    const freeSpace = free();
    const toWrite = Math.min(len, freeSpace);
    if (len > freeSpace) overrunSamples += len - freeSpace;

    for (let i = 0; i < toWrite; i++) {
      buffer[writePos] = data[i];
      writePos = (writePos + 1) % bufferSize;
    }
  }

  // Run until all chunks have been delivered and buffer is drained
  const lastChunkTime = chunks.length > 0 ? chunks[chunks.length - 1].timestampMs : 0;
  const totalDurationMs = lastChunkTime + 50;

  const outputLeft: number[] = [];
  const outputRight: number[] = [];
  let maxGapMs = 0;
  let currentGapMs = 0;

  let chunkIdx = 0;
  let processTime = 0;

  while (processTime < totalDurationMs) {
    // Write all chunks that have arrived by this time
    while (chunkIdx < chunks.length && chunks[chunkIdx].timestampMs <= processTime) {
      write(chunks[chunkIdx].data);
      chunkIdx++;
    }
    if (chunkIdx >= chunks.length) allChunksDelivered = true;

    // Check pre-buffer threshold
    if (!started) {
      if (available() >= preBufferThreshold) {
        started = true;
      } else {
        // Output silence
        for (let i = 0; i < processFrames; i++) {
          outputLeft.push(0);
          outputRight.push(0);
        }
        processTime += processIntervalMs;
        continue;
      }
    }

    // Try to read
    const samplesNeeded = processFrames * 2;
    if (available() >= samplesNeeded) {
      for (let i = 0; i < processFrames; i++) {
        outputLeft.push(buffer[readPos]);
        readPos = (readPos + 1) % bufferSize;
        outputRight.push(buffer[readPos]);
        readPos = (readPos + 1) % bufferSize;
      }
      currentGapMs = 0;

      // Drift correction: skip stale samples if buffer is overfull
      if (driftThreshold > 0 && available() > driftThreshold) {
        const skip = available() - driftTarget;
        readPos = (readPos + skip) % bufferSize;
        driftCorrections++;
      }
    } else {
      // Only count as underrun if we're still expecting data (mid-stream)
      if (!allChunksDelivered) {
        underrunCount++;
      }
      for (let i = 0; i < processFrames; i++) {
        outputLeft.push(0);
        outputRight.push(0);
      }
      currentGapMs += processIntervalMs;
      maxGapMs = Math.max(maxGapMs, currentGapMs);
    }

    processTime += processIntervalMs;
  }

  const leftArr = new Float32Array(outputLeft);
  const signalPresent = leftArr.some((s) => Math.abs(s) > 0.001);

  return {
    totalFrames: outputLeft.length,
    underrunCount,
    overrunSamples,
    maxGapMs,
    discontinuities: 0, // Caller can run detectDiscontinuities separately
    signalPresent,
    driftCorrections,
  };
}
