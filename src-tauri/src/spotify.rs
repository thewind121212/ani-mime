use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub const REDIRECT_URI: &str = "http://127.0.0.1:1234/spotify/callback";
const SCOPES: &str = "user-read-playback-state user-modify-playback-state user-read-currently-playing";

const KEY_CLIENT_ID: &str = "spotifyClientId";
const KEY_ACCESS: &str = "spotifyAccessToken";
const KEY_REFRESH: &str = "spotifyRefreshToken";
const KEY_EXPIRES_AT: &str = "spotifyExpiresAt";

/// Pending PKCE state — held in memory between auth-start and callback.
/// Single-flight: starting a second auth replaces it. Cleared on success.
#[derive(Debug, Clone)]
pub struct PendingAuth {
    pub state: String,
    pub code_verifier: String,
    pub client_id: String,
}

pub static PENDING_AUTH: Mutex<Option<PendingAuth>> = Mutex::new(None);

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct SpotifyConfig {
    pub client_id: String,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64,
}

impl SpotifyConfig {
    pub fn is_connected(&self) -> bool {
        !self.access_token.is_empty() && !self.refresh_token.is_empty()
    }
    pub fn is_expired(&self, now: u64) -> bool {
        // 30s safety margin so we don't fire a request that expires mid-flight.
        self.expires_at <= now.saturating_add(30)
    }
}

pub fn load_config(store_path: &Path) -> SpotifyConfig {
    let raw = match std::fs::read_to_string(store_path) {
        Ok(c) => c,
        Err(_) => return SpotifyConfig::default(),
    };
    let json: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return SpotifyConfig::default(),
    };
    SpotifyConfig {
        client_id: json
            .get(KEY_CLIENT_ID)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        access_token: json
            .get(KEY_ACCESS)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        refresh_token: json
            .get(KEY_REFRESH)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        expires_at: json
            .get(KEY_EXPIRES_AT)
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
    }
}

/// Persist tokens directly into settings.json. The frontend reads via
/// tauri-plugin-store, but writes from the backend bypass the plugin —
/// we manipulate the same file directly. Plugin reloads on next read.
pub fn save_tokens(
    store_path: &Path,
    access_token: &str,
    refresh_token: &str,
    expires_at: u64,
) -> Result<(), String> {
    let mut json: serde_json::Value = std::fs::read_to_string(store_path)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    if !json.is_object() {
        json = serde_json::json!({});
    }
    let map = json.as_object_mut().unwrap();
    map.insert(KEY_ACCESS.into(), serde_json::Value::String(access_token.into()));
    map.insert(KEY_REFRESH.into(), serde_json::Value::String(refresh_token.into()));
    map.insert(KEY_EXPIRES_AT.into(), serde_json::Value::Number(expires_at.into()));

    if let Some(parent) = store_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(store_path, serde_json::to_string_pretty(&json).unwrap())
        .map_err(|e| format!("Failed to write settings.json: {}", e))
}

pub fn clear_tokens(store_path: &Path) -> Result<(), String> {
    let mut json: serde_json::Value = std::fs::read_to_string(store_path)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    if let Some(map) = json.as_object_mut() {
        map.remove(KEY_ACCESS);
        map.remove(KEY_REFRESH);
        map.remove(KEY_EXPIRES_AT);
    }
    std::fs::write(store_path, serde_json::to_string_pretty(&json).unwrap())
        .map_err(|e| format!("Failed to write settings.json: {}", e))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn random_url_safe(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill(&mut buf[..]);
    URL_SAFE_NO_PAD.encode(buf)
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

/// Build the authorize URL and remember the PKCE verifier + state. Spotify will
/// redirect to REDIRECT_URI with `code` and `state` query params.
pub fn build_auth_url(client_id: &str) -> Result<String, String> {
    let client_id = client_id.trim();
    if client_id.is_empty() {
        return Err("Client ID is empty — paste it in Settings → Spotify first.".into());
    }

    // 64 random bytes = 86 char base64url verifier (within 43-128 RFC 7636 range).
    let code_verifier = random_url_safe(64);
    let code_challenge = pkce_challenge(&code_verifier);
    let state = random_url_safe(24);

    *PENDING_AUTH.lock().unwrap() = Some(PendingAuth {
        state: state.clone(),
        code_verifier: code_verifier.clone(),
        client_id: client_id.into(),
    });

    let url = format!(
        "https://accounts.spotify.com/authorize?\
client_id={cid}\
&response_type=code\
&redirect_uri={ru}\
&code_challenge_method=S256\
&code_challenge={cc}\
&state={st}\
&scope={sc}",
        cid = urlencoding::encode(client_id),
        ru = urlencoding::encode(REDIRECT_URI),
        cc = code_challenge,
        st = state,
        sc = urlencoding::encode(SCOPES),
    );
    Ok(url)
}

/// Exchange the auth code for tokens. Validates `state` matches the pending
/// auth, sends `code_verifier` as required by PKCE, and persists the tokens.
pub fn exchange_code(
    store_path: &Path,
    code: &str,
    state: &str,
) -> Result<(), String> {
    let pending = PENDING_AUTH
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "No pending Spotify auth. Click Connect Spotify first.".to_string())?;

    if pending.state != state {
        return Err("State mismatch — possible CSRF, aborting.".into());
    }

    let body = format!(
        "grant_type=authorization_code&code={code}&redirect_uri={ru}&client_id={cid}&code_verifier={cv}",
        code = urlencoding::encode(code),
        ru = urlencoding::encode(REDIRECT_URI),
        cid = urlencoding::encode(&pending.client_id),
        cv = urlencoding::encode(&pending.code_verifier),
    );

    let mut response = ureq::post("https://accounts.spotify.com/api/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .send(body)
        .map_err(|e| format!("Token request failed: {}", e))?;

    let status = response.status().as_u16();
    let json: serde_json::Value = response
        .body_mut()
        .read_json()
        .map_err(|e| format!("Bad token response: {}", e))?;

    if status / 100 != 2 {
        let desc = json
            .get("error_description")
            .or_else(|| json.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        return Err(format!("Spotify token error ({}): {}", status, desc));
    }

    let access = json
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "No access_token in response".to_string())?;
    let refresh = json
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "No refresh_token in response".to_string())?;
    let expires_in = json
        .get("expires_in")
        .and_then(|v| v.as_u64())
        .unwrap_or(3600);
    let expires_at = now_secs() + expires_in;

    save_tokens(store_path, access, refresh, expires_at)?;
    *PENDING_AUTH.lock().unwrap() = None;
    Ok(())
}

/// Refresh an expired access token. Spotify may rotate the refresh_token —
/// when it does, we persist the new one. Otherwise the old refresh_token
/// is kept.
fn refresh_access_token(store_path: &Path, cfg: &SpotifyConfig) -> Result<SpotifyConfig, String> {
    if cfg.client_id.is_empty() {
        return Err("Spotify not configured (no client_id)".into());
    }
    if cfg.refresh_token.is_empty() {
        return Err("No refresh token — reconnect Spotify in Settings.".into());
    }
    let body = format!(
        "grant_type=refresh_token&refresh_token={rt}&client_id={cid}",
        rt = urlencoding::encode(&cfg.refresh_token),
        cid = urlencoding::encode(&cfg.client_id),
    );
    let mut response = ureq::post("https://accounts.spotify.com/api/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .send(body)
        .map_err(|e| format!("Refresh request failed: {}", e))?;

    let status = response.status().as_u16();
    let json: serde_json::Value = response
        .body_mut()
        .read_json()
        .map_err(|e| format!("Bad refresh response: {}", e))?;

    if status / 100 != 2 {
        let desc = json
            .get("error_description")
            .or_else(|| json.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        return Err(format!("Spotify refresh error ({}): {}", status, desc));
    }

    let access = json
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "No access_token in refresh response".to_string())?
        .to_string();
    let refresh = json
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| cfg.refresh_token.clone());
    let expires_in = json
        .get("expires_in")
        .and_then(|v| v.as_u64())
        .unwrap_or(3600);
    let expires_at = now_secs() + expires_in;

    save_tokens(store_path, &access, &refresh, expires_at)?;
    Ok(SpotifyConfig {
        client_id: cfg.client_id.clone(),
        access_token: access,
        refresh_token: refresh,
        expires_at,
    })
}

/// Ensure we have a fresh access token, refreshing if needed.
fn ensure_fresh(store_path: &Path) -> Result<SpotifyConfig, String> {
    let cfg = load_config(store_path);
    if !cfg.is_connected() {
        return Err("Not connected to Spotify".into());
    }
    if cfg.is_expired(now_secs()) {
        return refresh_access_token(store_path, &cfg);
    }
    Ok(cfg)
}

/// Try a request once. If it returns 401 (token rejected), refresh and retry once.
fn api_call(
    store_path: &Path,
    method: &str,
    path: &str,
) -> Result<(u16, serde_json::Value), String> {
    let cfg = ensure_fresh(store_path)?;
    let url = format!("https://api.spotify.com/v1{}", path);

    let do_req = |token: &str| -> Result<(u16, serde_json::Value), String> {
        let auth = format!("Bearer {}", token);
        let resp = match method {
            "GET" => ureq::get(&url).header("Authorization", &auth).call(),
            "PUT" => ureq::put(&url).header("Authorization", &auth).header("Content-Length", "0").send(""),
            "POST" => ureq::post(&url).header("Authorization", &auth).header("Content-Length", "0").send(""),
            _ => return Err(format!("Unsupported method: {}", method)),
        };
        let mut resp = resp.map_err(|e| format!("HTTP error: {}", e))?;
        let status = resp.status().as_u16();
        // Spotify's playback-control endpoints return 204 with empty body — read_json fails.
        let json: serde_json::Value = if status == 204 {
            serde_json::Value::Null
        } else {
            resp.body_mut()
                .read_json()
                .unwrap_or(serde_json::Value::Null)
        };
        Ok((status, json))
    };

    let (status, json) = do_req(&cfg.access_token)?;
    if status != 401 {
        return Ok((status, json));
    }

    crate::app_log!("[spotify] 401 on {} {}, refreshing token", method, path);
    let cfg2 = refresh_access_token(store_path, &cfg)?;
    do_req(&cfg2.access_token)
}

/// `GET /me/player` — full playback state. Returns Null when nothing is playing.
pub fn get_state(store_path: &Path) -> Result<serde_json::Value, String> {
    let (status, json) = api_call(store_path, "GET", "/me/player")?;
    if status == 204 {
        return Ok(serde_json::json!({ "playing": false, "no_device": true }));
    }
    if status / 100 != 2 {
        return Err(format!("Spotify state error ({}): {}", status, json));
    }
    Ok(json)
}

pub fn play(store_path: &Path) -> Result<(), String> {
    let (status, json) = api_call(store_path, "PUT", "/me/player/play")?;
    if status / 100 != 2 {
        return Err(format!("Spotify play error ({}): {}", status, json));
    }
    Ok(())
}

pub fn pause(store_path: &Path) -> Result<(), String> {
    let (status, json) = api_call(store_path, "PUT", "/me/player/pause")?;
    if status / 100 != 2 {
        return Err(format!("Spotify pause error ({}): {}", status, json));
    }
    Ok(())
}

pub fn next(store_path: &Path) -> Result<(), String> {
    let (status, json) = api_call(store_path, "POST", "/me/player/next")?;
    if status / 100 != 2 {
        return Err(format!("Spotify next error ({}): {}", status, json));
    }
    Ok(())
}

pub fn previous(store_path: &Path) -> Result<(), String> {
    let (status, json) = api_call(store_path, "POST", "/me/player/previous")?;
    if status / 100 != 2 {
        return Err(format!("Spotify previous error ({}): {}", status, json));
    }
    Ok(())
}

/// `GET /me/player/queue` — currently playing + upcoming items. Premium only.
pub fn get_queue(store_path: &Path) -> Result<serde_json::Value, String> {
    let (status, json) = api_call(store_path, "GET", "/me/player/queue")?;
    if status == 204 {
        return Ok(serde_json::json!({ "queue": [] }));
    }
    if status / 100 != 2 {
        return Err(format!("Spotify queue error ({}): {}", status, json));
    }
    Ok(json)
}

pub fn seek(store_path: &Path, position_ms: u64) -> Result<(), String> {
    let path = format!("/me/player/seek?position_ms={}", position_ms);
    let (status, json) = api_call(store_path, "PUT", &path)?;
    if status / 100 != 2 {
        return Err(format!("Spotify seek error ({}): {}", status, json));
    }
    Ok(())
}
