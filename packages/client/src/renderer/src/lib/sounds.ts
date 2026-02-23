// Sound effect manager — synthesized via Web Audio API
// Soft, clean tones with smooth envelopes for a comfortable feel

let soundVolume = 0.3;
let audioCtx: AudioContext | null = null;

export function setSoundVolume(vol: number) {
  soundVolume = Math.max(0, Math.min(1, vol));
}

export function getSoundVolume() {
  return soundVolume;
}

function getCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

interface Tone {
  freq: number;
  duration: number;
  delay?: number;
}

/**
 * Play a sequence of soft tones.
 * Uses sine waves with gentle exponential fade-in/out to avoid harshness.
 */
function playTones(tones: Tone[], volumeScale = 1) {
  const ctx = getCtx();
  const vol = soundVolume * volumeScale * 0.4; // keep overall level soft
  let time = ctx.currentTime + 0.01;

  for (const tone of tones) {
    time += tone.delay ?? 0;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // Pure sine — warmest, no harmonics
    osc.type = "sine";
    osc.frequency.setValueAtTime(tone.freq, time);

    // Gentle exponential envelope — soft attack, natural decay
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(vol, time + 0.04);
    gain.gain.setValueAtTime(vol, time + tone.duration * 0.5);
    gain.gain.exponentialRampToValueAtTime(0.001, time + tone.duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(time);
    osc.stop(time + tone.duration + 0.01);
  }
}

// ─── Voice channel sounds ───────────────────────────────────────────────────────

export function playJoinSound() {
  // Gentle rising two-note chime
  playTones([
    { freq: 440, duration: 0.15 },
    { freq: 554, duration: 0.18, delay: 0.1 },
  ]);
}

export function playLeaveSound() {
  // Gentle falling two-note
  playTones([
    { freq: 494, duration: 0.15 },
    { freq: 370, duration: 0.18, delay: 0.1 },
  ]);
}

// ─── Mute / Deafen sounds ───────────────────────────────────────────────────────

export function playMuteSound() {
  // Soft low tick
  playTones([{ freq: 330, duration: 0.1 }]);
}

export function playUnmuteSound() {
  // Soft higher tick
  playTones([{ freq: 440, duration: 0.1 }]);
}

export function playDeafenSound() {
  // Gentle descending pair
  playTones([
    { freq: 415, duration: 0.12 },
    { freq: 311, duration: 0.15, delay: 0.07 },
  ]);
}

export function playUndeafenSound() {
  // Gentle ascending pair
  playTones([
    { freq: 330, duration: 0.12 },
    { freq: 440, duration: 0.15, delay: 0.07 },
  ]);
}

// ─── Screen share sounds ────────────────────────────────────────────────────────

export function playScreenShareStartSound() {
  // Soft ascending three-note
  playTones([
    { freq: 392, duration: 0.12 },
    { freq: 494, duration: 0.12, delay: 0.08 },
    { freq: 587, duration: 0.16, delay: 0.08 },
  ]);
}

export function playScreenShareStopSound() {
  // Soft descending three-note
  playTones([
    { freq: 587, duration: 0.12 },
    { freq: 494, duration: 0.12, delay: 0.08 },
    { freq: 392, duration: 0.16, delay: 0.08 },
  ]);
}

// ─── Notification sounds ────────────────────────────────────────────────────────

export function playMessageSound() {
  // Very soft single note
  playTones([{ freq: 587, duration: 0.12 }], 0.4);
}

export function playMentionSound() {
  // Gentle two-note ping
  playTones([
    { freq: 587, duration: 0.12 },
    { freq: 740, duration: 0.15, delay: 0.08 },
  ], 0.6);
}
