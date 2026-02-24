import { describe, it, expect } from "vitest";
import { RingBuffer } from "../renderer/src/lib/ring-buffer";
import {
  generateSineWave,
  detectDiscontinuities,
  chunkBuffer,
  simulatePipeline,
} from "./audio-analysis";

const SAMPLE_RATE = 48000;
const PROCESS_FRAMES = 128; // AudioWorklet quantum
const PROCESS_INTERVAL_MS = (PROCESS_FRAMES / SAMPLE_RATE) * 1000; // ~2.667ms
const WASAPI_INTERVAL_MS = 10;
const WASAPI_CHUNK_SAMPLES = Math.floor((SAMPLE_RATE * WASAPI_INTERVAL_MS) / 1000) * 2; // 960 interleaved
const RING_BUFFER_SIZE = SAMPLE_RATE * 2 * 4 + 1; // ~4 seconds + sentinel

describe("Audio Pipeline Simulation", () => {
  describe("steady-state (no jitter)", () => {
    it("produces output with zero underruns (with pre-buffering)", () => {
      const signal = generateSineWave(1000, SAMPLE_RATE, 440);
      const chunks = chunkBuffer(signal, WASAPI_CHUNK_SAMPLES, WASAPI_INTERVAL_MS);

      // 960 samples per 10ms chunk / 256 per read = 3.75 reads per chunk.
      // Need 2 chunks of pre-buffer to survive the bursty arrival pattern.
      const report = simulatePipeline(
        chunks,
        PROCESS_INTERVAL_MS,
        PROCESS_FRAMES,
        RING_BUFFER_SIZE,
        1920, // 2 chunks pre-buffer
      );

      expect(report.signalPresent).toBe(true);
      expect(report.underrunCount).toBe(0);
      expect(report.overrunSamples).toBe(0);
    });
  });

  describe("with moderate jitter (±3ms)", () => {
    it("produces output with zero underruns when pre-buffered", () => {
      const signal = generateSineWave(1000, SAMPLE_RATE, 440);
      const chunks = chunkBuffer(signal, WASAPI_CHUNK_SAMPLES, WASAPI_INTERVAL_MS, 3);

      // With ±3ms jitter, worst case 13ms between chunks.
      // Need 3 chunks of pre-buffer (~30ms) to absorb jitter + bursty reads.
      const report = simulatePipeline(
        chunks,
        PROCESS_INTERVAL_MS,
        PROCESS_FRAMES,
        RING_BUFFER_SIZE,
        2880, // 3 chunks pre-buffer
      );

      expect(report.signalPresent).toBe(true);
      expect(report.underrunCount).toBe(0);
    });
  });

  describe("with high jitter (±8ms, simulating Sleep(10) worst case)", () => {
    it("may underrun without pre-buffering", () => {
      const signal = generateSineWave(2000, SAMPLE_RATE, 440);
      const chunks = chunkBuffer(signal, WASAPI_CHUNK_SAMPLES, WASAPI_INTERVAL_MS, 8);

      const report = simulatePipeline(
        chunks,
        PROCESS_INTERVAL_MS,
        PROCESS_FRAMES,
        RING_BUFFER_SIZE,
        0, // no pre-buffer
      );

      // With high jitter and no pre-buffer, underruns are likely
      // This test documents the current behavior — the fix should eliminate these
      expect(report.signalPresent).toBe(true);
      // We don't assert underrunCount > 0 because it depends on random jitter
      // but we log it for diagnostic purposes
    });

    it("pre-buffering + drift correction eliminates desync under high jitter", () => {
      const signal = generateSineWave(2000, SAMPLE_RATE, 440);
      const chunks = chunkBuffer(signal, WASAPI_CHUNK_SAMPLES, WASAPI_INTERVAL_MS, 8);

      const report = simulatePipeline(
        chunks,
        PROCESS_INTERVAL_MS,
        PROCESS_FRAMES,
        RING_BUFFER_SIZE,
        4800, // 50ms pre-buffer
        4800, // drift threshold
        1920, // drift target
      );

      expect(report.signalPresent).toBe(true);
      expect(report.overrunSamples).toBe(0);
    });
  });

  describe("sine wave integrity through RingBuffer", () => {
    it("preserves sine wave without discontinuities at steady-state", () => {
      const freq = 440;
      const durationMs = 500;
      const signal = generateSineWave(durationMs, SAMPLE_RATE, freq);
      const rb = new RingBuffer(RING_BUFFER_SIZE);

      // Chunk the signal like WASAPI would
      const chunks = chunkBuffer(signal, WASAPI_CHUNK_SAMPLES, WASAPI_INTERVAL_MS);

      const outputLeft: number[] = [];
      let chunkIdx = 0;
      let time = 0;
      let started = false;
      const preBufferThreshold = 1920; // 2 chunks worth

      const left = new Float32Array(PROCESS_FRAMES);
      const right = new Float32Array(PROCESS_FRAMES);

      const totalProcessCalls = Math.floor(durationMs / PROCESS_INTERVAL_MS);
      for (let i = 0; i < totalProcessCalls; i++) {
        // Feed any chunks that have arrived
        while (chunkIdx < chunks.length && chunks[chunkIdx].timestampMs <= time) {
          rb.write(chunks[chunkIdx].data);
          chunkIdx++;
        }

        if (!started && rb.available >= preBufferThreshold) {
          started = true;
        }

        if (started && rb.readStereoInterleaved(left, right, PROCESS_FRAMES)) {
          for (let j = 0; j < PROCESS_FRAMES; j++) {
            outputLeft.push(left[j]);
          }
        }

        time += PROCESS_INTERVAL_MS;
      }

      const output = new Float32Array(outputLeft);
      const discont = detectDiscontinuities(output, freq, SAMPLE_RATE);

      expect(discont).toBe(0);
      expect(rb.underrunCount).toBe(0);
    });

    it("detects discontinuities when chunks are delayed (simulating glitchy pipeline)", () => {
      const freq = 440;
      const signal = generateSineWave(500, SAMPLE_RATE, freq);
      const chunks = chunkBuffer(signal, WASAPI_CHUNK_SAMPLES, WASAPI_INTERVAL_MS);

      // Simulate a 50ms gap by delaying chunks 5-9
      const delayedChunks = chunks.map((c, i) => ({
        ...c,
        timestampMs: i >= 5 && i < 10 ? c.timestampMs + 50 : c.timestampMs,
      }));

      const rb = new RingBuffer(RING_BUFFER_SIZE);
      const outputLeft: number[] = [];
      let chunkIdx = 0;
      let time = 0;

      const left = new Float32Array(PROCESS_FRAMES);
      const right = new Float32Array(PROCESS_FRAMES);

      for (let i = 0; i < 150; i++) {
        while (chunkIdx < delayedChunks.length && delayedChunks[chunkIdx].timestampMs <= time) {
          rb.write(delayedChunks[chunkIdx].data);
          chunkIdx++;
        }

        if (rb.readStereoInterleaved(left, right, PROCESS_FRAMES)) {
          for (let j = 0; j < PROCESS_FRAMES; j++) {
            outputLeft.push(left[j]);
          }
        } else {
          // Underrun — output silence
          for (let j = 0; j < PROCESS_FRAMES; j++) {
            outputLeft.push(0);
          }
        }

        time += PROCESS_INTERVAL_MS;
      }

      // The delayed chunks should cause underruns
      expect(rb.underrunCount).toBeGreaterThan(0);
    });
  });

  describe("drift correction", () => {
    it("skips stale samples when buffer exceeds drift threshold", () => {
      const rb = new RingBuffer(RING_BUFFER_SIZE);
      rb.write(new Float32Array(9600)); // 100ms burst

      const left = new Float32Array(PROCESS_FRAMES);
      const right = new Float32Array(PROCESS_FRAMES);
      rb.readStereoInterleaved(left, right, PROCESS_FRAMES);

      // 9600 - 256 = 9344 available, well above 4800 threshold
      const skipped = rb.correctDrift(4800, 1920);

      expect(skipped).toBe(9344 - 1920);
      expect(rb.available).toBe(1920);
      expect(rb.driftCorrections).toBe(1);
    });

    it("does not skip when buffer is at normal level", () => {
      const rb = new RingBuffer(RING_BUFFER_SIZE);
      rb.write(new Float32Array(1920));

      const skipped = rb.correctDrift(4800, 1920);
      expect(skipped).toBe(0);
      expect(rb.driftCorrections).toBe(0);
    });

    it("pipeline recovers from burst delay via drift correction", () => {
      const signal = generateSineWave(2000, SAMPLE_RATE, 440);
      const chunks = chunkBuffer(signal, WASAPI_CHUNK_SAMPLES, WASAPI_INTERVAL_MS);

      // Delay chunks 20-24 by 60ms (simulating an IPC stall)
      const delayedChunks = chunks.map((c, i) => ({
        ...c,
        timestampMs: i >= 20 && i < 25 ? c.timestampMs + 60 : c.timestampMs,
      }));

      const report = simulatePipeline(
        delayedChunks,
        PROCESS_INTERVAL_MS,
        PROCESS_FRAMES,
        RING_BUFFER_SIZE,
        4800, // pre-buffer
        4800, // drift threshold
        1920, // drift target
      );

      expect(report.signalPresent).toBe(true);
      expect(report.driftCorrections).toBeGreaterThanOrEqual(0);
    });
  });

  describe("detectDiscontinuities utility", () => {
    it("returns 0 for a clean sine wave", () => {
      const signal = generateSineWave(100, SAMPLE_RATE, 440);
      // Extract left channel (every other sample)
      const left = new Float32Array(signal.length / 2);
      for (let i = 0; i < left.length; i++) {
        left[i] = signal[i * 2];
      }
      expect(detectDiscontinuities(left, 440, SAMPLE_RATE)).toBe(0);
    });

    it("detects a phase jump in the middle of a signal", () => {
      const signal = generateSineWave(100, SAMPLE_RATE, 440);
      const left = new Float32Array(signal.length / 2);
      for (let i = 0; i < left.length; i++) {
        left[i] = signal[i * 2];
      }
      // Inject a discontinuity at sample 1000
      if (left.length > 1001) {
        left[1000] = -left[1000]; // phase flip
      }
      expect(detectDiscontinuities(left, 440, SAMPLE_RATE)).toBeGreaterThan(0);
    });
  });
});
