use std::sync::{Arc, Mutex};
use tauri::Emitter;

use crate::helpers::{get_port, get_query_param, now_millis, now_secs};
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
                                let was_waiting = session.ui_state == "waiting";
                                let was_busy = session.ui_state == "busy";
                                // Mark auto-approve race: if a codex PermissionRequest
                                // was pending and busy arrived first, the deferred
                                // wait handler should skip the yellow flash.
                                if session.perm_pending_since_ms > 0 {
                                    session.busy_after_perm = true;
                                }
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

                                // Waiting -> busy means the user just approved
                                // a Claude permission prompt. Emit the
                                // dedicated event so the frontend can play the
                                // 3-bubble "permission unlocked" sequence
                                // before the busy hide listener kicks in.
                                let permission_allowed_pwd = if was_waiting {
                                    Some(session.pwd.clone())
                                } else {
                                    None
                                };

                                if let Some(pwd) = permission_allowed_pwd {
                                    crate::app_log!("[http] pid={} permission allowed (waiting -> busy)", pid);
                                    if let Err(e) = app_handle.emit(
                                        "permission-allowed",
                                        serde_json::json!({ "pid": pid, "pwd": pwd }),
                                    ) {
                                        crate::app_error!("[http] failed to emit permission-allowed: {}", e);
                                    }
                                }

                                // Fire `task-started` on non-busy → busy so the
                                // frontend can show a "cooking ${folder}" bubble.
                                // Only AI sessions are eligible — plain shell
                                // bursts already get filtered out in the audio
                                // and bubble paths. The frontend debounces with
                                // a short delay so quick idle→busy→idle blips
                                // never reach a user-visible bubble.
                                if !was_busy {
                                    let started_pwd = session.pwd.clone();
                                    let started_source = if session.is_claude_proc
                                        || pid == 0
                                        || crate::proc_scan::is_claude_pid(pid)
                                    {
                                        "claude"
                                    } else if session.is_codex_proc
                                        || crate::proc_scan::is_codex_pid(pid)
                                    {
                                        "codex"
                                    } else {
                                        ""
                                    };
                                    if !started_source.is_empty() {
                                        crate::app_log!(
                                            "[http] pid={} task started (source={})",
                                            pid, started_source
                                        );
                                        if let Err(e) = app_handle.emit(
                                            "task-started",
                                            serde_json::json!({
                                                "pid": pid,
                                                "pwd": started_pwd,
                                                "source": started_source,
                                            }),
                                        ) {
                                            crate::app_error!(
                                                "[http] failed to emit task-started: {}", e
                                            );
                                        }
                                    }
                                }

                                emit_if_changed(&app_handle, &mut st);
                            } else if url.contains("state=waiting") {
                                session.ui_state = "waiting".to_string();
                                session.busy_type.clear();
                                session.busy_since = 0;
                                session.service_since = 0;
                                crate::app_log!("[http] pid={} -> waiting (permission)", pid);
                                emit_if_changed(&app_handle, &mut st);
                            } else if url.contains("state=idle") {
                                let busy_since = session.busy_since;
                                let task_duration = if busy_since > 0 {
                                    Some(now.saturating_sub(busy_since))
                                } else {
                                    None
                                };

                                // Snapshot context before clearing/dropping the session ref so
                                // the frontend can render a per-source / per-folder message.
                                let task_pwd = session.pwd.clone();
                                // Prefer the cached proc_scan flags. Fall back to a
                                // direct libproc lookup so the first Stop after a
                                // brand-new claude/codex hook fire (before the next
                                // 2s scan pass) still classifies as AI — otherwise
                                // it gets tagged "shell", suppressing the bubble.
                                let task_source = if session.is_claude_proc
                                    || pid == 0
                                    || crate::proc_scan::is_claude_pid(pid)
                                {
                                    "claude"
                                } else if session.is_codex_proc
                                    || crate::proc_scan::is_codex_pid(pid)
                                {
                                    "codex"
                                } else {
                                    "shell"
                                }
                                .to_string();
                                let is_ai_task = task_source == "claude" || task_source == "codex";

                                session.busy_type.clear();
                                if is_ai_task {
                                    // Flash blue (service) for ~2s before idle so the
                                    // user gets a visible "done" pulse on the dog,
                                    // matching the codex shell-hook flash. Watchdog
                                    // converts service -> idle after SERVICE_DISPLAY_SECS.
                                    session.ui_state = "service".to_string();
                                    session.service_since = now;
                                } else {
                                    session.ui_state = "idle".to_string();
                                    session.service_since = 0;
                                }
                                session.busy_since = 0;
                                // Drop session borrow before accessing st fields
                                drop(session);

                                // Suppress bubble + counter when another AI session is
                                // still busy — this is the subagent case. Without the
                                // gate every subagent Stop pops its own "boss done"
                                // bubble and inflates the counter, even though the
                                // main turn isn't actually finished yet.
                                let other_ai_busy = st.sessions.iter().any(|(other_pid, s)| {
                                    *other_pid != pid
                                        && (s.is_claude_proc || s.is_codex_proc || *other_pid == 0)
                                        && s.ui_state == "busy"
                                });

                                if let Some(duration) = task_duration {
                                    if is_ai_task && !other_ai_busy {
                                        crate::app_log!("[http] pid={} task completed ({}s, source={})", pid, duration, task_source);
                                        if let Err(e) = app_handle.emit(
                                            "task-completed",
                                            TaskCompleted {
                                                duration_secs: duration,
                                                pwd: task_pwd,
                                                source: task_source,
                                            },
                                        ) {
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
                                    } else if is_ai_task {
                                        crate::app_log!(
                                            "[http] pid={} subagent stop, suppressing bubble (other AI busy)",
                                            pid
                                        );
                                    }
                                }

                                crate::app_log!("[http] pid={} -> {}", pid, if is_ai_task { "service (flash)" } else { "idle" });
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

            // --- /codex-perm (codex PermissionRequest lifecycle) ---
            // Two phases per request:
            //   phase=start fires immediately when codex needs approval.
            //   phase=wait fires ~500ms later from a backgrounded subshell.
            // Between the two, a state=busy from PreToolUse means codex
            // auto-approved (trusted-project / auto-edit). The wait handler
            // checks `busy_after_perm` to suppress the yellow flash for
            // those non-blocking approvals; only true human waits flip the
            // dot to yellow and (on user approval) trigger the 3-bubble
            // permission-allowed sequence.
            if url.starts_with("/codex-perm") {
                if let Some(pid_str) = get_query_param(&url, "pid") {
                    if let Ok(pid) = pid_str.parse::<u32>() {
                        if pid_exists(pid) {
                            let phase = get_query_param(&url, "phase").unwrap_or("");
                            let mut st = app_state.lock().unwrap();
                            let session = st
                                .sessions
                                .entry(pid)
                                .or_insert_with(|| Session::new_idle(now));
                            session.last_seen = now;

                            if phase == "start" {
                                session.perm_pending_since_ms = now_millis();
                                session.busy_after_perm = false;
                                crate::app_log!("[http] codex pid={} perm-start", pid);
                            } else if phase == "wait" {
                                if session.perm_pending_since_ms == 0 {
                                    crate::app_log!("[http] codex pid={} perm-wait without pending start", pid);
                                } else if session.busy_after_perm {
                                    crate::app_log!("[http] codex pid={} perm-wait suppressed (auto-approve)", pid);
                                    session.perm_pending_since_ms = 0;
                                    session.busy_after_perm = false;
                                } else {
                                    session.ui_state = "waiting".to_string();
                                    session.busy_type.clear();
                                    session.busy_since = 0;
                                    session.service_since = 0;
                                    session.perm_pending_since_ms = 0;
                                    crate::app_log!("[http] codex pid={} perm-wait -> waiting", pid);
                                    emit_if_changed(&app_handle, &mut st);
                                }
                            } else {
                                crate::app_warn!("[http] /codex-perm unknown phase: {}", phase);
                            }
                        } else {
                            crate::app_warn!("[http] /codex-perm rejected: pid={} not running", pid);
                        }
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
                        let message = payload["message"]
                            .as_str()
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty());

                        crate::app_log!(
                            "[visit] {} ({}) [{}] arrived for {}s{}",
                            nickname, pet, instance_name, duration_secs,
                            message.as_deref().map(|m| format!(" — msg: {:?}", m)).unwrap_or_default()
                        );

                        let mut st = app_state.lock().unwrap();
                        st.visitors.push(crate::state::VisitingDog {
                            instance_name: instance_name.clone(),
                            pet: pet.clone(),
                            nickname: nickname.clone(),
                            arrived_at: now,
                            duration_secs,
                            message: message.clone(),
                        });
                        let visitor_count = st.visitors.len();
                        drop(st);

                        crate::app_log!("[visit] total visitors: {}", visitor_count);

                        let mut event_payload = serde_json::json!({
                            "instance_name": instance_name,
                            "pet": pet,
                            "nickname": nickname,
                            "duration_secs": duration_secs,
                        });
                        if let Some(m) = &message {
                            event_payload["message"] = serde_json::Value::String(m.clone());
                        }
                        if let Err(e) = app_handle.emit("visitor-arrived", event_payload) {
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
