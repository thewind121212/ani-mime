use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub source: String,
    pub message: String,
}

/// Cache the resolved log file path so we don't re-derive it on every poll.
static LOG_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

pub fn set_log_path(path: PathBuf) {
    *LOG_PATH.lock().unwrap() = Some(path);
}

fn get_log_path() -> Option<PathBuf> {
    LOG_PATH.lock().unwrap().clone()
}

fn parse_log_line(line: &str) -> Option<LogEntry> {
    // Format: [date][time][module][LEVEL] message
    let rest = line.strip_prefix('[')?;
    let (date, rest) = rest.split_once("][")?;
    let (time, rest) = rest.split_once("][")?;
    let (source, rest) = rest.split_once("][")?;
    let (level_raw, message) = rest.split_once("] ")?;
    Some(LogEntry {
        timestamp: format!("{} {}", date, time),
        level: level_raw.trim().to_lowercase(),
        source: source.to_string(),
        message: message.to_string(),
    })
}

pub fn read_log_file(last_n: usize) -> Vec<LogEntry> {
    let Some(path) = get_log_path() else {
        return Vec::new();
    };
    let Ok(mut file) = std::fs::File::open(&path) else {
        return Vec::new();
    };
    let file_size = file.metadata().map(|m| m.len()).unwrap_or(0);
    if file_size == 0 {
        return Vec::new();
    }

    // Read only the tail of the file — estimate ~256 bytes per log line.
    // If we seek past the start, the first line is likely partial;
    // parse_log_line returns None for it, so it's filtered automatically.
    let chunk = (last_n as u64).saturating_mul(256).min(file_size);
    if chunk < file_size {
        let _ = file.seek(SeekFrom::Start(file_size - chunk));
    }

    let reader = BufReader::new(file);
    let mut entries: Vec<LogEntry> = reader
        .lines()
        .filter_map(|line| line.ok())
        .filter_map(|line| parse_log_line(&line))
        .collect();

    let drain = entries.len().saturating_sub(last_n);
    if drain > 0 {
        entries.drain(..drain);
    }
    entries
}

pub fn clear_log_file() {
    let Some(path) = get_log_path() else { return };
    // Note: tauri-plugin-log holds its own file handle with a cached current_size.
    // After truncation, its size tracker will be stale, which may cause an early
    // rotation on the next write. Acceptable for a dev-only tool.
    if let Ok(file) = std::fs::OpenOptions::new().write(true).open(&path) {
        let _ = file.set_len(0);
    }
}

pub fn push_log(level: &'static str, msg: String) {
    match level {
        "error" => log::error!("{}", msg),
        "warn" => log::warn!("{}", msg),
        _ => log::info!("{}", msg),
    }
}

#[macro_export]
macro_rules! app_log {
    ($($arg:tt)*) => {
        $crate::logger::push_log("info", format!($($arg)*))
    };
}

#[macro_export]
macro_rules! app_warn {
    ($($arg:tt)*) => {
        $crate::logger::push_log("warn", format!($($arg)*))
    };
}

#[macro_export]
macro_rules! app_error {
    ($($arg:tt)*) => {
        $crate::logger::push_log("error", format!($($arg)*))
    };
}
