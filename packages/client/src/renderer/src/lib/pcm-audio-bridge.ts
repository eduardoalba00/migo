/**
 * AudioWorklet bridge: converts raw PCM Float32 audio packets (from buttercap
 * via IPC) into a standard MediaStreamTrack for LiveKit publishing.
 *
 * buttercap outputs 48kHz stereo Float32 interleaved PCM every ~20ms.
 */

const workletCode = `
class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.port.onmessage = (e) => {
      // e.data is a Uint8Array of interleaved Float32 stereo samples
      const f32 = new Float32Array(e.data.buffer, e.data.byteOffset, e.data.byteLength / 4);
      // Cap at ~200ms of audio (10 chunks at 20ms each) to prevent unbounded growth
      if (this.buffer.length >= 10) this.buffer.shift();
      this.buffer.push(f32);
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;

    const left = output[0];
    const right = output[1];
    let written = 0;

    while (written < left.length && this.buffer.length > 0) {
      const src = this.buffer[0];
      // src is interleaved: [L, R, L, R, ...]
      const samplesAvailable = src.length / 2;
      const srcOffset = 0;
      const needed = left.length - written;
      const toCopy = Math.min(needed, samplesAvailable);

      for (let i = 0; i < toCopy; i++) {
        left[written + i] = src[i * 2];
        right[written + i] = src[i * 2 + 1];
      }

      written += toCopy;

      if (toCopy >= samplesAvailable) {
        this.buffer.shift();
      } else {
        // Partial consume: keep remaining samples
        this.buffer[0] = src.subarray(toCopy * 2);
      }
    }

    return true;
  }
}

registerProcessor('pcm-player', PCMPlayerProcessor);
`;

export class PCMAudioBridge {
  private audioCtx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;

  async init(): Promise<MediaStreamTrack> {
    this.audioCtx = new AudioContext({ sampleRate: 48000 });

    const blob = new Blob([workletCode], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);
    await this.audioCtx.audioWorklet.addModule(blobUrl);
    URL.revokeObjectURL(blobUrl);

    this.workletNode = new AudioWorkletNode(this.audioCtx, "pcm-player", {
      outputChannelCount: [2],
    });
    this.destination = this.audioCtx.createMediaStreamDestination();
    this.workletNode.connect(this.destination);

    return this.destination.stream.getAudioTracks()[0];
  }

  feedPCM(data: Uint8Array): void {
    if (!this.workletNode) return;
    // Transfer the buffer to the worklet
    const copy = new Uint8Array(data);
    this.workletNode.port.postMessage(copy, [copy.buffer]);
  }

  dispose(): void {
    this.workletNode?.disconnect();
    this.audioCtx?.close().catch(() => {});
    this.workletNode = null;
    this.destination = null;
    this.audioCtx = null;
  }
}
