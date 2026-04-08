use std::sync::{Arc, Mutex};
use tauri::Emitter;

use crate::helpers::{get_port, get_query_param, now_secs};
use crate::state::{emit_if_changed, AppState, Session, TaskCompleted};

pub fn start_http_server(app_handle: tauri::AppHandle, app_state: Arc<Mutex<AppState>>) {
    std::thread::spawn(move || {
        let port = get_port();
        let addr = format!("0.0.0.0:{}", port);
        crate::app_log!("[http] binding to {}", addr);

        let server = match tiny_http::Server::http(&addr) {
            Ok(s) => {
                crate::app_log!("[http] server started on {}", addr);
                s
            }
            Err(e) => {
                crate::app_error!("[http] failed to bind {}: {}", addr, e);
                return;
            }
        };

        let cors: tiny_http::Header = "Access-Control-Allow-Origin: *".parse().unwrap();

        for mut req in server.incoming_requests() {
            let url = req.url().to_string();
            let method = req.method().to_string();
            let now = now_secs();

            // --- /status ---
            if url.starts_with("/status") {
                match get_query_param(&url, "pid") {
                    Some(pid_str) => match pid_str.parse::<u32>() {
                        Ok(pid) => {
                            let mut st = app_state.lock().unwrap();
                            let is_new = !st.sessions.contains_key(&pid);
                            let session = st
                                .sessions
                                .entry(pid)
                                .or_insert_with(|| Session::new_idle(now));
                            session.last_seen = now;

                            if is_new {
                                crate::app_log!("[http] new session registered: pid={}", pid);
                            }

                            if url.contains("state=busy") {
                                let cmd_type = get_query_param(&url, "type").unwrap_or("task");
                                session.busy_type = cmd_type.to_string();

                                if cmd_type == "service" {
                                    session.ui_state = "service".to_string();
                                    session.service_since = now;
                                    session.busy_since = 0;
                                    crate::app_log!("[http] pid={} -> service", pid);
                                } else {
                                    session.ui_state = "busy".to_string();
                                    session.service_since = 0;
                                    session.busy_since = now;
                                    crate::app_log!("[http] pid={} -> busy (type={})", pid, cmd_type);
                                }

                                emit_if_changed(&app_handle, &mut st);
                            } else if url.contains("state=idle") {
                                let busy_since = session.busy_since;
                                if busy_since > 0 {
                                    let duration = now.saturating_sub(busy_since);
                                    crate::app_log!("[http] pid={} task completed ({}s)", pid, duration);
                                    if let Err(e) = app_handle.emit("task-completed", TaskCompleted { duration_secs: duration }) {
                                        crate::app_error!("[http] failed to emit task-completed: {}", e);
                                    }
                                }

                                session.busy_type.clear();
                                session.ui_state = "idle".to_string();
                                session.service_since = 0;
                                session.busy_since = 0;
                                crate::app_log!("[http] pid={} -> idle", pid);
                                emit_if_changed(&app_handle, &mut st);
                            } else {
                                crate::app_warn!("[http] pid={} /status with unknown state: {}", pid, url);
                            }
                        }
                        Err(e) => {
                            crate::app_warn!("[http] /status invalid pid '{}': {}", pid_str, e);
                        }
                    },
                    None => {
                        crate::app_warn!("[http] /status missing pid param: {}", url);
                    }
                }

                let resp = tiny_http::Response::from_string("ok")
                    .with_status_code(200)
                    .with_header(cors.clone());
                let _ = req.respond(resp);
                continue;
            }

            // --- /heartbeat ---
            if url.starts_with("/heartbeat") {
                match get_query_param(&url, "pid") {
                    Some(pid_str) => match pid_str.parse::<u32>() {
                        Ok(pid) => {
                            let mut st = app_state.lock().unwrap();
                            let is_new = !st.sessions.contains_key(&pid);
                            let session = st
                                .sessions
                                .entry(pid)
                                .or_insert_with(|| Session::new_idle(now));
                            session.last_seen = now;

                            if is_new {
                                crate::app_log!("[http] heartbeat registered new session: pid={}", pid);
                            }

                            emit_if_changed(&app_handle, &mut st);
                        }
                        Err(e) => {
                            crate::app_warn!("[http] /heartbeat invalid pid '{}': {}", pid_str, e);
                        }
                    },
                    None => {
                        crate::app_warn!("[http] /heartbeat missing pid param");
                    }
                }

                let resp = tiny_http::Response::from_string("ok")
                    .with_status_code(200)
                    .with_header(cors.clone());
                let _ = req.respond(resp);
                continue;
            }

            // --- /visit (incoming visit) ---
            if url.starts_with("/visit") && !url.starts_with("/visit-end") {
                crate::app_log!("[visit] incoming visit request");

                let mut body = String::new();
                let reader = req.as_reader();
                match reader.read_to_string(&mut body) {
                    Ok(_) => {}
                    Err(e) => {
                        crate::app_error!("[visit] failed to read request body: {}", e);
                        let resp = tiny_http::Response::from_string("error")
                            .with_status_code(400)
                            .with_header(cors.clone());
                        let _ = req.respond(resp);
                        continue;
                    }
                }

                match serde_json::from_str::<serde_json::Value>(&body) {
                    Ok(payload) => {
                        let pet = payload["pet"].as_str().unwrap_or("rottweiler").to_string();
                        let nickname = payload["nickname"].as_str().unwrap_or("Unknown").to_string();
                        let duration_secs = payload["duration_secs"].as_u64().unwrap_or(15);

                        crate::app_log!("[visit] {} ({}) arrived for {}s", nickname, pet, duration_secs);

                        let mut st = app_state.lock().unwrap();
                        st.visitors.push(crate::state::VisitingDog {
                            pet: pet.clone(),
                            nickname: nickname.clone(),
                            arrived_at: now,
                            duration_secs,
                        });
                        let visitor_count = st.visitors.len();
                        drop(st);

                        crate::app_log!("[visit] total visitors: {}", visitor_count);

                        if let Err(e) = app_handle.emit("visitor-arrived", serde_json::json!({
                            "pet": pet,
                            "nickname": nickname,
                            "duration_secs": duration_secs,
                        })) {
                            crate::app_error!("[visit] failed to emit visitor-arrived: {}", e);
                        }
                    }
                    Err(e) => {
                        crate::app_error!("[visit] failed to parse visit body: {} (body={})", e, body);
                    }
                }

                let resp = tiny_http::Response::from_string("ok")
                    .with_status_code(200)
                    .with_header(cors.clone());
                let _ = req.respond(resp);
                continue;
            }

            // --- /visit-end ---
            if url.starts_with("/visit-end") {
                crate::app_log!("[visit] incoming visit-end request");

                let mut body = String::new();
                let reader = req.as_reader();
                match reader.read_to_string(&mut body) {
                    Ok(_) => {}
                    Err(e) => {
                        crate::app_error!("[visit] failed to read visit-end body: {}", e);
                        let resp = tiny_http::Response::from_string("error")
                            .with_status_code(400)
                            .with_header(cors.clone());
                        let _ = req.respond(resp);
                        continue;
                    }
                }

                match serde_json::from_str::<serde_json::Value>(&body) {
                    Ok(payload) => {
                        let nickname = payload["nickname"].as_str().unwrap_or("").to_string();

                        let mut st = app_state.lock().unwrap();
                        let before = st.visitors.len();
                        st.visitors.retain(|v| v.nickname != nickname);
                        let after = st.visitors.len();
                        drop(st);

                        crate::app_log!("[visit] {} left (visitors: {} -> {})", nickname, before, after);

                        if let Err(e) = app_handle.emit("visitor-left", serde_json::json!({
                            "nickname": nickname,
                        })) {
                            crate::app_error!("[visit] failed to emit visitor-left: {}", e);
                        }
                    }
                    Err(e) => {
                        crate::app_error!("[visit] failed to parse visit-end body: {} (body={})", e, body);
                    }
                }

                let resp = tiny_http::Response::from_string("ok")
                    .with_status_code(200)
                    .with_header(cors.clone());
                let _ = req.respond(resp);
                continue;
            }

            // --- /debug ---
            if url.starts_with("/debug") {
                crate::app_log!("[http] debug endpoint hit");
                let st = app_state.lock().unwrap();
                let mut lines = Vec::new();
                lines.push(format!("current_ui: {}", st.current_ui));
                lines.push(format!("sleeping: {}", st.sleeping));
                lines.push(format!("sessions: {}", st.sessions.len()));
                for (pid, s) in &st.sessions {
                    lines.push(format!(
                        "  pid={} ui={} type={} last_seen={}s_ago",
                        pid, s.ui_state, s.busy_type, now - s.last_seen
                    ));
                }
                lines.push(format!("peers: {}", st.peers.len()));
                lines.push(format!("visitors: {}", st.visitors.len()));
                lines.push(format!("visiting: {:?}", st.visiting));
                let body = lines.join("\n");
                let resp = tiny_http::Response::from_string(body)
                    .with_status_code(200)
                    .with_header(cors.clone());
                let _ = req.respond(resp);
                continue;
            }

            // --- Unknown route ---
            if !url.starts_with("/logs") {
                crate::app_warn!("[http] unknown route: {} {}", method, url);
            }

            let resp = tiny_http::Response::from_string("ok")
                .with_status_code(200)
                .with_header(cors.clone());
            let _ = req.respond(resp);
        }
    });
}
