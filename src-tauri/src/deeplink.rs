use tauri::{AppHandle, Emitter};
use url::Url;

const MARKETPLACE_BASE: &str = "https://snor-oh.vercel.app";

#[derive(serde::Serialize, Clone)]
pub struct InstallPromptPayload {
    pub id: String,
    pub name: String,
    pub creator: Option<String>,
    pub size_bytes: u64,
    pub preview_url: String,
    pub download_url: String,
}

/// Parse an `animime://install?id=<id>` URL and return the validated id.
/// Returns `None` if the scheme, host, id characters, or length are invalid.
pub fn extract_id(raw: &str) -> Option<String> {
    let url = Url::parse(raw).ok()?;
    if url.scheme() != "animime" {
        return None;
    }
    if url.host_str() != Some("install") {
        return None;
    }
    let id = url
        .query_pairs()
        .find(|(k, _)| k == "id")
        .map(|(_, v)| v.into_owned())?;
    if id.is_empty() || id.len() > 64 {
        return None;
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return None;
    }
    Some(id)
}

/// Fetch package metadata from the marketplace and emit either `install-prompt`
/// (on success) or `install-error` (on any failure) to the frontend.
///
/// This is a **synchronous / blocking** function. T15 must call it via
/// `tauri::async_runtime::spawn_blocking`:
///
/// ```rust
/// let h = app.clone();
/// tauri::async_runtime::spawn_blocking(move || crate::deeplink::handle(h, raw_url));
/// ```
pub fn handle(app: AppHandle, raw_url: String) {
    let Some(id) = extract_id(&raw_url) else {
        return;
    };

    let meta_url = format!("{MARKETPLACE_BASE}/api/packages/{id}");

    let agent = ureq::Agent::new_with_config(
        ureq::Agent::config_builder()
            .timeout_global(Some(std::time::Duration::from_secs(10)))
            .build(),
    );
    let mut response = match agent.get(&meta_url).call() {
        Ok(r) => r,
        Err(_) => {
            let _ = app.emit("install-error", "Marketplace fetch failed");
            return;
        }
    };

    let meta: serde_json::Value = match response.body_mut().read_json() {
        Ok(v) => v,
        Err(_) => {
            let _ = app.emit("install-error", "Malformed marketplace response");
            return;
        }
    };

    // Format check must come before any bundle download.
    if meta["format"].as_str() != Some("animime") {
        let _ = app.emit("install-error", "Wrong format — that is a .snoroh package");
        return;
    }

    let name = meta["name"].as_str().unwrap_or("");
    let size_bytes = meta["size_bytes"].as_u64().unwrap_or(0);
    if name.is_empty() || size_bytes == 0 {
        let _ = app.emit("install-error", "Incomplete marketplace response");
        return;
    }

    let payload = InstallPromptPayload {
        id: id.clone(),
        name: name.to_string(),
        creator: meta["creator"].as_str().map(String::from),
        size_bytes,
        preview_url: format!("{MARKETPLACE_BASE}/api/packages/{id}/preview"),
        download_url: format!("{MARKETPLACE_BASE}/api/packages/{id}/download"),
    };

    let _ = app.emit("install-prompt", payload);
}

#[cfg(test)]
mod tests {
    use super::extract_id;

    #[test]
    fn accepts_valid() {
        assert_eq!(
            extract_id("animime://install?id=abc-123_X&v=1").as_deref(),
            Some("abc-123_X")
        );
    }

    #[test]
    fn rejects_wrong_scheme() {
        assert_eq!(extract_id("snoroh://install?id=abc"), None);
    }

    #[test]
    fn rejects_wrong_host() {
        assert_eq!(extract_id("animime://run?id=abc"), None);
    }

    #[test]
    fn rejects_bad_chars() {
        assert_eq!(extract_id("animime://install?id=a/b"), None);
    }

    #[test]
    fn rejects_too_long() {
        let long = "a".repeat(65);
        assert_eq!(extract_id(&format!("animime://install?id={long}")), None);
    }

    #[test]
    fn rejects_empty_id() {
        assert_eq!(extract_id("animime://install?id="), None);
    }

    #[test]
    fn rejects_missing_id_param() {
        assert_eq!(extract_id("animime://install"), None);
    }
}
