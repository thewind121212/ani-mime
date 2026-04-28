export type Status =
  | "initializing"
  | "searching"
  | "idle"
  | "busy"
  | "service"
  | "waiting"
  | "disconnected"
  | "visiting";

export interface SpriteConfig {
  file: string;
  frames: number;
}

export type BuiltinPet = "rottweiler" | "dalmatian" | "samurai" | "hancock";

// Pet can be a built-in ID or a custom mime ID (e.g. "custom-abc123")
export type Pet = BuiltinPet | (string & {});

export type MimeCategory = "pet" | "character" | "custom";

export interface PetInfo {
  id: Pet;
  name: string;
  category: MimeCategory;
  preview: string;
  sprites: Record<Status, SpriteConfig>;
}

export interface SmartImportMeta {
  /** File name (within custom-sprites dir) of the processed source sheet PNG */
  sheetFileName: string;
  /** User-assigned frame-range strings keyed by status, e.g. "1-5", "6,7,8" */
  frameInputs: Record<Status, string>;
}

export interface CustomMimeData {
  id: string;
  name: string;
  sprites: Record<Status, { fileName: string; frames: number }>;
  /** Present only for mimes created via Smart Import. Lets us re-open them in the Smart Import editor. */
  smartImportMeta?: SmartImportMeta;
}
