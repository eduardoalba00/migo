import {
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrackPublication,
  type RemoteTrack,
  LocalAudioTrack,
} from "livekit-client";

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

export type SpeakingChangeCallback = (speakingUserIds: Set<string>) => void;
export type ScreenTrackCallback = (
  participantIdentity: string,
  track: MediaStreamTrack,
  action: "add" | "remove",
) => void;

// Discord-style VAD thresholds
const SPEAKING_THRESHOLD = 15;          // frequency bin average (0-255 range)
const SPEAKING_THRESHOLD_NS_LOCAL = 30; // higher threshold for local mic when browser NS is on
                                        // (Chromium applies NS in the WebRTC send path, not on
                                        //  the MediaStreamAudioSourceNode the analyser reads)
const SILENCE_DELAY_MS = 200;           // hold indicator briefly after silence

interface AudioAnalysis {
  analyser: AnalyserNode;
  source: MediaStreamAudioSourceNode;
  dataArray: Uint8Array;
}

export type NoiseSuppressionMode = "krisp" | "browser" | "off";

export class LiveKitManager {
  private room: Room | null = null;
  private speakingCallback: SpeakingChangeCallback | null = null;
  private screenTrackCallback: ScreenTrackCallback | null = null;
  private selectedOutputDeviceId: string | null = null;
  private userVolumes = new Map<string, number>();

  // Noise suppression state
  private noiseSuppressionEnabled = false;
  private krispProcessor: any = null;

  // VAD state
  private audioContext: AudioContext | null = null;
  private analysers = new Map<string, AudioAnalysis>();
  private speakingUsers = new Set<string>();
  private lastSpokeAt = new Map<string, number>();
  private vadInterval: ReturnType<typeof setInterval> | null = null;

  // Audio elements attached to remote audio tracks (mic only)
  private attachedAudioElements = new Map<string, HTMLMediaElement[]>();

  // Screen share audio elements, tracked separately for independent volume control
  private screenShareAudioElements = new Map<string, HTMLMediaElement[]>();
  private screenShareVolumes = new Map<string, number>();
  private screenShareMuted = new Map<string, boolean>();

  // Screen share audio (WASAPI capture)
  private screenAudioContext: AudioContext | null = null;
  private screenAudioWorklet: AudioWorkletNode | null = null;
  private screenAudioCleanup: (() => void) | null = null;

  setSpeakingCallback(cb: SpeakingChangeCallback | null) {
    this.speakingCallback = cb;
  }

  setScreenTrackCallback(cb: ScreenTrackCallback | null) {
    this.screenTrackCallback = cb;
  }

  async connect(token: string, url: string): Promise<void> {
    // Clean up any existing connection to prevent leaked Room/WebSocket
    if (this.room) {
      await this.disconnect();
    }

    this.room = new Room({
      adaptiveStream: false,
      dynacast: false,
      publishDefaults: {
        screenShareEncoding: {
          maxBitrate: 15_000_000,
          maxFramerate: 60,
        },
        screenShareSimulcastLayers: [],
        videoCodec: "vp9",
      },
    });

    this.audioContext = new AudioContext();
    this.setupEventListeners();

    await this.room.connect(url, token);

    this.startVADPolling();
  }

  async disconnect(): Promise<void> {
    this.stopVADPolling();
    this.cleanupAllAnalysers();
    await this.stopScreenShareAudio();
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    // Detach all audio elements
    for (const elements of this.attachedAudioElements.values()) {
      for (const el of elements) {
        el.srcObject = null;
        el.remove();
      }
    }
    this.attachedAudioElements.clear();

    // Detach screen share audio elements
    for (const elements of this.screenShareAudioElements.values()) {
      for (const el of elements) {
        el.srcObject = null;
        el.remove();
      }
    }
    this.screenShareAudioElements.clear();

    if (this.room) {
      await this.room.disconnect();
      this.room = null;
    }
    this.speakingUsers.clear();
    this.lastSpokeAt.clear();
  }

  async setMicEnabled(enabled: boolean): Promise<void> {
    await this.room?.localParticipant.setMicrophoneEnabled(enabled);

    // Set up analyser for local mic after enabling
    if (enabled) {
      this.setupLocalMicAnalyser();
    } else {
      this.removeAnalyser(this.room?.localParticipant.identity ?? "");
    }
  }

  setDeafened(deafened: boolean): void {
    if (!this.room) return;
    for (const participant of this.room.remoteParticipants.values()) {
      const elements = this.attachedAudioElements.get(participant.identity) ?? [];
      for (const el of elements) {
        el.muted = deafened;
        if (!deafened) {
          el.volume = this.userVolumes.get(participant.identity) ?? 1;
        }
      }
      // Also mute/unmute screen share audio
      const ssElements = this.screenShareAudioElements.get(participant.identity) ?? [];
      for (const el of ssElements) {
        el.muted = deafened || (this.screenShareMuted.get(participant.identity) ?? false);
        if (!deafened) {
          el.volume = this.screenShareVolumes.get(participant.identity) ?? 1;
        }
      }
    }
  }

  setOutputDevice(deviceId: string | null): void {
    this.selectedOutputDeviceId = deviceId;
    const sinkId = deviceId || "";
    for (const elements of this.attachedAudioElements.values()) {
      for (const el of elements) {
        if ("setSinkId" in el) {
          (el as any).setSinkId(sinkId).catch(() => {});
        }
      }
    }
    for (const elements of this.screenShareAudioElements.values()) {
      for (const el of elements) {
        if ("setSinkId" in el) {
          (el as any).setSinkId(sinkId).catch(() => {});
        }
      }
    }
    this.room?.switchActiveDevice("audiooutput", deviceId || "default").catch(() => {});
  }

  async setInputDevice(deviceId: string | null): Promise<void> {
    if (!this.room) return;
    await this.room.switchActiveDevice("audioinput", deviceId ?? "default");
    // Rebuild the local mic analyser so VAD tracks the new device
    const identity = this.room.localParticipant.identity;
    this.removeAnalyser(identity);
    this.setupLocalMicAnalyser();
  }

  setUserVolume(userId: string, volume: number): void {
    const clamped = Math.max(0, Math.min(2, volume));
    this.userVolumes.set(userId, clamped);

    const elements = this.attachedAudioElements.get(userId) ?? [];
    for (const el of elements) {
      el.volume = clamped;
    }
  }

  getUserVolume(userId: string): number {
    return this.userVolumes.get(userId) ?? 1;
  }

  setScreenShareVolume(userId: string, volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.screenShareVolumes.set(userId, clamped);

    const elements = this.screenShareAudioElements.get(userId) ?? [];
    for (const el of elements) {
      el.volume = clamped;
    }
  }

  getScreenShareVolume(userId: string): number {
    return this.screenShareVolumes.get(userId) ?? 1;
  }

  setScreenShareMuted(userId: string, muted: boolean): void {
    this.screenShareMuted.set(userId, muted);

    const elements = this.screenShareAudioElements.get(userId) ?? [];
    for (const el of elements) {
      el.muted = muted;
    }
  }

  async startScreenShare(sourceId?: string, sourceType?: "window" | "screen"): Promise<void> {
    if (!this.room) return;

    // Use LiveKit SDK's setScreenShareEnabled which calls getDisplayMedia()
    // internally. Electron's setDisplayMediaRequestHandler provides the source.
    // This uses Chrome's full WebRTC pipeline (FEC, congestion control, NACK).
    await this.room.localParticipant.setScreenShareEnabled(true, {
      audio: false,
      contentHint: "motion",
      resolution: { width: 3440, height: 1440, frameRate: 60 },
    }, {
      screenShareEncoding: {
        maxBitrate: 15_000_000,
        maxFramerate: 60,
      },
      screenShareSimulcastLayers: [],
      videoCodec: "vp9",
    });

    // Start WASAPI process audio capture if available
    if (sourceId && sourceType) {
      await this.startScreenShareAudio(sourceId, sourceType);
    }
  }

  async stopScreenShare(): Promise<void> {
    if (!this.room) return;

    // Stop WASAPI audio capture first
    await this.stopScreenShareAudio();

    await this.room.localParticipant.setScreenShareEnabled(false);
  }

  private async startScreenShareAudio(sourceId: string, sourceType: "window" | "screen"): Promise<void> {
    if (!this.room) return;

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
        await this.room!.localParticipant.publishTrack(localTrack, {
          source: Track.Source.ScreenShareAudio,
        });
      }
    } catch (err) {
      console.error("Failed to start screen share audio:", err);
      this.stopScreenShareAudio();
    }
  }

  private async stopScreenShareAudio(): Promise<void> {
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
    if (this.room) {
      const pub = this.room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio);
      if (pub?.track) {
        await this.room.localParticipant.unpublishTrack(pub.track);
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

  async setNoiseSuppression(enabled: boolean): Promise<NoiseSuppressionMode> {
    this.noiseSuppressionEnabled = enabled;

    if (!this.room) return "off";

    const localPub = this.room.localParticipant.getTrackPublication(Track.Source.Microphone);

    if (enabled) {
      // Try Krisp first
      try {
        const { KrispNoiseFilter, isKrispNoiseFilterSupported } = await import(
          "@livekit/krisp-noise-filter"
        );
        if (isKrispNoiseFilterSupported()) {
          this.krispProcessor = KrispNoiseFilter();
          const localTrack = localPub?.track;
          if (localTrack) {
            await localTrack.setProcessor(this.krispProcessor);
            this.rebuildLocalMicAnalyser();
            return "krisp";
          }
        }
      } catch {
        // Krisp not available, fall through to browser
      }

      // Fallback: browser-native noise suppression via track restart
      this.krispProcessor = null;
      await this.room.localParticipant.setMicrophoneEnabled(false);
      await this.room.localParticipant.setMicrophoneEnabled(true, {
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true,
      });
      this.rebuildLocalMicAnalyser();
      return "browser";
    } else {
      // Disable: stop processor if Krisp was active
      if (this.krispProcessor && localPub?.track) {
        await localPub.track.stopProcessor();
        this.krispProcessor = null;
        this.rebuildLocalMicAnalyser();
      } else {
        // Restart mic without constraints
        await this.room.localParticipant.setMicrophoneEnabled(false);
        await this.room.localParticipant.setMicrophoneEnabled(true);
        this.rebuildLocalMicAnalyser();
      }
      return "off";
    }
  }

  get isNoiseSuppressionEnabled(): boolean {
    return this.noiseSuppressionEnabled;
  }

  private rebuildLocalMicAnalyser(): void {
    if (!this.room) return;
    const identity = this.room.localParticipant.identity;
    this.removeAnalyser(identity);
    this.setupLocalMicAnalyser();
  }

  static async getAudioDevices(): Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      inputs: devices.filter((d) => d.kind === "audioinput"),
      outputs: devices.filter((d) => d.kind === "audiooutput"),
    };
  }

  // --- Local audio analysis (AudioContext + AnalyserNode) ---

  private createAnalyser(identity: string, mediaStreamTrack: MediaStreamTrack): void {
    if (!this.audioContext || this.analysers.has(identity)) return;

    const stream = new MediaStream([mediaStreamTrack]);
    const source = this.audioContext.createMediaStreamSource(stream);
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.3;
    source.connect(analyser);

    this.analysers.set(identity, {
      analyser,
      source,
      dataArray: new Uint8Array(analyser.frequencyBinCount),
    });
  }

  private removeAnalyser(identity: string): void {
    const analysis = this.analysers.get(identity);
    if (analysis) {
      analysis.source.disconnect();
      this.analysers.delete(identity);
    }
    this.speakingUsers.delete(identity);
    this.lastSpokeAt.delete(identity);
  }

  private cleanupAllAnalysers(): void {
    for (const [, analysis] of this.analysers) {
      analysis.source.disconnect();
    }
    this.analysers.clear();
  }

  private setupLocalMicAnalyser(): void {
    if (!this.room || !this.audioContext) return;

    const localPub = this.room.localParticipant.getTrackPublication(Track.Source.Microphone);
    // When Krisp is active, the sender's track is the processed output — use it
    // so the local VAD matches what remote participants actually hear.
    const senderTrack = this.krispProcessor
      ? (localPub?.track as any)?.sender?.track as MediaStreamTrack | undefined
      : undefined;
    const localTrack = senderTrack ?? localPub?.track?.mediaStreamTrack;
    if (localTrack) {
      this.createAnalyser(this.room.localParticipant.identity, localTrack);
    }
  }

  // Poll all AnalyserNodes at 50ms — pure local audio analysis, no server round-trip
  private startVADPolling(): void {
    this.vadInterval = setInterval(() => {
      if (!this.audioContext || this.analysers.size === 0) return;

      const now = Date.now();
      let changed = false;

      // Use a stricter threshold for the local mic when browser NS is active,
      // because Chromium applies noise suppression in the WebRTC encoder path
      // but the AnalyserNode reads the raw pre-processing audio.
      const localIdentity = this.room?.localParticipant.identity;
      const useNsThreshold =
        this.noiseSuppressionEnabled && !this.krispProcessor;

      for (const [identity, analysis] of this.analysers) {
        analysis.analyser.getByteFrequencyData(analysis.dataArray);

        // Compute average energy across frequency bins
        let sum = 0;
        for (let i = 0; i < analysis.dataArray.length; i++) {
          sum += analysis.dataArray[i];
        }
        const avg = sum / analysis.dataArray.length;
        const threshold =
          useNsThreshold && identity === localIdentity
            ? SPEAKING_THRESHOLD_NS_LOCAL
            : SPEAKING_THRESHOLD;
        const loud = avg > threshold;

        if (loud) {
          this.lastSpokeAt.set(identity, now);
        }

        const lastSpoke = this.lastSpokeAt.get(identity) ?? 0;
        const shouldBeSpeaking = loud || (now - lastSpoke < SILENCE_DELAY_MS);
        const wasSpeaking = this.speakingUsers.has(identity);

        if (shouldBeSpeaking && !wasSpeaking) {
          this.speakingUsers.add(identity);
          changed = true;
        } else if (!shouldBeSpeaking && wasSpeaking) {
          this.speakingUsers.delete(identity);
          changed = true;
        }
      }

      if (changed) {
        this.speakingCallback?.(new Set(this.speakingUsers));
      }
    }, 50);
  }

  private stopVADPolling(): void {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }
  }

  /**
   * Extract the real userId from a participant identity.
   * Screen share participants use the format "userId|screen".
   */
  private extractScreenShareUserId(identity: string): string | null {
    if (identity.endsWith("|screen")) {
      return identity.slice(0, -"|screen".length);
    }
    return null;
  }

  private setupEventListeners(): void {
    if (!this.room) return;

    // Clean up when participants leave
    this.room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      this.removeAnalyser(participant.identity);
      this.speakingCallback?.(new Set(this.speakingUsers));
      const elements = this.attachedAudioElements.get(participant.identity);
      if (elements) {
        for (const el of elements) {
          el.srcObject = null;
          el.remove();
        }
        this.attachedAudioElements.delete(participant.identity);
      }
      const ssElements = this.screenShareAudioElements.get(participant.identity);
      if (ssElements) {
        for (const el of ssElements) {
          el.srcObject = null;
          el.remove();
        }
        this.screenShareAudioElements.delete(participant.identity);
      }
    });

    this.room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          if (this.selectedOutputDeviceId && "setSinkId" in el) {
            (el as any).setSinkId(this.selectedOutputDeviceId).catch(() => {});
          }

          if (publication.source === Track.Source.ScreenShareAudio) {
            // Screen share audio → separate tracking for independent volume control
            const vol = this.screenShareVolumes.get(participant.identity) ?? 1;
            el.volume = vol;
            el.muted = this.screenShareMuted.get(participant.identity) ?? false;
            const existing = this.screenShareAudioElements.get(participant.identity) ?? [];
            existing.push(el);
            this.screenShareAudioElements.set(participant.identity, existing);
          } else {
            // Mic audio → existing behavior
            const vol = this.userVolumes.get(participant.identity) ?? 1;
            el.volume = vol;
            const existing = this.attachedAudioElements.get(participant.identity) ?? [];
            existing.push(el);
            this.attachedAudioElements.set(participant.identity, existing);

            if (publication.source === Track.Source.Microphone) {
              this.createAnalyser(participant.identity, track.mediaStreamTrack);
            }
          }
        }

        // Handle screen share video tracks — either from userId|screen
        // participants (native engine) or same-participant screen share source
        if (track.kind === Track.Kind.Video) {
          if (publication.source === Track.Source.ScreenShare) {
            // Browser-based screen share: source is ScreenShare on the same participant
            this.screenTrackCallback?.(participant.identity, track.mediaStreamTrack, "add");
          } else {
            // Native engine: separate participant with userId|screen identity
            const userId = this.extractScreenShareUserId(participant.identity);
            if (userId) {
              this.screenTrackCallback?.(userId, track.mediaStreamTrack, "add");
            }
          }
        }
      },
    );

    this.room.on(
      RoomEvent.TrackUnsubscribed,
      (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio) {
          const detached = track.detach();
          const detachedSet = new Set(detached);
          for (const el of detached) el.remove();

          if (publication.source === Track.Source.ScreenShareAudio) {
            // Clean up from screen share audio elements
            const remaining = (this.screenShareAudioElements.get(participant.identity) ?? [])
              .filter((el) => !detachedSet.has(el));
            if (remaining.length > 0) {
              this.screenShareAudioElements.set(participant.identity, remaining);
            } else {
              this.screenShareAudioElements.delete(participant.identity);
            }
          } else {
            // Clean up from mic audio elements
            const remaining = (this.attachedAudioElements.get(participant.identity) ?? [])
              .filter((el) => !detachedSet.has(el));
            if (remaining.length > 0) {
              this.attachedAudioElements.set(participant.identity, remaining);
            } else {
              this.attachedAudioElements.delete(participant.identity);
            }

            if (publication.source === Track.Source.Microphone) {
              this.removeAnalyser(participant.identity);
            }
          }
        }

        // Handle screen share video track removal
        if (track.kind === Track.Kind.Video) {
          if (publication.source === Track.Source.ScreenShare) {
            this.screenTrackCallback?.(participant.identity, track.mediaStreamTrack, "remove");
          } else {
            const userId = this.extractScreenShareUserId(participant.identity);
            if (userId) {
              this.screenTrackCallback?.(userId, track.mediaStreamTrack, "remove");
            }
          }
        }
      },
    );
  }
}

export const livekitManager = new LiveKitManager();
