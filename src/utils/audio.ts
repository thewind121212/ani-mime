import pageTurn from "../assets/audio/page-turn.wav";
import doorbell from "../assets/audio/doorbell.wav";
import done from "../assets/audio/done.mp3";
import tap from "../assets/audio/tap.wav";
import kalimba from "../assets/audio/kalimba.wav";

const AUDIO_SRC = {
  "page-turn": pageTurn,
  doorbell,
  done,
  tap,
  kalimba,
} as const;

export type AudioName = keyof typeof AUDIO_SRC;

export const AUDIO_NAMES = Object.keys(AUDIO_SRC) as AudioName[];

export const AUDIO_LABELS: Record<AudioName, string> = {
  "page-turn": "Page Turn",
  doorbell: "Doorbell",
  done: "Done Chime",
  tap: "Tap",
  kalimba: "Kalimba",
};

export interface PlayAudioOptions {
  volume?: number;
  playbackRate?: number;
  loop?: boolean;
}

const cache = new Map<AudioName, HTMLAudioElement>();

function getAudio(name: AudioName): HTMLAudioElement {
  let el = cache.get(name);
  if (!el) {
    el = new Audio(AUDIO_SRC[name]);
    el.preload = "auto";
    cache.set(name, el);
  }
  return el;
}

let audioCtx: AudioContext | null = null;

function applyGain(el: HTMLAudioElement, gainValue: number): void {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const source = audioCtx.createMediaElementSource(el);
    const gain = audioCtx.createGain();
    gain.gain.value = gainValue;
    source.connect(gain).connect(audioCtx.destination);
  } catch (err) {
    console.warn("[audio] gain setup failed, falling back to clamped volume:", err);
    el.volume = 1;
  }
}

function configureAndPlay(
  el: HTMLAudioElement,
  options: PlayAudioOptions,
  label: string
): HTMLAudioElement {
  const volume = options.volume ?? 1;
  if (volume > 1) {
    applyGain(el, volume);
  } else {
    el.volume = volume;
  }
  el.playbackRate = options.playbackRate ?? 1;
  el.loop = options.loop ?? false;
  el.play().catch((err) => {
    console.warn(`[audio] failed to play "${label}":`, err);
  });
  return el;
}

export function playAudio(name: AudioName, options: PlayAudioOptions = {}): HTMLAudioElement {
  const base = getAudio(name);
  const el = base.cloneNode(true) as HTMLAudioElement;
  return configureAndPlay(el, options, name);
}

/**
 * Play an arbitrary audio URL (blob URL or asset URL). Used for user-imported
 * custom sounds whose content isn't statically bundled.
 */
export function playAudioFromUrl(url: string, options: PlayAudioOptions = {}): HTMLAudioElement {
  const el = new Audio(url);
  el.preload = "auto";
  return configureAndPlay(el, options, url);
}

export function stopAudio(el: HTMLAudioElement | null | undefined): void {
  if (!el) return;
  el.pause();
  el.currentTime = 0;
}

export function preloadAudio(names: AudioName[] = Object.keys(AUDIO_SRC) as AudioName[]): void {
  for (const name of names) {
    const el = getAudio(name);
    el.load();
  }
}
