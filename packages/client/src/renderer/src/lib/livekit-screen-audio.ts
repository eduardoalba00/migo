import { Room, Track, LocalAudioTrack } from "livekit-client";

// Inline worklet source — avoids needing a separate file URL for addModule()
const WORKLET_SOURCE = `
const RING_BUFFER_SIZE = 48000 * 2 * 4;
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(RING_BUFFER_SIZE);
    this.writePos = 0;
    this.readPos = 0;
    this.buffered = 0;
    this.port.onmessage = (event) => {
      const incoming = event.data;
      const len = incoming.length;
      for (let i = 0; i < len; i++) {
        this.buffer[this.writePos] = incoming[i];
        this.writePos = (this.writePos + 1) % RING_BUFFER_SIZE;
      }
      this.buffered = Math.min(this.buffered + len, RING_BUFFER_SIZE);
    };
  }
  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;
    const left = output[0];
    const right = output[1];
    const frames = left.length;
    const samplesNeeded = frames * 2;
    if (this.buffered >= samplesNeeded) {
      for (let i = 0; i < frames; i++) {
        left[i] = this.buffer[this.readPos];
        this.readPos = (this.readPos + 1) % RING_BUFFER_SIZE;
        right[i] = this.buffer[this.readPos];
        this.readPos = (this.readPos + 1) % RING_BUFFER_SIZE;
      }
      this.buffered -= samplesNeeded;
    } else {
      left.fill(0);
      right.fill(0);
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
      this.screenAudioWorklet.disconnect();
      this.screenAudioWorklet = null;
    }
    if (this.screenAudioContext) {
      this.screenAudioContext.close().catch(() => {});
      this.screenAudioContext = null;
    }
  }
}
