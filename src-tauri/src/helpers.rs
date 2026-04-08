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
pub fn format_http_host(ip: &str, port: u16) -> String {
    if ip.contains(':') {
        format!("http://[{}]:{}", ip, port)
    } else {
        format!("http://{}:{}", ip, port)
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
