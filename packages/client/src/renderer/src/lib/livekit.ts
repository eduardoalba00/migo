import {
  Room,
  RoomEvent,
  Track,
  VideoPreset,
  type RemoteParticipant,
  type RemoteTrackPublication,
  type RemoteTrack,
  type LocalTrackPublication,
} from "livekit-client";

export type SpeakingChangeCallback = (speakingUserIds: Set<string>) => void;
export type ScreenShareCallback = (userId: string, track: MediaStreamTrack | null) => void;

// Discord-style VAD thresholds
const SPEAKING_THRESHOLD = 15; // frequency bin average (0-255 range)
const SILENCE_DELAY_MS = 200;  // hold indicator briefly after silence

interface AudioAnalysis {
  analyser: AnalyserNode;
  source: MediaStreamAudioSourceNode;
  dataArray: Uint8Array;
}

export class LiveKitManager {
  private room: Room | null = null;
  private speakingCallback: SpeakingChangeCallback | null = null;
  private screenShareCallback: ScreenShareCallback | null = null;
  private selectedOutputDeviceId: string | null = null;
  private userVolumes = new Map<string, number>();

  // VAD state
  private audioContext: AudioContext | null = null;
  private analysers = new Map<string, AudioAnalysis>();
  private speakingUsers = new Set<string>();
  private lastSpokeAt = new Map<string, number>();
  private vadInterval: ReturnType<typeof setInterval> | null = null;

  // Audio elements attached to remote audio tracks
  private attachedAudioElements = new Map<string, HTMLMediaElement[]>();

  setSpeakingCallback(cb: SpeakingChangeCallback | null) {
    this.speakingCallback = cb;
  }

  setScreenShareCallback(cb: ScreenShareCallback | null) {
    this.screenShareCallback = cb;
  }

  async connect(token: string, url: string): Promise<void> {
    this.room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });

    this.audioContext = new AudioContext();
    this.setupEventListeners();

    await this.room.connect(url, token);

    this.startVADPolling();
  }

  async disconnect(): Promise<void> {
    this.stopVADPolling();
    this.cleanupAllAnalysers();
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

  async setScreenShareEnabled(enabled: boolean, sourceId?: string): Promise<void> {
    if (!this.room) return;

    if (enabled && sourceId) {
      // Electron's desktopCapturer requires the legacy mandatory constraint format
      // via getUserMedia — getDisplayMedia rejects it. Capture the stream ourselves
      // and publish the track directly to LiveKit.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: sourceId,
            maxWidth: 2560,
            maxHeight: 1440,
            maxFrameRate: 60,
          },
        } as any,
      });
      const track = stream.getVideoTracks()[0];
      track.contentHint = "motion";
      await this.room.localParticipant.publishTrack(track, {
        source: Track.Source.ScreenShare,
        name: "screen",
        screenShareEncoding: new VideoPreset(2560, 1440, 12_000_000, 60).encoding,
      });
      // Notify callback so the local user sees their own screen share
      this.screenShareCallback?.(this.room.localParticipant.identity, track);
    } else if (enabled) {
      await this.room.localParticipant.setScreenShareEnabled(true);
    } else {
      // Notify callback to remove local screen share before disabling
      this.screenShareCallback?.(this.room.localParticipant.identity, null);
      await this.room.localParticipant.setScreenShareEnabled(false);
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
    }
  }

  setOutputDevice(deviceId: string | null): void {
    this.selectedOutputDeviceId = deviceId;
    if (deviceId) {
      for (const elements of this.attachedAudioElements.values()) {
        for (const el of elements) {
          if ("setSinkId" in el) {
            (el as any).setSinkId(deviceId).catch(() => {});
          }
        }
      }
      this.room?.switchActiveDevice("audiooutput", deviceId).catch(() => {});
    }
  }

  setInputDevice(deviceId: string | null): void {
    if (this.room && deviceId) {
      this.room.switchActiveDevice("audioinput", deviceId).catch(() => {});
    }
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

  get isScreenSharing(): boolean {
    if (!this.room) return false;
    return this.room.localParticipant.isScreenShareEnabled;
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
    const localTrack = localPub?.track?.mediaStreamTrack;
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

      for (const [identity, analysis] of this.analysers) {
        analysis.analyser.getByteFrequencyData(analysis.dataArray);

        // Compute average energy across frequency bins
        let sum = 0;
        for (let i = 0; i < analysis.dataArray.length; i++) {
          sum += analysis.dataArray[i];
        }
        const avg = sum / analysis.dataArray.length;
        const loud = avg > SPEAKING_THRESHOLD;

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
    });

    this.room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (track.source === Track.Source.ScreenShare) {
          this.screenShareCallback?.(participant.identity, track.mediaStreamTrack);
          return;
        }

        if (track.kind === Track.Kind.Audio) {
          // Attach for playback
          const el = track.attach();
          const vol = this.userVolumes.get(participant.identity) ?? 1;
          el.volume = vol;
          if (this.selectedOutputDeviceId && "setSinkId" in el) {
            (el as any).setSinkId(this.selectedOutputDeviceId).catch(() => {});
          }
          const existing = this.attachedAudioElements.get(participant.identity) ?? [];
          existing.push(el);
          this.attachedAudioElements.set(participant.identity, existing);

          // Create analyser for real-time speaking detection
          this.createAnalyser(participant.identity, track.mediaStreamTrack);
        }
      },
    );

    this.room.on(
      RoomEvent.TrackUnsubscribed,
      (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (track.source === Track.Source.ScreenShare) {
          this.screenShareCallback?.(participant.identity, null);
          return;
        }

        if (track.kind === Track.Kind.Audio) {
          const detached = track.detach();
          for (const el of detached) {
            el.remove();
          }
          this.attachedAudioElements.delete(participant.identity);
          this.removeAnalyser(participant.identity);
        }
      },
    );

    this.room.on(
      RoomEvent.LocalTrackUnpublished,
      (publication: LocalTrackPublication) => {
        if (publication.source === Track.Source.ScreenShare) {
          // The store will handle state update via the screenShare toggle
        }
      },
    );
  }
}

export const livekitManager = new LiveKitManager();
