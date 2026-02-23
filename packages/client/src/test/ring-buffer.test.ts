import { describe, it, expect } from "vitest";
import { RingBuffer } from "../renderer/src/lib/ring-buffer";

describe("RingBuffer", () => {
  describe("basic operations", () => {
    it("starts empty", () => {
      const rb = new RingBuffer(1024);
      expect(rb.available).toBe(0);
      expect(rb.capacity).toBe(1023);
      expect(rb.free).toBe(1023);
      expect(rb.underrunCount).toBe(0);
      expect(rb.overrunSamples).toBe(0);
    });

    it("write and read round-trip preserves data", () => {
      const rb = new RingBuffer(1024);
      // Write 4 interleaved stereo samples (8 values)
      const input = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
      const dropped = rb.write(input);

      expect(dropped).toBe(0);
      expect(rb.available).toBe(8);

      const left = new Float32Array(4);
      const right = new Float32Array(4);
      const ok = rb.readStereoInterleaved(left, right, 4);

      expect(ok).toBe(true);
      // Float32 has limited precision — use closeTo comparisons
      expect(left[0]).toBeCloseTo(0.1);
      expect(left[1]).toBeCloseTo(0.3);
      expect(left[2]).toBeCloseTo(0.5);
      expect(left[3]).toBeCloseTo(0.7);
      expect(right[0]).toBeCloseTo(0.2);
      expect(right[1]).toBeCloseTo(0.4);
      expect(right[2]).toBeCloseTo(0.6);
      expect(right[3]).toBeCloseTo(0.8);
      expect(rb.available).toBe(0);
    });

    it("handles wraparound correctly", () => {
      const rb = new RingBuffer(16); // 15 usable slots

      // Fill most of the buffer
      const fill = new Float32Array(12);
      fill.fill(0.5);
      rb.write(fill);

      // Read 4 frames (8 samples) to advance readPos
      const left = new Float32Array(4);
      const right = new Float32Array(4);
      rb.readStereoInterleaved(left, right, 4);

      // Now writePos=12, readPos=8, available=4
      expect(rb.available).toBe(4);

      // Write 10 more — wraps around the end of the buffer
      const wrap = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const dropped = rb.write(wrap);
      expect(dropped).toBe(0);
      expect(rb.available).toBe(14);

      // Read all
      const left2 = new Float32Array(7);
      const right2 = new Float32Array(7);
      const ok = rb.readStereoInterleaved(left2, right2, 7);
      expect(ok).toBe(true);

      // First 2 frames are from the remaining fill (0.5 each)
      expect(left2[0]).toBeCloseTo(0.5);
      expect(right2[0]).toBeCloseTo(0.5);
      expect(left2[1]).toBeCloseTo(0.5);
      expect(right2[1]).toBeCloseTo(0.5);

      // Next 5 frames are from the wrap data
      expect(left2[2]).toBe(1);
      expect(right2[2]).toBe(2);
      expect(left2[3]).toBe(3);
      expect(right2[3]).toBe(4);
    });
  });

  describe("overrun behavior", () => {
    it("reports dropped samples when buffer is full", () => {
      const rb = new RingBuffer(16); // 15 usable slots
      const data = new Float32Array(20);
      data.fill(1.0);

      const dropped = rb.write(data);
      expect(dropped).toBe(5); // 20 - 15 = 5 dropped
      expect(rb.overrunSamples).toBe(5);
      expect(rb.available).toBe(15);
    });

    it("does not corrupt data on overrun (writes only what fits)", () => {
      const rb = new RingBuffer(10); // 9 usable
      const data = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      rb.write(data);

      // Only first 9 samples should be in the buffer
      const left = new Float32Array(4);
      const right = new Float32Array(4);
      rb.readStereoInterleaved(left, right, 4);

      expect(left[0]).toBe(1);
      expect(right[0]).toBe(2);
      expect(left[1]).toBe(3);
      expect(right[1]).toBe(4);
    });

    it("accumulates overrun count across multiple writes", () => {
      const rb = new RingBuffer(8); // 7 usable
      rb.write(new Float32Array(10)); // drops 3 (7 fit)
      expect(rb.overrunSamples).toBe(3);

      // Read 3 frames = 6 samples, leaving 1 in buffer, free = 6
      const left = new Float32Array(3);
      const right = new Float32Array(3);
      rb.readStereoInterleaved(left, right, 3);

      rb.write(new Float32Array(10)); // 6 fit, drops 4
      expect(rb.overrunSamples).toBe(7); // 3 + 4
    });
  });

  describe("underrun behavior", () => {
    it("returns false when insufficient data", () => {
      const rb = new RingBuffer(1024);
      rb.write(new Float32Array([1, 2])); // 1 frame

      const left = new Float32Array(128);
      const right = new Float32Array(128);
      const ok = rb.readStereoInterleaved(left, right, 128);

      expect(ok).toBe(false);
      expect(rb.underrunCount).toBe(1);
      // Buffer should not have been consumed
      expect(rb.available).toBe(2);
    });

    it("accumulates underrun count", () => {
      const rb = new RingBuffer(1024);
      const left = new Float32Array(128);
      const right = new Float32Array(128);

      rb.readStereoInterleaved(left, right, 128);
      rb.readStereoInterleaved(left, right, 128);
      rb.readStereoInterleaved(left, right, 128);

      expect(rb.underrunCount).toBe(3);
    });
  });

  describe("steady-state simulation", () => {
    it("zero underruns when producer keeps up with consumer (with pre-buffer)", () => {
      const rb = new RingBuffer(48000 * 2 * 4 + 1); // ~4 seconds, +1 for sentinel
      const sampleRate = 48000;
      const processFrames = 128; // AudioWorklet quantum
      const processIntervalMs = (processFrames / sampleRate) * 1000; // ~2.667ms
      const producerIntervalMs = 10; // WASAPI delivers every ~10ms
      const samplesPerChunk = Math.floor((sampleRate * producerIntervalMs) / 1000) * 2; // 960 interleaved
      // 960 samples per chunk / 256 per read = 3.75 reads per chunk.
      // Between chunk arrivals (10ms), we do ~3.75 reads = 960 samples consumed.
      // Need 2 chunks of pre-buffer so the first 10ms gap doesn't cause underrun.
      const preBufferThreshold = 1920;

      const totalDurationMs = 2000;
      let producerTime = 0;
      let consumerTime = 0;
      let started = false;

      const left = new Float32Array(processFrames);
      const right = new Float32Array(processFrames);

      while (consumerTime < totalDurationMs) {
        // Write all chunks that have arrived
        while (producerTime <= consumerTime) {
          rb.write(new Float32Array(samplesPerChunk));
          producerTime += producerIntervalMs;
        }

        if (!started && rb.available >= preBufferThreshold) {
          started = true;
        }

        if (started) {
          rb.readStereoInterleaved(left, right, processFrames);
        }

        consumerTime += processIntervalMs;
      }

      expect(rb.underrunCount).toBe(0);
      expect(rb.overrunSamples).toBe(0);
    });

    it("handles moderate jitter without underruns (with pre-buffering)", () => {
      const rb = new RingBuffer(48000 * 2 * 4 + 1);
      const sampleRate = 48000;
      const processFrames = 128;
      const processIntervalMs = (processFrames / sampleRate) * 1000;
      const producerIntervalMs = 10;
      const samplesPerChunk = Math.floor((sampleRate * producerIntervalMs) / 1000) * 2;
      // With ±5ms jitter, consecutive worst-case gaps can drain buffer fast.
      // 5 chunks of pre-buffer (~50ms) covers multiple consecutive worst-case gaps.
      const preBufferSamples = 4800; // 5 chunks = ~50ms

      const totalDurationMs = 2000;
      let producerTime = 0;
      let consumerTime = 0;
      let started = false;

      // Seed RNG for reproducibility
      let seed = 42;
      function pseudoRandom(): number {
        seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
        return seed / 0x7fffffff;
      }

      const left = new Float32Array(processFrames);
      const right = new Float32Array(processFrames);

      while (consumerTime < totalDurationMs) {
        // Write chunks with jitter (5-15ms interval)
        while (producerTime <= consumerTime) {
          rb.write(new Float32Array(samplesPerChunk));
          const jitter = (pseudoRandom() * 2 - 1) * 5; // ±5ms
          producerTime += producerIntervalMs + jitter;
        }

        if (!started && rb.available >= preBufferSamples) {
          started = true;
        }

        if (started) {
          rb.readStereoInterleaved(left, right, processFrames);
        }

        consumerTime += processIntervalMs;
      }

      // With pre-buffering, moderate jitter should cause zero underruns
      expect(rb.underrunCount).toBe(0);
    });
  });

  describe("burst scenario", () => {
    it("detects underrun after a gap in production", () => {
      const rb = new RingBuffer(2048);
      const processFrames = 128;

      // Write a burst of data (20ms worth = 1920 interleaved samples)
      rb.write(new Float32Array(1920));

      const left = new Float32Array(processFrames);
      const right = new Float32Array(processFrames);

      // Consumer reads until buffer drains
      let reads = 0;
      while (rb.readStereoInterleaved(left, right, processFrames)) {
        reads++;
      }

      // After 1920 / 256 = 7.5 reads, the 8th should underrun
      expect(reads).toBe(7);
      expect(rb.underrunCount).toBe(1);
    });
  });

  describe("reset", () => {
    it("clears all state", () => {
      const rb = new RingBuffer(1024);
      rb.write(new Float32Array(100));

      const left = new Float32Array(128);
      const right = new Float32Array(128);
      rb.readStereoInterleaved(left, right, 128); // underrun

      rb.reset();
      expect(rb.available).toBe(0);
      expect(rb.underrunCount).toBe(0);
      expect(rb.overrunSamples).toBe(0);
    });
  });
});
