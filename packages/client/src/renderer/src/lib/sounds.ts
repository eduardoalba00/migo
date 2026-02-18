// Sound effect manager for voice events and notifications

const soundCache = new Map<string, HTMLAudioElement>();

// Base64-encoded minimal beep sounds (to avoid external files)
// In production, replace these with actual sound file paths
function createTone(frequency: number, duration: number, volume = 0.3): HTMLAudioElement {
  const audioContext = new AudioContext();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.frequency.value = frequency;
  gainNode.gain.value = volume;

  const offlineCtx = new OfflineAudioContext(1, audioContext.sampleRate * duration, audioContext.sampleRate);
  const osc = offlineCtx.createOscillator();
  const gain = offlineCtx.createGain();

  osc.connect(gain);
  gain.connect(offlineCtx.destination);
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, 0);
  gain.gain.exponentialRampToValueAtTime(0.001, duration);
  osc.start(0);
  osc.stop(duration);

  const audio = new Audio();
  offlineCtx.startRendering().then((buffer) => {
    const wavBlob = bufferToWav(buffer);
    audio.src = URL.createObjectURL(wavBlob);
  });

  return audio;
}

function bufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitsPerSample = 16;

  const data = buffer.getChannelData(0);
  const dataLength = data.length * (bitsPerSample / 8);
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  const samples = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    samples[i] = Math.max(-1, Math.min(1, data[i])) * 0x7fff;
  }

  return new Blob([header, samples.buffer], { type: "audio/wav" });
}

let soundVolume = 0.5;

export function setSoundVolume(vol: number) {
  soundVolume = Math.max(0, Math.min(1, vol));
}

export function getSoundVolume() {
  return soundVolume;
}

function getOrCreateSound(key: string, freq: number, duration: number): HTMLAudioElement {
  if (!soundCache.has(key)) {
    soundCache.set(key, createTone(freq, duration, 0.3));
  }
  return soundCache.get(key)!;
}

export function playJoinSound() {
  const audio = getOrCreateSound("join", 880, 0.15);
  audio.volume = soundVolume;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

export function playLeaveSound() {
  const audio = getOrCreateSound("leave", 440, 0.2);
  audio.volume = soundVolume;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

export function playMuteSound() {
  const audio = getOrCreateSound("mute", 330, 0.1);
  audio.volume = soundVolume;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

export function playUnmuteSound() {
  const audio = getOrCreateSound("unmute", 660, 0.1);
  audio.volume = soundVolume;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

export function playMessageSound() {
  const audio = getOrCreateSound("message", 1000, 0.08);
  audio.volume = soundVolume * 0.5;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

export function playMentionSound() {
  const audio = getOrCreateSound("mention", 1200, 0.15);
  audio.volume = soundVolume;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

function createTwoTone(
  freq1: number,
  freq2: number,
  duration: number,
  volume = 0.3,
): HTMLAudioElement {
  const sampleRate = 44100;
  const offlineCtx = new OfflineAudioContext(1, sampleRate * duration, sampleRate);
  const half = duration / 2;

  // First tone
  const osc1 = offlineCtx.createOscillator();
  const gain1 = offlineCtx.createGain();
  osc1.connect(gain1);
  gain1.connect(offlineCtx.destination);
  osc1.frequency.value = freq1;
  gain1.gain.setValueAtTime(volume, 0);
  gain1.gain.exponentialRampToValueAtTime(0.001, half);
  osc1.start(0);
  osc1.stop(half);

  // Second tone
  const osc2 = offlineCtx.createOscillator();
  const gain2 = offlineCtx.createGain();
  osc2.connect(gain2);
  gain2.connect(offlineCtx.destination);
  osc2.frequency.value = freq2;
  gain2.gain.setValueAtTime(volume, half);
  gain2.gain.exponentialRampToValueAtTime(0.001, duration);
  osc2.start(half);
  osc2.stop(duration);

  const audio = new Audio();
  offlineCtx.startRendering().then((buffer) => {
    const wavBlob = bufferToWav(buffer);
    audio.src = URL.createObjectURL(wavBlob);
  });

  return audio;
}

function getOrCreateTwoToneSound(
  key: string,
  freq1: number,
  freq2: number,
  duration: number,
): HTMLAudioElement {
  if (!soundCache.has(key)) {
    soundCache.set(key, createTwoTone(freq1, freq2, duration, 0.3));
  }
  return soundCache.get(key)!;
}

export function playScreenShareStartSound() {
  const audio = getOrCreateTwoToneSound("screen-share-start", 880, 1320, 0.2);
  audio.volume = soundVolume;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

export function playScreenShareStopSound() {
  const audio = getOrCreateTwoToneSound("screen-share-stop", 660, 440, 0.2);
  audio.volume = soundVolume;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}
