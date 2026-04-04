use std::sync::{Arc, Mutex};

use crate::helpers::{get_query_param, now_secs};
use crate::state::{emit_if_changed, AppState, Session};

pub fn start_http_server(app_handle: tauri::AppHandle, app_state: Arc<Mutex<AppState>>) {
    std::thread::spawn(move || {
        let server = match tiny_http::Server::http("127.0.0.1:1234") {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[http] failed to bind :1234: {e}");
                return;
            }
        };
        eprintln!("[http] listening on 127.0.0.1:1234");

        let cors: tiny_http::Header = "Access-Control-Allow-Origin: *".parse().unwrap();

        for req in server.incoming_requests() {
            let url = req.url().to_string();
            let now = now_secs();

            if url.starts_with("/status") {
                if let Some(pid_str) = get_query_param(&url, "pid") {
                    if let Ok(pid) = pid_str.parse::<u32>() {
                        let mut st = app_state.lock().unwrap();

                        let session = st
                            .sessions
                            .entry(pid)
                            .or_insert_with(|| Session::new_idle(now));
                        session.last_seen = now;

                        if url.contains("state=busy") {
                            let cmd_type = get_query_param(&url, "type").unwrap_or("task");
                            session.busy_type = cmd_type.to_string();

                            if cmd_type == "service" {
                                session.ui_state = "service".to_string();
                                session.service_since = now;
                            } else {
                                session.ui_state = "busy".to_string();
                                session.service_since = 0;
                            }

                            emit_if_changed(&app_handle, &mut st);
                        } else if url.contains("state=idle") {
                            session.busy_type.clear();
                            session.ui_state = "idle".to_string();
                            session.service_since = 0;
                            emit_if_changed(&app_handle, &mut st);
                        }
                    }
                }
            } else if url.starts_with("/heartbeat") {
                if let Some(pid_str) = get_query_param(&url, "pid") {
                    if let Ok(pid) = pid_str.parse::<u32>() {
                        let mut st = app_state.lock().unwrap();
                        let session = st
                            .sessions
                            .entry(pid)
                            .or_insert_with(|| Session::new_idle(now));
                        // Only refresh last_seen for idle sessions.
                        // Busy sessions should NOT be kept alive by heartbeat —
                        // let the watchdog clean them up if no status signal comes.
                        if session.ui_state != "busy" {
                            session.last_seen = now;
                        }

                        emit_if_changed(&app_handle, &mut st);
                    }
                }
            }

            // Debug endpoint: GET /debug → show all sessions
            if url.starts_with("/debug") {
                let st = app_state.lock().unwrap();
                let mut lines = Vec::new();
                lines.push(format!("current_ui: {}", st.current_ui));
                lines.push(format!("sessions: {}", st.sessions.len()));
                for (pid, s) in &st.sessions {
                    lines.push(format!(
                        "  pid={} ui={} type={} last_seen={}s_ago",
                        pid,
                        s.ui_state,
                        s.busy_type,
                        now - s.last_seen
                    ));
                }
                let body = lines.join("\n");
                let resp = tiny_http::Response::from_string(body)
                    .with_status_code(200)
                    .with_header(cors.clone());
                let _ = req.respond(resp);
                continue;
            }

            let resp = tiny_http::Response::from_string("ok")
                .with_status_code(200)
                .with_header(cors.clone());
            let _ = req.respond(resp);
        }
    });
}
