import {
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrackPublication,
  type RemoteTrack,
  LocalAudioTrack,
} from "livekit-client";
import { RnnoiseTrackProcessor } from "./rnnoise-processor";
import { VoiceActivityDetector, type SpeakingChangeCallback } from "./livekit-vad";
import { ScreenShareAudioPipeline } from "./livekit-screen-audio";

export type { SpeakingChangeCallback } from "./livekit-vad";
export type ScreenTrackCallback = (
  participantIdentity: string,
  track: MediaStreamTrack,
  action: "add" | "remove",
) => void;

export type NoiseSuppressionMode = "rnnoise" | "off";

export class LiveKitManager {
  private room: Room | null = null;
  private screenTrackCallback: ScreenTrackCallback | null = null;
  private selectedOutputDeviceId: string | null = null;
  private userVolumes = new Map<string, number>();

  // Noise suppression
  private rnnoiseProcessor: RnnoiseTrackProcessor | null = null;

  // Delegates
  private vad = new VoiceActivityDetector();
  private screenAudio = new ScreenShareAudioPipeline();

  // Audio elements attached to remote audio tracks (mic only)
  private attachedAudioElements = new Map<string, HTMLMediaElement[]>();

  // Screen share audio elements, tracked separately for independent volume control
  private screenShareAudioElements = new Map<string, HTMLMediaElement[]>();
  private screenShareVolumes = new Map<string, number>();
  private screenShareMuted = new Map<string, boolean>();

  private audioContext: AudioContext | null = null;

  getRoom(): Room | null {
    return this.room;
  }

  /** Returns the local screen share video MediaStreamTrack, if currently publishing. */
  getLocalScreenShareTrack(): MediaStreamTrack | null {
    if (!this.room) return null;
    const pub = this.room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
    return pub?.track?.mediaStreamTrack ?? null;
  }

  setSpeakingCallback(cb: SpeakingChangeCallback | null) {
    this.vad.setSpeakingCallback(cb);
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
    this.vad.init(this.audioContext);
    this.setupEventListeners();

    await this.room.connect(url, token);

    this.vad.startPolling();
  }

  async disconnect(): Promise<void> {
    this.vad.stopPolling();
    this.vad.cleanupAll();
    // Clean up RNNoise processor before disconnecting
    if (this.rnnoiseProcessor) {
      const localPub = this.room?.localParticipant.getTrackPublication(Track.Source.Microphone);
      const localTrack = localPub?.track as LocalAudioTrack | undefined;
      if (localTrack) {
        await localTrack.stopProcessor().catch(() => {});
      }
      this.rnnoiseProcessor = null;
    }
    await this.screenAudio.stop(this.room);
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
  }

  async setMicEnabled(enabled: boolean): Promise<void> {
    await this.room?.localParticipant.setMicrophoneEnabled(enabled);

    // Set up analyser for local mic after enabling
    if (enabled) {
      this.setupLocalMicAnalyser();
    } else {
      this.vad.removeAnalyser(this.room?.localParticipant.identity ?? "");
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
    this.vad.removeAnalyser(identity);
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
      await this.screenAudio.start(this.room, sourceId, sourceType);
    }
  }

  async stopScreenShare(): Promise<void> {
    if (!this.room) return;

    // Stop WASAPI audio capture first
    await this.screenAudio.stop(this.room);

    await this.room.localParticipant.setScreenShareEnabled(false);
  }

  async setNoiseSuppression(enabled: boolean): Promise<NoiseSuppressionMode> {
    if (!this.room) return "off";

    const localPub = this.room.localParticipant.getTrackPublication(Track.Source.Microphone);
    const localTrack = localPub?.track as LocalAudioTrack | undefined;
    if (!localTrack) return "off";

    if (enabled) {
      if (!this.rnnoiseProcessor) {
        this.rnnoiseProcessor = new RnnoiseTrackProcessor();
      }
      await localTrack.setProcessor(this.rnnoiseProcessor);
    } else {
      await localTrack.stopProcessor();
    }

    // Rebuild VAD analyser so it reads from the processed (or raw) track
    const identity = this.room.localParticipant.identity;
    this.vad.removeAnalyser(identity);
    this.setupLocalMicAnalyser();

    return enabled ? "rnnoise" : "off";
  }

  static async getAudioDevices(): Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      inputs: devices.filter((d) => d.kind === "audioinput"),
      outputs: devices.filter((d) => d.kind === "audiooutput"),
    };
  }

  private setupLocalMicAnalyser(): void {
    if (!this.room || !this.audioContext) return;

    const localPub = this.room.localParticipant.getTrackPublication(Track.Source.Microphone);
    const localTrack = localPub?.track?.mediaStreamTrack;
    if (localTrack) {
      this.vad.createAnalyser(this.room.localParticipant.identity, localTrack);
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
      this.vad.removeAnalyser(participant.identity);
      this.vad.notifySpeakingChange();
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
            el.muted = this.screenShareMuted.get(participant.identity) ?? true;
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
              this.vad.createAnalyser(participant.identity, track.mediaStreamTrack);
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
              this.vad.removeAnalyser(participant.identity);
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
