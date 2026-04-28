use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TelegramConfig {
    #[serde(default)]
    pub bot_token: String,
    #[serde(default)]
    pub chat_id: String,
}

impl TelegramConfig {
    pub fn is_configured(&self) -> bool {
        !self.bot_token.trim().is_empty() && !self.chat_id.trim().is_empty()
    }
}

#[derive(Debug, Serialize)]
pub struct SendResult {
    pub ok: bool,
    pub message: String,
}

const SETTINGS_KEY_TOKEN: &str = "telegramBotToken";
const SETTINGS_KEY_CHAT: &str = "telegramChatId";
const SETTINGS_KEY_PUSH: &str = "telegramPushEnabled";

/// Read Telegram config out of settings.json (tauri-plugin-store file).
pub fn load_config(store_path: &Path) -> TelegramConfig {
    let raw = match std::fs::read_to_string(store_path) {
        Ok(c) => c,
        Err(_) => return TelegramConfig::default(),
    };
    let json: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return TelegramConfig::default(),
    };
    TelegramConfig {
        bot_token: json
            .get(SETTINGS_KEY_TOKEN)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        chat_id: json
            .get(SETTINGS_KEY_CHAT)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    }
}

#[allow(dead_code)]
pub fn push_enabled(store_path: &Path) -> bool {
    std::fs::read_to_string(store_path)
        .ok()
        .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
        .and_then(|j| j.get(SETTINGS_KEY_PUSH).and_then(|v| v.as_bool()))
        .unwrap_or(false)
}

/// Send a Telegram message via the Bot API. Returns Ok on 2xx with `ok:true`,
/// Err otherwise with a user-facing string (network or API error).
pub fn send_message(token: &str, chat_id: &str, text: &str) -> Result<(), String> {
    let token = token.trim();
    let chat_id = chat_id.trim();
    if token.is_empty() || chat_id.is_empty() {
        return Err("Telegram is not configured".into());
    }

    let url = format!("https://api.telegram.org/bot{}/sendMessage", token);
    let body = serde_json::json!({
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": true,
    });

    let mut response = ureq::post(&url)
        .header("Content-Type", "application/json")
        .send_json(&body)
        .map_err(|e| format!("Network error: {}", e))?;

    let status = response.status().as_u16();
    let json: serde_json::Value = response
        .body_mut()
        .read_json()
        .map_err(|e| format!("Bad response from Telegram: {}", e))?;

    let ok = json.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    if !ok {
        let desc = json
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        return Err(format!("Telegram API error ({}): {}", status, desc));
    }
    Ok(())
}

/// Send a test "ping" message using the supplied credentials.
pub fn test_credentials(token: &str, chat_id: &str) -> SendResult {
    match send_message(token, chat_id, "Ani-Mime test \u{1F436} — your push channel is wired up.") {
        Ok(_) => SendResult {
            ok: true,
            message: "Test message sent.".into(),
        },
        Err(e) => SendResult {
            ok: false,
            message: e,
        },
    }
}

/// High-level push entry point. Looks up config from settings.json and sends.
/// No-op (with log) when not configured or push toggle is off.
pub fn push_if_enabled(store_path: &Path, text: &str) {
    let cfg = load_config(store_path);
    if !cfg.is_configured() {
        crate::app_log!("[telegram] push skipped — not configured");
        return;
    }
    if !push_enabled(store_path) {
        crate::app_log!("[telegram] push skipped — toggle off");
        return;
    }

    if let Err(e) = send_message(&cfg.bot_token, &cfg.chat_id, text) {
        crate::app_warn!("[telegram] push failed: {}", e);
    } else {
        crate::app_log!("[telegram] push sent ({} chars)", text.len());
    }
}
