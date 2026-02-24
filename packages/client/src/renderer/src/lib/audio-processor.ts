import { Track } from "livekit-client";
import type { TrackProcessor, AudioProcessorOptions } from "livekit-client";

// @ts-ignore - Vite ?url import
import rnnoiseWasmUrl from "@jitsi/rnnoise-wasm/dist/rnnoise.wasm?url";

// ---------------------------------------------------------------------------
// RNNoise worklet — ML noise suppression via WASM
// Accumulates 128-sample WebAudio blocks into 480-sample RNNoise frames.
// ---------------------------------------------------------------------------

const RNNOISE_WORKLET = `
const FRAME_SIZE = 480;
const RING_SIZE = 1920; // LCM(128, 480)

let wasmExports = null;
let wasmMemory = null;
let heapF32 = null;
let rnnoiseState = 0;
let inputPtr = 0;
let outputPtr = 0;

const inputRing = new Float32Array(RING_SIZE);
let inputRingWrite = 0, inputRingRead = 0, inputRingCount = 0;

const outputRing = new Float32Array(RING_SIZE);
let outputRingWrite = 0, outputRingRead = 0, outputRingCount = 0;

function updateHeap() {
  heapF32 = new Float32Array(wasmMemory.buffer);
}

class RnnoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = (e) => {
      if (e.data.type === 'wasm') this.initWasm(e.data.binary);
    };
  }

  async initWasm(binary) {
    const imports = {
      a: {
        a: () => false,
        b: (dest, src, num) => {
          new Uint8Array(wasmMemory.buffer).copyWithin(dest, src, src + num);
        },
      },
    };
    const { instance } = await WebAssembly.instantiate(binary, imports);
    wasmExports = instance.exports;
    wasmMemory = wasmExports.c;
    if (wasmExports.d) wasmExports.d();
    inputPtr = wasmExports.g(FRAME_SIZE * 4);
    outputPtr = wasmExports.g(FRAME_SIZE * 4);
    rnnoiseState = wasmExports.f();
    updateHeap();
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;

    // Pass through until WASM is ready
    if (!wasmExports || !rnnoiseState) {
      output.set(input);
      return true;
    }

    const len = input.length;

    // Accumulate input into ring buffer
    for (let i = 0; i < len; i++) {
      inputRing[inputRingWrite] = input[i];
      inputRingWrite = (inputRingWrite + 1) % RING_SIZE;
    }
    inputRingCount += len;

    // Process complete 480-sample frames
    while (inputRingCount >= FRAME_SIZE) {
      const inIdx = inputPtr >> 2;
      updateHeap();
      for (let i = 0; i < FRAME_SIZE; i++) {
        heapF32[inIdx + i] = inputRing[inputRingRead] * 32768;
        inputRingRead = (inputRingRead + 1) % RING_SIZE;
      }
      inputRingCount -= FRAME_SIZE;

      wasmExports.j(rnnoiseState, outputPtr, inputPtr);

      updateHeap();
      const outIdx = outputPtr >> 2;
      for (let i = 0; i < FRAME_SIZE; i++) {
        outputRing[outputRingWrite] = heapF32[outIdx + i] / 32768;
        outputRingWrite = (outputRingWrite + 1) % RING_SIZE;
      }
      outputRingCount += FRAME_SIZE;
    }

    // Emit from output ring
    if (outputRingCount >= len) {
      for (let i = 0; i < len; i++) {
        output[i] = outputRing[outputRingRead];
        outputRingRead = (outputRingRead + 1) % RING_SIZE;
      }
      outputRingCount -= len;
    } else {
      output.fill(0);
    }

    return true;
  }
}

registerProcessor('rnnoise-processor', RnnoiseProcessor);
`;

// ---------------------------------------------------------------------------
// Noise gate worklet — threshold-based silence gate with attack/release/hold
// Cuts background noise (fan, keyboard, hum) during silence.
// ---------------------------------------------------------------------------

const NOISE_GATE_WORKLET = `
const THRESHOLD_DB = -40;
const ATTACK_MS = 5;
const RELEASE_MS = 150;
const HOLD_MS = 100;

let gainSmoothed = 0;
let holdCounter = 0;

class NoiseGateProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;

    const len = input.length;

    // Compute RMS in dB
    let sumSq = 0;
    for (let i = 0; i < len; i++) sumSq += input[i] * input[i];
    const rms = Math.sqrt(sumSq / len);
    const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -120;

    // Smoothing coefficients (per-sample)
    const attackCoeff = 1 - Math.exp(-1 / (sampleRate * ATTACK_MS / 1000));
    const releaseCoeff = 1 - Math.exp(-1 / (sampleRate * RELEASE_MS / 1000));
    const holdSamples = (sampleRate * HOLD_MS) / 1000;

    // Gate open/close decision
    let gateTarget;
    if (rmsDb >= THRESHOLD_DB) {
      gateTarget = 1;
      holdCounter = holdSamples;
    } else if (holdCounter > 0) {
      gateTarget = 1;
      holdCounter -= len;
    } else {
      gateTarget = 0;
    }

    // Apply smoothed gain
    for (let i = 0; i < len; i++) {
      const coeff = gateTarget > gainSmoothed ? attackCoeff : releaseCoeff;
      gainSmoothed += coeff * (gateTarget - gainSmoothed);
      output[i] = input[i] * gainSmoothed;
    }

    return true;
  }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor);
`;

// ---------------------------------------------------------------------------
// MicrophoneProcessor — LiveKit TrackProcessor
//
// Chains both stages in a single Web Audio graph:
//   Source → RNNoise → NoiseGate → Destination
//
// Install/remove via LiveKitManager.setAudioProcessing(true/false).
// ---------------------------------------------------------------------------

const MONO_WORKLET_OPTIONS: AudioWorkletNodeOptions = {
  channelCount: 1,
  channelCountMode: "explicit",
};

let workletsRegistered = false;

async function registerWorklets(audioContext: AudioContext): Promise<void> {
  if (workletsRegistered) return;

  for (const source of [RNNOISE_WORKLET, NOISE_GATE_WORKLET]) {
    const blob = new Blob([source], { type: "application/javascript" });
    await audioContext.audioWorklet.addModule(URL.createObjectURL(blob));
  }
  workletsRegistered = true;
}

export class MicrophoneProcessor
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  name = "mic-audio-processor";
  processedTrack?: MediaStreamTrack;

  private wasmBinary: ArrayBuffer | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private rnnoiseNode: AudioWorkletNode | null = null;
  private noiseGateNode: AudioWorkletNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;

  async init({ track, audioContext }: AudioProcessorOptions): Promise<void> {
    if (!this.wasmBinary) {
      const resp = await fetch(rnnoiseWasmUrl);
      this.wasmBinary = await resp.arrayBuffer();
    }

    await registerWorklets(audioContext);

    this.sourceNode = audioContext.createMediaStreamSource(new MediaStream([track]));
    this.rnnoiseNode = new AudioWorkletNode(audioContext, "rnnoise-processor", MONO_WORKLET_OPTIONS);
    this.noiseGateNode = new AudioWorkletNode(audioContext, "noise-gate-processor", MONO_WORKLET_OPTIONS);
    this.destinationNode = audioContext.createMediaStreamDestination();

    // Chain: source -> rnnoise -> noise gate -> destination
    this.sourceNode.connect(this.rnnoiseNode);
    this.rnnoiseNode.connect(this.noiseGateNode);
    this.noiseGateNode.connect(this.destinationNode);

    this.rnnoiseNode.port.postMessage({ type: "wasm", binary: this.wasmBinary.slice(0) });
    this.processedTrack = this.destinationNode.stream.getAudioTracks()[0];
  }

  async restart({ track, audioContext }: AudioProcessorOptions): Promise<void> {
    this.sourceNode?.disconnect();
    this.sourceNode = audioContext.createMediaStreamSource(new MediaStream([track]));

    if (this.rnnoiseNode) {
      this.sourceNode.connect(this.rnnoiseNode);
    }
  }

  async destroy(): Promise<void> {
    for (const node of [this.sourceNode, this.rnnoiseNode, this.noiseGateNode]) {
      node?.disconnect();
    }
    this.processedTrack?.stop();

    this.sourceNode = null;
    this.rnnoiseNode = null;
    this.noiseGateNode = null;
    this.destinationNode = null;
    this.processedTrack = undefined;
  }
}
