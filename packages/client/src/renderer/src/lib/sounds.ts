// Sound effect manager for voice events and notifications

const soundCache = new Map<string, HTMLAudioElement>();

let soundVolume = 0.3;

export function setSoundVolume(vol: number) {
  soundVolume = Math.max(0, Math.min(1, vol));
}

export function getSoundVolume() {
  return soundVolume;
}

function getSound(key: string, path: string): HTMLAudioElement {
  if (!soundCache.has(key)) {
    soundCache.set(key, new Audio(path));
  }
  return soundCache.get(key)!;
}

function play(key: string, path: string, volumeScale = 1) {
  const audio = getSound(key, path);
  audio.volume = soundVolume * volumeScale;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

export function playJoinSound() {
  play("join", "/sounds/join_channel.wav");
}

export function playLeaveSound() {
  play("leave", "/sounds/leave_channel.wav");
}

export function playMuteSound() {
  play("mute", "/sounds/mute.wav");
}

export function playUnmuteSound() {
  play("unmute", "/sounds/unmute.wav");
}

export function playDeafenSound() {
  play("deafen", "/sounds/deafen.wav");
}

export function playUndeafenSound() {
  play("undeafen", "/sounds/undeafen.wav");
}

export function playScreenShareStartSound() {
  play("screen-share-start", "/sounds/start_stream.wav");
}

export function playScreenShareStopSound() {
  play("screen-share-stop", "/sounds/end_stream.wav");
}

export function playMessageSound() {
  play("message", "/sounds/join_channel.wav", 0.5);
}

export function playMentionSound() {
  play("mention", "/sounds/join_channel.wav");
}
