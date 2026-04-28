use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

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

/// Background poller for `/yes` and `/no` commands sent to the bot.
/// Tracks `update_id` offsets so each message is processed once. Emits a
/// `telegram-reply` Tauri event with `{ command: "yes" | "no", text: String }`
/// and posts an acknowledgement back to the user. Reads config from
/// `settings.json` on every tick so it picks up token / chat-id changes
/// without an app restart.
pub fn start_polling_thread(app_handle: AppHandle, store_path: PathBuf) {
    std::thread::spawn(move || {
        let mut last_update_id: i64 = 0;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(3));

            let cfg = load_config(&store_path);
            if !cfg.is_configured() {
                continue;
            }

            let url = format!(
                "https://api.telegram.org/bot{}/getUpdates?timeout=0&offset={}",
                cfg.bot_token,
                last_update_id + 1
            );
            let mut response = match ureq::get(&url).call() {
                Ok(r) => r,
                Err(_) => continue,
            };
            let json: serde_json::Value = match response.body_mut().read_json() {
                Ok(v) => v,
                Err(_) => continue,
            };

            let updates = match json.get("result").and_then(|v| v.as_array()) {
                Some(a) => a,
                None => continue,
            };

            for upd in updates {
                if let Some(id) = upd.get("update_id").and_then(|v| v.as_i64()) {
                    if id > last_update_id {
                        last_update_id = id;
                    }
                }
                let msg = match upd.get("message") {
                    Some(m) => m,
                    None => continue,
                };
                let from_chat = msg
                    .get("chat")
                    .and_then(|c| c.get("id"))
                    .map(|v| v.to_string().trim_matches('"').to_string())
                    .unwrap_or_default();
                if from_chat != cfg.chat_id.trim() {
                    continue;
                }
                let text = msg
                    .get("text")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim();
                let cmd_lower = text.to_lowercase();
                let command = if cmd_lower == "/yes" || cmd_lower == "yes" {
                    "yes"
                } else if cmd_lower == "/no" || cmd_lower == "no" {
                    "no"
                } else {
                    continue;
                };

                crate::app_log!("[telegram] received command: {}", command);

                let _ = app_handle.emit(
                    "telegram-reply",
                    serde_json::json!({ "command": command, "text": text }),
                );

                let ack = if command == "yes" {
                    "Got it: YES. Switch to your terminal to confirm in Claude."
                } else {
                    "Got it: NO. Switch to your terminal to deny in Claude."
                };
                let _ = send_message(&cfg.bot_token, &cfg.chat_id, ack);
            }
        }
    });
}

/// High-level push entry point. Looks up config from settings.json and sends.
/// No-op (with log) when not configured or push toggle is off.
pub fn push_if_enabled(store_path: &Path, text: &str) {
    let cfg = load_config(store_path);
    if !cfg.is_configured() {
        crate::app_log!("[telegram] push skipped — not configured");
        return;
    }
    let push_on = std::fs::read_to_string(store_path)
        .ok()
        .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
        .and_then(|j| j.get("telegramPushEnabled").and_then(|v| v.as_bool()))
        .unwrap_or(false);
    if !push_on {
        crate::app_log!("[telegram] push skipped — toggle off");
        return;
    }

    if let Err(e) = send_message(&cfg.bot_token, &cfg.chat_id, text) {
        crate::app_warn!("[telegram] push failed: {}", e);
    } else {
        crate::app_log!("[telegram] push sent ({} chars)", text.len());
    }
}
