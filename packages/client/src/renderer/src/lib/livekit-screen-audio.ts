import { Room, Track, LocalAudioTrack } from "livekit-client";

// Inline worklet source — avoids needing a separate file URL for addModule().
//
// Ring buffer design:
// - `available` is computed from writePos/readPos (no separate counter that can drift)
// - `write()` drops excess samples on overrun (reports count for diagnostics)
// - Pre-buffering: delays first read until enough samples are buffered to absorb jitter
// - Diagnostic counters (underruns, overruns) reported periodically to renderer
const WORKLET_SOURCE = `
const RING_BUFFER_SIZE = 48000 * 2 * 4 + 1; // ~4 seconds stereo + sentinel
const PRE_BUFFER_SAMPLES = 1920;             // ~20ms pre-buffer (2 WASAPI chunks)

class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(RING_BUFFER_SIZE);
    this.writePos = 0;
    this.readPos = 0;
    this.started = false;
    this.underrunCount = 0;
    this.overrunSamples = 0;
    this.processCount = 0;

    this.port.onmessage = (event) => {
      const incoming = event.data;
      const len = incoming.length;
      const avail = this._available();
      const freeSpace = RING_BUFFER_SIZE - 1 - avail;
      const toWrite = Math.min(len, freeSpace);

      if (len > freeSpace) {
        this.overrunSamples += len - freeSpace;
      }

      // Fast path: no wraparound
      const endPos = this.writePos + toWrite;
      if (endPos <= RING_BUFFER_SIZE) {
        this.buffer.set(incoming.subarray(0, toWrite), this.writePos);
        this.writePos = endPos === RING_BUFFER_SIZE ? 0 : endPos;
      } else {
        const firstChunk = RING_BUFFER_SIZE - this.writePos;
        this.buffer.set(incoming.subarray(0, firstChunk), this.writePos);
        const secondChunk = toWrite - firstChunk;
        this.buffer.set(incoming.subarray(firstChunk, firstChunk + secondChunk), 0);
        this.writePos = secondChunk;
      }
    };
  }

  _available() {
    const diff = this.writePos - this.readPos;
    return diff >= 0 ? diff : diff + RING_BUFFER_SIZE;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;
    const left = output[0];
    const right = output[1];
    const frames = left.length;
    const samplesNeeded = frames * 2;

    // Pre-buffering: wait until enough data is accumulated to absorb jitter
    if (!this.started) {
      if (this._available() >= PRE_BUFFER_SAMPLES) {
        this.started = true;
      } else {
        left.fill(0);
        right.fill(0);
        return true;
      }
    }

    const avail = this._available();
    if (avail >= samplesNeeded) {
      for (let i = 0; i < frames; i++) {
        left[i] = this.buffer[this.readPos];
        this.readPos = (this.readPos + 1) % RING_BUFFER_SIZE;
        right[i] = this.buffer[this.readPos];
        this.readPos = (this.readPos + 1) % RING_BUFFER_SIZE;
      }
    } else {
      this.underrunCount++;
      left.fill(0);
      right.fill(0);
    }

    // Report diagnostics every ~5 seconds (1875 process calls at 128 frames / 48kHz)
    this.processCount++;
    if (this.processCount % 1875 === 0) {
      this.port.postMessage({
        type: 'stats',
        underruns: this.underrunCount,
        overruns: this.overrunSamples,
        bufferLevel: this._available(),
        processCount: this.processCount,
      });
    }

    return true;
  }
}
registerProcessor("audio-capture-processor", AudioCaptureProcessor);
`;

export class ScreenShareAudioPipeline {
  private screenAudioContext: AudioContext | null = null;
  private screenAudioWorklet: AudioWorkletNode | null = null;
  private screenAudioCleanup: (() => void) | null = null;

  async start(room: Room, sourceId: string, sourceType: "window" | "screen"): Promise<void> {
    try {
      const available = await window.audioCaptureAPI.isAvailable();
      if (!available) return;

      const started = await window.audioCaptureAPI.start(sourceId, sourceType);
      if (!started) return;

      // Create AudioContext → AudioWorklet → MediaStreamDestination pipeline
      this.screenAudioContext = new AudioContext({ sampleRate: 48000 });

      const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
      const workletUrl = URL.createObjectURL(blob);
      await this.screenAudioContext.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      this.screenAudioWorklet = new AudioWorkletNode(
        this.screenAudioContext,
        "audio-capture-processor",
        { outputChannelCount: [2] },
      );

      // Listen for diagnostic stats from the worklet
      this.screenAudioWorklet.port.onmessage = (event) => {
        if (event.data?.type === "stats") {
          const { underruns, overruns, bufferLevel, processCount } = event.data;
          if (underruns > 0 || overruns > 0) {
            console.warn(
              `[screen-audio] underruns=${underruns} overruns=${overruns} ` +
                `bufferLevel=${bufferLevel} processCount=${processCount}`,
            );
          }
        }
      };

      const destination = this.screenAudioContext.createMediaStreamDestination();
      this.screenAudioWorklet.connect(destination);

      // Forward WASAPI PCM buffers to the worklet
      const removeListener = window.audioCaptureAPI.onData((buffer) => {
        this.screenAudioWorklet?.port.postMessage(buffer, [buffer.buffer]);
      });
      this.screenAudioCleanup = removeListener;

      // Publish the audio track to LiveKit as screen share audio
      const audioTrack = destination.stream.getAudioTracks()[0];
      if (audioTrack) {
        const localTrack = new LocalAudioTrack(audioTrack);
        await room.localParticipant.publishTrack(localTrack, {
          source: Track.Source.ScreenShareAudio,
        });
      }
    } catch (err) {
      console.error("Failed to start screen share audio:", err);
      await this.stop(room);
    }
  }

  async stop(room: Room | null): Promise<void> {
    // Remove IPC data listener
    if (this.screenAudioCleanup) {
      this.screenAudioCleanup();
      this.screenAudioCleanup = null;
    }

    // Stop WASAPI capture
    try {
      await window.audioCaptureAPI.stop();
    } catch {}

    // Unpublish screen share audio track from LiveKit
    if (room) {
      const pub = room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio);
      if (pub?.track) {
        await room.localParticipant.unpublishTrack(pub.track);
      }
    }

    // Tear down AudioWorklet pipeline
    if (this.screenAudioWorklet) {
      this.screenAudioWorklet.port.onmessage = null;
      this.screenAudioWorklet.disconnect();
      this.screenAudioWorklet = null;
    }
    if (this.screenAudioContext) {
      this.screenAudioContext.close().catch(() => {});
      this.screenAudioContext = null;
    }
  }
}
