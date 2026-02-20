import { Track } from "livekit-client";
import type { TrackProcessor, AudioProcessorOptions } from "livekit-client";

const WORKLET_SOURCE = `
const FRAME_SIZE = 480;

let wasmExports = null;
let wasmMemory = null;
let heapF32 = null;
let rnnoiseState = 0;
let inputPtr = 0;
let outputPtr = 0;

// Circular buffer to accumulate 128-sample chunks into 480-sample frames
const inputRing = new Float32Array(1920); // LCM(128, 480)
let inputRingWrite = 0;
let inputRingRead = 0;
let inputRingCount = 0;

const outputRing = new Float32Array(1920);
let outputRingWrite = 0;
let outputRingRead = 0;
let outputRingCount = 0;

function updateHeap() {
  heapF32 = new Float32Array(wasmMemory.buffer);
}

class RnnoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = (e) => {
      if (e.data.type === 'wasm') {
        this.initWasm(e.data.binary);
      }
    };
  }

  async initWasm(binary) {
    const imports = {
      a: {
        a: () => false,  // emscripten_resize_heap — RNNoise doesn't need to grow
        b: (dest, src, num) => {
          // emscripten_memcpy_big — operates on the WASM-owned memory
          new Uint8Array(wasmMemory.buffer).copyWithin(dest, src, src + num);
        },
      },
    };

    const { instance } = await WebAssembly.instantiate(binary, imports);
    wasmExports = instance.exports;
    wasmMemory = wasmExports.c; // WASM exports its own memory as "c"

    // Call __wasm_call_ctors to initialize
    if (wasmExports.d) wasmExports.d();

    // Allocate buffers for RNNoise (480 floats x 4 bytes)
    inputPtr = wasmExports.g(FRAME_SIZE * 4);
    outputPtr = wasmExports.g(FRAME_SIZE * 4);

    // Create denoiser state
    rnnoiseState = wasmExports.f();
    updateHeap();
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;

    if (!wasmExports || !rnnoiseState) {
      // Pass through until WASM is ready
      output.set(input);
      return true;
    }

    const len = input.length; // 128

    // Write input samples into the ring buffer
    for (let i = 0; i < len; i++) {
      inputRing[inputRingWrite] = input[i];
      inputRingWrite = (inputRingWrite + 1) % 1920;
    }
    inputRingCount += len;

    // Process complete 480-sample frames
    while (inputRingCount >= FRAME_SIZE) {
      // Copy from ring to WASM input buffer (float32 → scaled to ±32768 for RNNoise)
      const inIdx = inputPtr >> 2;
      updateHeap();
      for (let i = 0; i < FRAME_SIZE; i++) {
        heapF32[inIdx + i] = inputRing[inputRingRead] * 32768;
        inputRingRead = (inputRingRead + 1) % 1920;
      }
      inputRingCount -= FRAME_SIZE;

      // Run RNNoise
      wasmExports.j(rnnoiseState, outputPtr, inputPtr);

      // Copy WASM output to output ring (scale back from ±32768 to ±1.0)
      updateHeap();
      const outIdx = outputPtr >> 2;
      for (let i = 0; i < FRAME_SIZE; i++) {
        outputRing[outputRingWrite] = heapF32[outIdx + i] / 32768;
        outputRingWrite = (outputRingWrite + 1) % 1920;
      }
      outputRingCount += FRAME_SIZE;
    }

    // Read from output ring into the 128-sample output
    if (outputRingCount >= len) {
      for (let i = 0; i < len; i++) {
        output[i] = outputRing[outputRingRead];
        outputRingRead = (outputRingRead + 1) % 1920;
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

// Resolve the WASM file URL at build time via Vite
// @ts-ignore - Vite ?url import
import rnnoiseWasmUrl from "@jitsi/rnnoise-wasm/dist/rnnoise.wasm?url";

let workletRegistered = false;
let workletBlobUrl: string | null = null;

export class RnnoiseTrackProcessor
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  name = "rnnoise-noise-suppression";

  processedTrack?: MediaStreamTrack;

  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private wasmBinary: ArrayBuffer | null = null;

  async init(opts: AudioProcessorOptions): Promise<void> {
    const { track, audioContext } = opts;

    // Fetch WASM binary once
    if (!this.wasmBinary) {
      const resp = await fetch(rnnoiseWasmUrl);
      this.wasmBinary = await resp.arrayBuffer();
    }

    // Register worklet once per app lifetime
    if (!workletRegistered) {
      const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
      workletBlobUrl = URL.createObjectURL(blob);
      await audioContext.audioWorklet.addModule(workletBlobUrl);
      workletRegistered = true;
    }

    // Build audio pipeline: source → rnnoise worklet → destination
    const stream = new MediaStream([track]);
    this.sourceNode = audioContext.createMediaStreamSource(stream);

    this.workletNode = new AudioWorkletNode(audioContext, "rnnoise-processor", {
      channelCount: 1,
      channelCountMode: "explicit",
    });

    this.destinationNode = audioContext.createMediaStreamDestination();

    this.sourceNode.connect(this.workletNode);
    this.workletNode.connect(this.destinationNode);

    // Send WASM binary to the worklet for compilation
    this.workletNode.port.postMessage(
      { type: "wasm", binary: this.wasmBinary.slice(0) },
    );

    this.processedTrack = this.destinationNode.stream.getAudioTracks()[0];
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    // Reconnect source node to existing worklet pipeline
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    const stream = new MediaStream([opts.track]);
    this.sourceNode = opts.audioContext.createMediaStreamSource(stream);

    if (this.workletNode) {
      this.sourceNode.connect(this.workletNode);
    }
  }

  async destroy(): Promise<void> {
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.processedTrack) {
      this.processedTrack.stop();
      this.processedTrack = undefined;
    }
    this.destinationNode = null;
  }
}
