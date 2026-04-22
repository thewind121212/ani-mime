import { playAudio, playAudioFromUrl, AUDIO_NAMES, type AudioName, type PlayAudioOptions } from "../utils/audio";

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
/**
 * Stored as a plain string in settings.json. Values:
 *   - one of AUDIO_NAMES (bundled default)        e.g. "kalimba"
 *   - a custom sound id starting with "custom-"    e.g. "custom-1720000000"
 *   - "none" sentinel (silence just this case)
 */
export type SoundChoice = string;

export type SoundOverrides = Record<string, SoundChoice>;

/** The result of resolving a case through the override map. */
export type ResolvedSound =
  | { kind: "bundled"; name: AudioName }
  | { kind: "custom"; id: string };

function isBundled(s: string): s is AudioName {
  return (AUDIO_NAMES as readonly string[]).includes(s);
}

function isCustomId(s: string): boolean {
  return s.startsWith("custom-");
}

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
 * Returns null when the user has silenced this specific case ("none") or when
 * the stored choice is an unknown value (e.g. a custom sound that was deleted).
 */
export function resolveSound(
  c: SoundCase,
  overrides: SoundOverrides
): ResolvedSound | null {
  const raw = overrides[c.id] ?? c.sound;
  if (raw === NONE) return null;
  if (isBundled(raw)) return { kind: "bundled", name: raw };
  if (isCustomId(raw)) return { kind: "custom", id: raw };
  return null;
}

/**
 * Play a resolved sound via the correct backend (bundled lookup vs. blob URL).
 * `customResolver` translates a custom id into a URL on demand, so callers can
 * plug in their own URL cache (see useCustomSounds.getSoundUrl).
 */
export async function playResolvedSound(
  resolved: ResolvedSound,
  options: PlayAudioOptions = {},
  customResolver: (id: string) => Promise<string | null>
): Promise<HTMLAudioElement | null> {
  if (resolved.kind === "bundled") {
    return playAudio(resolved.name, options);
  }
  const url = await customResolver(resolved.id);
  if (!url) return null;
  return playAudioFromUrl(url, options);
}

/**
 * Play a sound case for preview. Strips `loop` so the clip ends on its own,
 * but preserves other playOptions (e.g. boosted volume) for an accurate audition.
 * Respects user overrides, including "none" (preview no-op).
 */
export function playSoundCase(
  c: SoundCase,
  overrides: SoundOverrides,
  customResolver: (id: string) => Promise<string | null>
): void {
  const resolved = resolveSound(c, overrides);
  if (!resolved) return;
  const opts: PlayAudioOptions = { ...(c.playOptions ?? {}), loop: false };
  void playResolvedSound(resolved, opts, customResolver);
}

/** Preview any sound by its stored choice (used by the Sound Library play buttons). */
export function playChoice(
  choice: SoundChoice,
  customResolver: (id: string) => Promise<string | null>
): void {
  if (choice === NONE) return;
  if (isBundled(choice)) {
    playAudio(choice);
    return;
  }
  if (isCustomId(choice)) {
    void customResolver(choice).then((url) => {
      if (url) playAudioFromUrl(url);
    });
  }
}

export function findStatusCase(id: string): SoundCase | undefined {
  return STATUS_SOUND_CASES.find((c) => c.id === id);
}

export function findVisitCase(id: string): SoundCase | undefined {
  return VISIT_SOUND_CASES.find((c) => c.id === id);
}
