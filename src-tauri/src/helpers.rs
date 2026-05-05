use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

/// HTTP port for the local server. Override with ANI_MIME_PORT env var for multi-instance testing.
pub fn get_port() -> u16 {
    std::env::var("ANI_MIME_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1234)
}

/// Format an IP + port into a valid HTTP host. Wraps IPv6 in brackets.
/// Strips IPv6 zone IDs (e.g. `fe80::1%en0` → `fe80::1`) because URL parsers
/// reject them.
pub fn format_http_host(ip: &str, port: u16) -> String {
    let clean = ip.split('%').next().unwrap_or(ip);
    if clean.contains(':') {
        format!("http://[{}]:{}", clean, port)
    } else {
        format!("http://{}:{}", clean, port)
    }
}

pub fn get_query_param<'a>(url: &'a str, key: &str) -> Option<&'a str> {
    let query = url.split('?').nth(1)?;
    for pair in query.split('&') {
        let mut kv = pair.splitn(2, '=');
        if kv.next() == Some(key) {
            return kv.next();
        }
    }
    None
}

/// Parse the `lanListEnabled` boolean out of a settings.json document.
/// Returns `false` for missing key, non-bool value, or invalid JSON —
/// matches the frontend default in `useLanList` (off by default).
pub fn parse_lan_list_enabled(json: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(json)
        .ok()
        .and_then(|v| v.get("lanListEnabled").and_then(|x| x.as_bool()))
        .unwrap_or(false)
}

/// Read `lanListEnabled` from a `settings.json` file on disk. Returns
/// `false` if the file is missing, unreadable, or malformed — same default
/// as `parse_lan_list_enabled`.
pub fn read_lan_list_enabled(path: &std::path::Path) -> bool {
    match std::fs::read_to_string(path) {
        Ok(s) => parse_lan_list_enabled(&s),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_lan_list_enabled_returns_true_when_set_true() {
        let json = r#"{"lanListEnabled": true}"#;
        assert!(parse_lan_list_enabled(json));
    }

    #[test]
    fn parse_lan_list_enabled_returns_false_when_set_false() {
        let json = r#"{"lanListEnabled": false}"#;
        assert!(!parse_lan_list_enabled(json));
    }

    #[test]
    fn parse_lan_list_enabled_defaults_false_when_key_missing() {
        let json = r#"{"nickname": "Anonymous"}"#;
        assert!(!parse_lan_list_enabled(json));
    }

    #[test]
    fn parse_lan_list_enabled_defaults_false_for_invalid_json() {
        let json = "not json at all {{";
        assert!(!parse_lan_list_enabled(json));
    }

    #[test]
    fn parse_lan_list_enabled_defaults_false_for_non_bool_value() {
        let json = r#"{"lanListEnabled": "yes"}"#;
        assert!(!parse_lan_list_enabled(json));
    }

    #[test]
    fn read_lan_list_enabled_returns_false_for_missing_file() {
        let path = std::path::PathBuf::from("/tmp/ani-mime-nonexistent-settings-xyz.json");
        let _ = std::fs::remove_file(&path);
        assert!(!read_lan_list_enabled(&path));
    }

    #[test]
    fn read_lan_list_enabled_reads_true_from_real_file() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("ani-mime-test-settings-{}.json", std::process::id()));
        std::fs::write(&path, r#"{"lanListEnabled": true}"#).unwrap();
        let result = read_lan_list_enabled(&path);
        let _ = std::fs::remove_file(&path);
        assert!(result);
    }

    #[test]
    fn read_lan_list_enabled_reads_false_from_real_file() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("ani-mime-test-settings-false-{}.json", std::process::id()));
        std::fs::write(&path, r#"{"lanListEnabled": false}"#).unwrap();
        let result = read_lan_list_enabled(&path);
        let _ = std::fs::remove_file(&path);
        assert!(!result);
    }
}
