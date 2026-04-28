use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
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
    send_message_inner(token, chat_id, text, None)
}

/// Send a Telegram message with a two-button inline keyboard. Each button's
/// callback `data` is `decision:<id>:allow` or `decision:<id>:deny` so the
/// poller can route the press back to the blocking caller.
pub fn send_message_with_decision(
    token: &str,
    chat_id: &str,
    text: &str,
    decision_id: &str,
) -> Result<(), String> {
    let keyboard = serde_json::json!({
        "inline_keyboard": [[
            { "text": "\u{2705} Allow", "callback_data": format!("decision:{}:allow", decision_id) },
            { "text": "\u{274C} Deny",  "callback_data": format!("decision:{}:deny",  decision_id) },
        ]]
    });
    send_message_inner(token, chat_id, text, Some(keyboard))
}

fn send_message_inner(
    token: &str,
    chat_id: &str,
    text: &str,
    reply_markup: Option<serde_json::Value>,
) -> Result<(), String> {
    let token = token.trim();
    let chat_id = chat_id.trim();
    if token.is_empty() || chat_id.is_empty() {
        return Err("Telegram is not configured".into());
    }

    let url = format!("https://api.telegram.org/bot{}/sendMessage", token);
    let mut body = serde_json::json!({
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": true,
    });
    if let Some(markup) = reply_markup {
        body["reply_markup"] = markup;
    }

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

fn answer_callback(token: &str, callback_id: &str, text: &str) {
    let url = format!("https://api.telegram.org/bot{}/answerCallbackQuery", token);
    let body = serde_json::json!({
        "callback_query_id": callback_id,
        "text": text,
        "show_alert": false,
    });
    let _ = ureq::post(&url)
        .header("Content-Type", "application/json")
        .send_json(&body);
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

// ---------------------------------------------------------------------------
// Pending decisions registry
// ---------------------------------------------------------------------------
//
// `request_decision_blocking` registers a oneshot Sender keyed by an opaque
// decision id, sends a Telegram message with two callback buttons, and
// blocks waiting for a value on the matching Receiver. The polling thread
// looks up the Sender when a `callback_query` arrives and forwards the
// user's choice ("allow" / "deny"). Channel guarantees deliver-once
// semantics; the caller removes the entry on either receipt or timeout.

static PENDING: OnceLock<Mutex<HashMap<String, Sender<String>>>> = OnceLock::new();
static DECISION_COUNTER: AtomicU64 = AtomicU64::new(0);

fn pending() -> &'static Mutex<HashMap<String, Sender<String>>> {
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

fn next_decision_id() -> String {
    let n = DECISION_COUNTER.fetch_add(1, Ordering::Relaxed);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("p{}-{}", ts, n)
}

#[derive(Debug)]
pub enum DecisionOutcome {
    Allow,
    Deny,
    Timeout,
    NotConfigured,
    PushDisabled,
    SendError(String),
}

/// Send a permission-decision request to Telegram and block until the user
/// taps Allow/Deny or `timeout` elapses. Polled by `start_polling_thread`,
/// which routes the `callback_query` back through a oneshot channel.
pub fn request_decision_blocking(
    store_path: &Path,
    project: &str,
    detail: &str,
    timeout: Duration,
) -> DecisionOutcome {
    let cfg = load_config(store_path);
    if !cfg.is_configured() {
        return DecisionOutcome::NotConfigured;
    }
    if !push_enabled(store_path) {
        return DecisionOutcome::PushDisabled;
    }

    let id = next_decision_id();
    let (tx, rx) = channel::<String>();
    pending().lock().unwrap().insert(id.clone(), tx);

    let text = format!(
        "Claude \u{2014} approval needed\nProject: {}\n\n{}\n\nTap a button to decide.",
        project, detail
    );

    if let Err(e) = send_message_with_decision(&cfg.bot_token, &cfg.chat_id, &text, &id) {
        pending().lock().unwrap().remove(&id);
        return DecisionOutcome::SendError(e);
    }

    let outcome = match rx.recv_timeout(timeout) {
        Ok(s) if s == "allow" => DecisionOutcome::Allow,
        Ok(_) => DecisionOutcome::Deny,
        Err(_) => DecisionOutcome::Timeout,
    };
    pending().lock().unwrap().remove(&id);

    if matches!(outcome, DecisionOutcome::Timeout) {
        let _ = send_message(
            &cfg.bot_token,
            &cfg.chat_id,
            "\u{23F1} Approval window expired \u{2014} defaulted to deny.",
        );
    }

    outcome
}

/// Background poller for inbound bot updates.
/// Handles two flavors:
///   - `message` (legacy /yes /no text) → `telegram-reply` Tauri event + ack
///   - `callback_query` (Allow/Deny button press) → route to pending request
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

                if let Some(cb) = upd.get("callback_query") {
                    handle_callback_query(&cfg, cb);
                    continue;
                }

                if let Some(msg) = upd.get("message") {
                    handle_message(&app_handle, &cfg, msg);
                }
            }
        }
    });
}

fn handle_callback_query(cfg: &TelegramConfig, cb: &serde_json::Value) {
    let cb_id = cb.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let from_chat = cb
        .get("message")
        .and_then(|m| m.get("chat"))
        .and_then(|c| c.get("id"))
        .map(|v| v.to_string().trim_matches('"').to_string())
        .unwrap_or_default();
    if from_chat != cfg.chat_id.trim() {
        return;
    }
    let data = cb.get("data").and_then(|v| v.as_str()).unwrap_or("");
    // Expected: "decision:<id>:allow" | "decision:<id>:deny"
    let parts: Vec<&str> = data.splitn(3, ':').collect();
    if parts.len() != 3 || parts[0] != "decision" {
        answer_callback(&cfg.bot_token, cb_id, "Unknown action");
        return;
    }
    let decision_id = parts[1];
    let choice = parts[2];

    crate::app_log!("[telegram] callback decision={} id={}", choice, decision_id);

    let sender = pending().lock().unwrap().remove(decision_id);
    if let Some(tx) = sender {
        let _ = tx.send(choice.to_string());
        let ack = if choice == "allow" {
            "\u{2705} Allowed."
        } else {
            "\u{274C} Denied."
        };
        answer_callback(&cfg.bot_token, cb_id, ack);
    } else {
        answer_callback(
            &cfg.bot_token,
            cb_id,
            "Request expired or already answered.",
        );
    }
}

fn handle_message(app_handle: &AppHandle, cfg: &TelegramConfig, msg: &serde_json::Value) {
    let from_chat = msg
        .get("chat")
        .and_then(|c| c.get("id"))
        .map(|v| v.to_string().trim_matches('"').to_string())
        .unwrap_or_default();
    if from_chat != cfg.chat_id.trim() {
        return;
    }
    let text = msg.get("text").and_then(|v| v.as_str()).unwrap_or("").trim();
    let lower = text.to_lowercase();
    let command = if lower == "/yes" || lower == "yes" {
        "yes"
    } else if lower == "/no" || lower == "no" {
        "no"
    } else {
        return;
    };

    crate::app_log!("[telegram] received text command: {}", command);

    let _ = app_handle.emit(
        "telegram-reply",
        serde_json::json!({ "command": command, "text": text }),
    );

    let ack = if command == "yes" {
        "Got it: YES. Confirm in your terminal."
    } else {
        "Got it: NO. Deny in your terminal."
    };
    let _ = send_message(&cfg.bot_token, &cfg.chat_id, ack);
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
