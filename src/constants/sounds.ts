import { playAudio, type AudioName, type PlayAudioOptions } from "../utils/audio";

export interface SoundCase {
  id: string;
  label: string;
  description: string;
  /** Built-in default sound. Users can override via the Sound settings. */
  sound: AudioName;
  playOptions?: PlayAudioOptions;
}

/** Special sentinel meaning "silence this specific case". Stored in overrides. */
export const NONE = "none" as const;
export type SoundChoice = AudioName | typeof NONE;

export type SoundOverrides = Record<string, SoundChoice>;

/** Every status-related sound trigger. Order here drives the settings UI order. */
export const STATUS_SOUND_CASES: readonly SoundCase[] = [
  {
    id: "searching",
    label: "Searching",
    description: "App just launched, looking for terminal sessions.",
    sound: "kalimba",
  },
  {
    id: "idle",
    label: "Idle",
    description: "No commands running — the default resting state.",
    sound: "kalimba",
  },
  {
    id: "working",
    label: "Working",
    description: "A terminal command is actively running (looped while busy).",
    sound: "page-turn",
    playOptions: { loop: true, volume: 3 },
  },
  {
    id: "done",
    label: "Done",
    description: "A task has just finished.",
    sound: "done",
  },
  {
    id: "service",
    label: "Service",
    description: "A long-running process (e.g. dev server) is active.",
    sound: "kalimba",
  },
  {
    id: "disconnected",
    label: "Disconnected",
    description: "No terminal sessions connected.",
    sound: "kalimba",
  },
  {
    id: "visiting",
    label: "Visiting",
    description: "Your mime is away visiting a friend.",
    sound: "kalimba",
  },
] as const;

export const VISIT_SOUND_CASES: readonly SoundCase[] = [
  {
    id: "visitor-arrived",
    label: "Visitor Arrived",
    description: "A friend's mime arrives at your window.",
    sound: "doorbell",
  },
] as const;

/**
 * Resolve the effective sound for a case given the user's override map.
 * Returns null when the user has silenced this specific case ("none").
 */
export function resolveSound(
  c: SoundCase,
  overrides: SoundOverrides
): AudioName | null {
  const override = overrides[c.id];
  if (override === NONE) return null;
  if (override) return override;
  return c.sound;
}

/**
 * Play a sound case for preview. Strips `loop` so the clip ends on its own,
 * but preserves other playOptions (e.g. boosted volume) for an accurate audition.
 * Respects user overrides, including "none" (preview no-op).
 */
export function playSoundCase(c: SoundCase, overrides: SoundOverrides): void {
  const resolved = resolveSound(c, overrides);
  if (!resolved) return;
  const opts: PlayAudioOptions = { ...(c.playOptions ?? {}), loop: false };
  playAudio(resolved, opts);
}

export function findStatusCase(id: string): SoundCase | undefined {
  return STATUS_SOUND_CASES.find((c) => c.id === id);
}

export function findVisitCase(id: string): SoundCase | undefined {
  return VISIT_SOUND_CASES.find((c) => c.id === id);
}
