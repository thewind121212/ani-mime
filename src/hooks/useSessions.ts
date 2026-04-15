import { invoke } from "@tauri-apps/api/core";

export interface SessionInfo {
  pid: number;
  title: string;
  ui_state: string;
  pwd: string;
  tty: string;
  busy_type: string;
  has_claude: boolean;
  claude_pid: number | null;
  /** Name of the foreground command currently running in this shell, or "" if idle. */
  fg_cmd: string;
}

export async function fetchSessions(): Promise<SessionInfo[]> {
  return invoke<SessionInfo[]>("get_sessions");
}
