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
}
