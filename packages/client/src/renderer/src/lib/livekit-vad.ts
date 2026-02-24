// Voice activity detection — RMS-based, matches any audible audio
// Uses time-domain waveform analysis (not FFT frequency bins) so the
// speaking ring activates whenever non-silent audio is actually present.
const RMS_THRESHOLD = 0.01;             // linear amplitude (~-40 dB)
const SILENCE_DELAY_MS = 200;           // hold indicator briefly after silence

interface AudioAnalysis {
  analyser: AnalyserNode;
  source: MediaStreamAudioSourceNode;
  dataArray: Float32Array;
}

export type SpeakingChangeCallback = (speakingUserIds: Set<string>) => void;

export class VoiceActivityDetector {
  private audioContext: AudioContext | null = null;
  private analysers = new Map<string, AudioAnalysis>();
  private speakingUsers = new Set<string>();
  private lastSpokeAt = new Map<string, number>();
  private vadInterval: ReturnType<typeof setInterval> | null = null;
  private speakingCallback: SpeakingChangeCallback | null = null;

  init(audioContext: AudioContext): void {
    this.audioContext = audioContext;
  }

  setSpeakingCallback(cb: SpeakingChangeCallback | null): void {
    this.speakingCallback = cb;
  }

  createAnalyser(identity: string, mediaStreamTrack: MediaStreamTrack): void {
    if (!this.audioContext || this.analysers.has(identity)) return;

    const stream = new MediaStream([mediaStreamTrack]);
    const source = this.audioContext.createMediaStreamSource(stream);
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    this.analysers.set(identity, {
      analyser,
      source,
      dataArray: new Float32Array(analyser.fftSize),
    });
  }

  removeAnalyser(identity: string): void {
    const analysis = this.analysers.get(identity);
    if (analysis) {
      analysis.source.disconnect();
      this.analysers.delete(identity);
    }
    this.speakingUsers.delete(identity);
    this.lastSpokeAt.delete(identity);
  }

  /** Fire the speaking callback with the current set (e.g. after removing a participant). */
  notifySpeakingChange(): void {
    this.speakingCallback?.(new Set(this.speakingUsers));
  }

  cleanupAll(): void {
    for (const [, analysis] of this.analysers) {
      analysis.source.disconnect();
    }
    this.analysers.clear();
    this.speakingUsers.clear();
    this.lastSpokeAt.clear();
  }

  // Poll all AnalyserNodes at 50ms — pure local audio analysis, no server round-trip
  startPolling(): void {
    this.vadInterval = setInterval(() => {
      if (!this.audioContext || this.analysers.size === 0) return;

      const now = Date.now();
      let changed = false;

      for (const [identity, analysis] of this.analysers) {
        // Time-domain waveform: each sample is -1.0 to 1.0
        analysis.analyser.getFloatTimeDomainData(analysis.dataArray);

        // Compute RMS energy — same basis as the noise gate
        let sumSq = 0;
        for (let i = 0; i < analysis.dataArray.length; i++) {
          sumSq += analysis.dataArray[i] * analysis.dataArray[i];
        }
        const rms = Math.sqrt(sumSq / analysis.dataArray.length);
        const loud = rms > RMS_THRESHOLD;

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

  stopPolling(): void {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }
  }
}
