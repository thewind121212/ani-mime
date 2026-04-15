use std::sync::{Arc, Mutex};
use tauri::Emitter;

use crate::helpers::{get_port, get_query_param, now_secs};
use crate::proc_scan::pid_exists;
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
                            // Reject zombie heartbeats: if the shell that claimed to own
                            // this PID is gone but the request keeps coming from an
                            // orphaned subshell, don't re-create the session.
                            if !pid_exists(pid) {
                                crate::app_warn!("[http] /status rejected: pid={} not running", pid);
                                let resp = tiny_http::Response::from_string("gone")
                                    .with_status_code(410)
                                    .with_header(cors.clone());
                                let _ = req.respond(resp);
                                continue;
                            }

                            let mut st = app_state.lock().unwrap();
                            let is_new = !st.sessions.contains_key(&pid);
                            let session = st
                                .sessions
                                .entry(pid)
                                .or_insert_with(|| Session::new_idle(now));
                            session.last_seen = now;
                            if let Some(t) = get_query_param(&url, "title") {
                                session.title = urlencoding::decode(t)
                                    .unwrap_or(std::borrow::Cow::Borrowed(t))
                                    .into_owned();
                            }
                            if let Some(p) = get_query_param(&url, "pwd") {
                                session.pwd = urlencoding::decode(p)
                                    .unwrap_or(std::borrow::Cow::Borrowed(p))
                                    .into_owned();
                            }
                            if let Some(t) = get_query_param(&url, "tty") {
                                session.tty = urlencoding::decode(t)
                                    .unwrap_or(std::borrow::Cow::Borrowed(t))
                                    .into_owned();
                            }

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
                                let task_duration = if busy_since > 0 {
                                    Some(now.saturating_sub(busy_since))
                                } else {
                                    None
                                };

                                session.busy_type.clear();
                                session.ui_state = "idle".to_string();
                                session.service_since = 0;
                                session.busy_since = 0;
                                // Drop session borrow before accessing st fields
                                drop(session);

                                if let Some(duration) = task_duration {
                                    crate::app_log!("[http] pid={} task completed ({}s)", pid, duration);
                                    if let Err(e) = app_handle.emit("task-completed", TaskCompleted { duration_secs: duration }) {
                                        crate::app_error!("[http] failed to emit task-completed: {}", e);
                                    }

                                    // Update daily usage counters
                                    let today = now / 86400;
                                    if today != st.usage_day {
                                        st.usage_day = today;
                                        st.tasks_completed_today = 0;
                                        st.total_busy_secs_today = 0;
                                        st.longest_task_today_secs = 0;
                                    }
                                    st.tasks_completed_today += 1;
                                    st.total_busy_secs_today += duration;
                                    st.last_task_duration_secs = duration;
                                    if duration > st.longest_task_today_secs {
                                        st.longest_task_today_secs = duration;
                                    }
                                }

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
                            if !pid_exists(pid) {
                                crate::app_warn!("[http] /heartbeat rejected: pid={} not running", pid);
                                let resp = tiny_http::Response::from_string("gone")
                                    .with_status_code(410)
                                    .with_header(cors.clone());
                                let _ = req.respond(resp);
                                continue;
                            }

                            let mut st = app_state.lock().unwrap();
                            let is_new = !st.sessions.contains_key(&pid);
                            let session = st
                                .sessions
                                .entry(pid)
                                .or_insert_with(|| Session::new_idle(now));
                            session.last_seen = now;
                            if let Some(t) = get_query_param(&url, "title") {
                                session.title = urlencoding::decode(t)
                                    .unwrap_or(std::borrow::Cow::Borrowed(t))
                                    .into_owned();
                            }
                            if let Some(p) = get_query_param(&url, "pwd") {
                                session.pwd = urlencoding::decode(p)
                                    .unwrap_or(std::borrow::Cow::Borrowed(p))
                                    .into_owned();
                            }
                            if let Some(t) = get_query_param(&url, "tty") {
                                session.tty = urlencoding::decode(t)
                                    .unwrap_or(std::borrow::Cow::Borrowed(t))
                                    .into_owned();
                            }

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
                        let instance_name = payload["instance_name"].as_str().unwrap_or("unknown").to_string();
                        let pet = payload["pet"].as_str().unwrap_or("rottweiler").to_string();
                        let nickname = payload["nickname"].as_str().unwrap_or("Unknown").to_string();
                        let duration_secs = payload["duration_secs"].as_u64().unwrap_or(15);

                        crate::app_log!("[visit] {} ({}) [{}] arrived for {}s", nickname, pet, instance_name, duration_secs);

                        let mut st = app_state.lock().unwrap();
                        st.visitors.push(crate::state::VisitingDog {
                            instance_name: instance_name.clone(),
                            pet: pet.clone(),
                            nickname: nickname.clone(),
                            arrived_at: now,
                            duration_secs,
                        });
                        let visitor_count = st.visitors.len();
                        drop(st);

                        crate::app_log!("[visit] total visitors: {}", visitor_count);

                        if let Err(e) = app_handle.emit("visitor-arrived", serde_json::json!({
                            "instance_name": instance_name,
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
                        let instance_name = payload["instance_name"].as_str().unwrap_or("").to_string();
                        let nickname = payload["nickname"].as_str().unwrap_or("").to_string();

                        let mut st = app_state.lock().unwrap();
                        let before = st.visitors.len();
                        if !instance_name.is_empty() {
                            st.visitors.retain(|v| v.instance_name != instance_name);
                        } else {
                            // Fallback for older peers that don't send instance_name
                            st.visitors.retain(|v| v.nickname != nickname);
                        }
                        let after = st.visitors.len();
                        drop(st);

                        crate::app_log!("[visit] {} [{}] left (visitors: {} -> {})", nickname, instance_name, before, after);

                        if let Err(e) = app_handle.emit("visitor-left", serde_json::json!({
                            "instance_name": instance_name,
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

            // --- /mcp/say (trigger speech bubble) ---
            if url.starts_with("/mcp/say") && method == "POST" {
                let mut body = String::new();
                let reader = req.as_reader();
                if reader.read_to_string(&mut body).is_ok() {
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body) {
                        let message = payload["message"].as_str().unwrap_or("").to_string();
                        let duration_secs = payload["duration_secs"].as_u64().unwrap_or(7);
                        crate::app_log!("[mcp] say: \"{}\" ({}s)", message, duration_secs);
                        if let Err(e) = app_handle.emit("mcp-say", serde_json::json!({
                            "message": message,
                            "duration_ms": duration_secs * 1000,
                        })) {
                            crate::app_error!("[mcp] failed to emit mcp-say: {}", e);
                        }
                    }
                }
                let resp = tiny_http::Response::from_string("ok")
                    .with_status_code(200)
                    .with_header(cors.clone());
                let _ = req.respond(resp);
                continue;
            }

            // --- /mcp/react (trigger temporary animation) ---
            if url.starts_with("/mcp/react") && method == "POST" {
                let mut body = String::new();
                let reader = req.as_reader();
                if reader.read_to_string(&mut body).is_ok() {
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body) {
                        let reaction = payload["reaction"].as_str().unwrap_or("").to_string();
                        let duration_secs = payload["duration_secs"].as_u64().unwrap_or(3);

                        let mapped_status = match reaction.as_str() {
                            "celebrate" => "service",
                            "nervous" => "busy",
                            "confused" => "searching",
                            "excited" => "service",
                            "sleep" => "disconnected",
                            _ => "idle",
                        };

                        crate::app_log!("[mcp] react: {} -> {} ({}s)", reaction, mapped_status, duration_secs);
                        if let Err(e) = app_handle.emit("mcp-react", serde_json::json!({
                            "status": mapped_status,
                            "duration_ms": duration_secs * 1000,
                        })) {
                            crate::app_error!("[mcp] failed to emit mcp-react: {}", e);
                        }
                    }
                }
                let resp = tiny_http::Response::from_string("ok")
                    .with_status_code(200)
                    .with_header(cors.clone());
                let _ = req.respond(resp);
                continue;
            }

            // --- /mcp/pet-status (return pet info as JSON) ---
            if url.starts_with("/mcp/pet-status") {
                let st = app_state.lock().unwrap();
                let visitors: Vec<serde_json::Value> = st.visitors.iter().map(|v| {
                    serde_json::json!({ "nickname": v.nickname, "pet": v.pet })
                }).collect();

                // Compute current busy duration (longest active busy session)
                let current_busy_secs = st.sessions.values()
                    .filter(|s| s.ui_state == "busy" && s.busy_since > 0)
                    .map(|s| now.saturating_sub(s.busy_since))
                    .max()
                    .unwrap_or(0);

                let body = serde_json::json!({
                    "pet_type": st.pet,
                    "nickname": st.nickname,
                    "current_status": st.current_ui,
                    "sleeping": st.sleeping,
                    "sessions_active": st.sessions.len(),
                    "peers_nearby": st.peers.len(),
                    "visitors": visitors,
                    "is_visiting": st.visiting.is_some(),
                    "uptime_secs": now.saturating_sub(st.started_at),
                    "current_busy_secs": current_busy_secs,
                    "usage_today": {
                        "tasks_completed": st.tasks_completed_today,
                        "total_busy_mins": st.total_busy_secs_today / 60,
                        "longest_task_mins": st.longest_task_today_secs / 60,
                        "last_task_duration_secs": st.last_task_duration_secs,
                    },
                });
                drop(st);

                crate::app_log!("[mcp] pet-status requested");
                let json_header: tiny_http::Header = "Content-Type: application/json".parse().unwrap();
                let resp = tiny_http::Response::from_string(body.to_string())
                    .with_status_code(200)
                    .with_header(cors.clone())
                    .with_header(json_header);
                let _ = req.respond(resp);
                continue;
            }

            // --- /debug ---
            if url.starts_with("/debug") {
                crate::app_log!("[http] debug endpoint hit");
                let st = app_state.lock().unwrap();
                let mut lines = Vec::new();

                lines.push("=== Discovery ===".to_string());
                lines.push(format!("instance: {}", st.discovery_instance));
                lines.push(format!("registered_addrs: [{}]", st.discovery_addrs.join(", ")));
                lines.push(format!("port: {}", st.discovery_port));

                lines.push("=== State ===".to_string());
                lines.push(format!("current_ui: {}", st.current_ui));
                lines.push(format!("sleeping: {}", st.sleeping));

                lines.push(format!("=== Sessions ({}) ===", st.sessions.len()));
                for (pid, s) in &st.sessions {
                    lines.push(format!(
                        "  pid={} ui={} type={} last_seen={}s_ago",
                        pid, s.ui_state, s.busy_type, now - s.last_seen
                    ));
                }

                lines.push(format!("=== Peers ({}) ===", st.peers.len()));
                for (key, p) in &st.peers {
                    lines.push(format!(
                        "  {} -> {} ({}) at {}:{}", key, p.nickname, p.pet, p.ip, p.port
                    ));
                }

                lines.push(format!("=== Visitors ({}) ===", st.visitors.len()));
                for v in &st.visitors {
                    lines.push(format!(
                        "  {} ({}) [{}] arrived={}s_ago duration={}s",
                        v.nickname, v.pet, v.instance_name, now.saturating_sub(v.arrived_at), v.duration_secs
                    ));
                }

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
