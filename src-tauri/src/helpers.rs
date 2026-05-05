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
}
