//! Claude Code `/usage` scraper.
//!
//! `/usage` is a REPL-only slash command, so we spawn `claude` in a pty,
//! write `/usage\n`, capture stdout, strip ANSI, and return the cleaned text.
//! Results are cached in `AppState` for 30 seconds.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct UsageResult {
    pub text: String,
    pub fetched_at: u64,
}

#[derive(Debug, Clone)]
pub struct UsageCache {
    pub text: String,
    pub fetched_at: u64,
}

const CACHE_TTL_SECS: u64 = 30;

/// Strip ANSI escape sequences (CSI / OSC / cursor moves) and drop bare
/// carriage returns. Preserves printable text including multi-byte UTF-8.
#[must_use]
pub fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1B}' {
            match chars.next() {
                Some('[') => {
                    // CSI: consume until a final byte in 0x40..=0x7E.
                    while let Some(&nc) = chars.peek() {
                        chars.next();
                        let code = nc as u32;
                        if (0x40..=0x7E).contains(&code) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    // OSC: terminated by BEL (0x07) or ST (ESC \).
                    while let Some(&nc) = chars.peek() {
                        if nc == '\u{07}' {
                            chars.next();
                            break;
                        }
                        if nc == '\u{1B}' {
                            chars.next();
                            if let Some(&'\\') = chars.peek() {
                                chars.next();
                            }
                            break;
                        }
                        chars.next();
                    }
                }
                Some(_) => {
                    // Two-byte escape (e.g. ESC =, ESC >, ESC c) — already consumed.
                }
                None => break,
            }
            continue;
        }
        if c == '\r' {
            continue;
        }
        out.push(c);
    }
    out
}

use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug)]
pub enum UsageError {
    CliNotFound,
    Timeout,
    Spawn(String),
    Io(String),
}

impl std::fmt::Display for UsageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UsageError::CliNotFound => write!(f, "Claude Code CLI not found."),
            UsageError::Timeout => write!(f, "Couldn't reach Claude. Try again."),
            UsageError::Spawn(e) => write!(f, "Couldn't run claude /usage. ({e})"),
            UsageError::Io(e) => write!(f, "Couldn't run claude /usage. ({e})"),
        }
    }
}

const FETCH_TIMEOUT: Duration = Duration::from_secs(10);
const QUIESCENT_WINDOW: Duration = Duration::from_millis(700);

/// Spawn `claude` in a pty, send `/usage`, capture and ANSI-strip the output.
///
/// Heuristic: read bytes until no new data arrives for `QUIESCENT_WINDOW`,
/// or the overall `FETCH_TIMEOUT` elapses. Then kill the child and return.
pub fn fetch_usage_via_pty() -> Result<String, UsageError> {
    // Confirm `claude` exists on PATH before spawning a pty.
    let found = std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).any(|p| p.join("claude").is_file()))
        .unwrap_or(false);
    if !found {
        return Err(UsageError::CliNotFound);
    }

    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            rows: 40,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| UsageError::Spawn(e.to_string()))?;

    let mut cmd = CommandBuilder::new("claude");
    if let Some(home) = dirs::home_dir() {
        cmd.cwd(home);
    }

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| UsageError::Spawn(e.to_string()))?;
    drop(pair.slave);

    let mut writer = pair
        .master
        .take_writer()
        .map_err(|e| UsageError::Io(e.to_string()))?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| UsageError::Io(e.to_string()))?;

    // Give the REPL ~1s to draw its prompt before we send the slash command —
    // otherwise input may be swallowed by the splash screen.
    std::thread::sleep(Duration::from_millis(1000));
    writer
        .write_all(b"/usage\r")
        .map_err(|e| UsageError::Io(e.to_string()))?;
    writer.flush().ok();

    let started = Instant::now();
    let mut last_read = Instant::now();
    let mut acc = Vec::<u8>::new();

    // Run the reader on a background thread so we can poll for quiescence.
    let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    loop {
        if started.elapsed() >= FETCH_TIMEOUT {
            let _ = child.kill();
            return Err(UsageError::Timeout);
        }
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(chunk) => {
                acc.extend_from_slice(&chunk);
                last_read = Instant::now();
            }
            Err(_) => {
                if !acc.is_empty() && last_read.elapsed() >= QUIESCENT_WINDOW {
                    break;
                }
            }
        }
    }

    let _ = child.kill();
    let _ = child.wait();

    let text = String::from_utf8_lossy(&acc).to_string();
    let stripped = strip_ansi(&text);
    Ok(extract_usage_section(&stripped))
}

/// Trim REPL noise so users only see the `/usage` output itself.
/// Keep lines from the first line that mentions "usage" (case-insensitive)
/// onward, dropping the prompt banner above it. If we can't find such a
/// line, return the input as-is — better to show too much than nothing.
fn extract_usage_section(stripped: &str) -> String {
    let lower = stripped.to_lowercase();
    if let Some(idx) = lower.find("usage") {
        let line_start = stripped[..idx].rfind('\n').map(|i| i + 1).unwrap_or(0);
        return stripped[line_start..].trim_end().to_string();
    }
    stripped.trim_end().to_string()
}

fn now_secs() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Returns the cached usage if fresh (≤30s) and `force_refresh` is false;
/// otherwise spawns `claude /usage`, caches the result, returns it.
///
/// Concurrent callers are coalesced via a global mutex around the spawn —
/// the second caller blocks until the first finishes and then reads the
/// cache instead of re-spawning.
pub fn get_or_fetch_usage(
    state: &Arc<Mutex<crate::state::AppState>>,
    force_refresh: bool,
) -> Result<UsageResult, String> {
    if !force_refresh {
        if let Some(cache) = state.lock().ok().and_then(|s| s.usage_cache.clone()) {
            if now_secs().saturating_sub(cache.fetched_at) <= CACHE_TTL_SECS {
                return Ok(UsageResult {
                    text: cache.text,
                    fetched_at: cache.fetched_at,
                });
            }
        }
    }

    // Serialize fetches so concurrent clicks don't spawn N processes.
    static FETCH_LOCK: Mutex<()> = Mutex::new(());
    let _guard = FETCH_LOCK
        .lock()
        .map_err(|e| format!("usage fetch lock poisoned: {e}"))?;

    // Re-check the cache after acquiring the lock: another caller may have
    // refreshed it while we were waiting.
    if !force_refresh {
        if let Some(cache) = state.lock().ok().and_then(|s| s.usage_cache.clone()) {
            if now_secs().saturating_sub(cache.fetched_at) <= CACHE_TTL_SECS {
                return Ok(UsageResult {
                    text: cache.text,
                    fetched_at: cache.fetched_at,
                });
            }
        }
    }

    let text = fetch_usage_via_pty().map_err(|e| e.to_string())?;
    let fetched_at = now_secs();
    if let Ok(mut s) = state.lock() {
        s.usage_cache = Some(UsageCache {
            text: text.clone(),
            fetched_at,
        });
    }
    Ok(UsageResult { text, fetched_at })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_csi_color_codes() {
        let input = "\x1b[31mRED\x1b[0m plain";
        assert_eq!(strip_ansi(input), "RED plain");
    }

    #[test]
    fn strips_cursor_moves() {
        let input = "before\x1b[2Aafter";
        assert_eq!(strip_ansi(input), "beforeafter");
    }

    #[test]
    fn strips_osc_with_bel_terminator() {
        let input = "x\x1b]0;window title\x07y";
        assert_eq!(strip_ansi(input), "xy");
    }

    #[test]
    fn strips_osc_with_st_terminator() {
        let input = "x\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\y";
        assert_eq!(strip_ansi(input), "xlinky");
    }

    #[test]
    fn drops_carriage_returns() {
        let input = "line1\r\nline2\r\n";
        assert_eq!(strip_ansi(input), "line1\nline2\n");
    }

    #[test]
    fn keeps_plain_text_untouched() {
        let input = "5h session: 42% — resets in 2h 18m\n";
        assert_eq!(strip_ansi(input), "5h session: 42% — resets in 2h 18m\n");
    }

    #[test]
    fn lone_esc_at_eof_does_not_panic() {
        assert_eq!(strip_ansi("abc\x1b"), "abc");
    }

    #[test]
    fn empty_input_returns_empty() {
        assert_eq!(strip_ansi(""), "");
    }
}
