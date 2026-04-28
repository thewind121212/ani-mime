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
  /** True if this session's PID is itself a `claude` process (created by the
   *  pid=$PPID Claude Code hook). UI hides these rows. */
  is_claude_proc: boolean;
  has_codex: boolean;
  codex_pid: number | null;
  /** True if this session's PID is itself a `codex` process. Mirrors
   *  `is_claude_proc` so the UI can hide standalone codex rows. */
  is_codex_proc: boolean;
  /** Name of the foreground command currently running in this shell, or "" if idle. */
  fg_cmd: string;
}

export async function fetchSessions(): Promise<SessionInfo[]> {
  return invoke<SessionInfo[]>("get_sessions");
}
