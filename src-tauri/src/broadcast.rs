use std::net::{SocketAddr, UdpSocket};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

use crate::helpers::{get_port, now_secs};
use crate::state::{AppState, PeerInfo};

/// UDP port used for peer announcements. Intentionally separate from the HTTP port
/// so a broken HTTP server doesn't block discovery (and vice versa).
const BROADCAST_PORT: u16 = 1235;
const ANNOUNCE_INTERVAL_SECS: u64 = 5;
const PEER_EXPIRY_SECS: u64 = 30;
const MAGIC: &str = "ani-mime/1";

/// Detect the machine's primary LAN IP via the UDP-connect trick.
/// No packet is actually sent — the kernel just picks the default source addr.
fn detect_local_ip() -> Option<String> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    Some(s.local_addr().ok()?.ip().to_string())
}

/// Start the UDP-broadcast peer discovery.
///
/// Runs alongside mDNS (`discovery.rs`) — both write into `AppState.peers`
/// keyed by `instance_name`, so duplicates from the two channels are collapsed.
pub fn start_broadcast(
    app_handle: tauri::AppHandle,
    app_state: Arc<Mutex<AppState>>,
    nickname: String,
    pet: String,
) {
    let http_port = get_port();
    let instance_name = format!("{}-{}", nickname, std::process::id());

    crate::app_log!(
        "[broadcast] starting (instance={}, nickname={}, pet={}, udp_port={}, http_port={}, announce_every={}s, expiry={}s)",
        instance_name, nickname, pet, BROADCAST_PORT, http_port, ANNOUNCE_INTERVAL_SECS, PEER_EXPIRY_SECS
    );

    match detect_local_ip() {
        Some(ip) => crate::app_log!("[broadcast] detected local IP: {}", ip),
        None => crate::app_warn!("[broadcast] could not detect local IP (no default route?)"),
    }

    // ---- Listen socket (shared with OS) ------------------------------------
    let listen_socket = match bind_listen_socket() {
        Ok(s) => {
            crate::app_log!("[broadcast] listen socket bound on 0.0.0.0:{}", BROADCAST_PORT);
            Arc::new(s)
        }
        Err(e) => {
            crate::app_error!(
                "[broadcast] FAILED to bind listen socket on :{} — {} (check Local Network permission / firewall / port conflict)",
                BROADCAST_PORT, e
            );
            let _ = app_handle.emit(
                "discovery-error",
                format!("broadcast listen bind failed: {}", e),
            );
            return;
        }
    };

    // ---- Announce thread ---------------------------------------------------
    let ann_socket = listen_socket.clone();
    let ann_instance = instance_name.clone();
    let ann_nickname = nickname.clone();
    let ann_pet = pet.clone();
    std::thread::spawn(move || {
        announce_loop(ann_socket, ann_instance, ann_nickname, ann_pet, http_port);
    });

    // ---- Expiry thread -----------------------------------------------------
    let exp_state = app_state.clone();
    let exp_handle = app_handle.clone();
    std::thread::spawn(move || {
        expiry_loop(exp_state, exp_handle);
    });

    // ---- Listen thread -----------------------------------------------------
    let my_instance = instance_name.clone();
    std::thread::spawn(move || {
        listen_loop(listen_socket, app_handle, app_state, my_instance);
    });
}

/// Bind a UDP socket that can both receive broadcasts and send them.
/// Uses `SO_REUSEADDR` so multiple instances on the same machine can coexist
/// during development.
fn bind_listen_socket() -> std::io::Result<UdpSocket> {
    let s = UdpSocket::bind(SocketAddr::from(([0u8, 0, 0, 0], BROADCAST_PORT)))?;
    s.set_broadcast(true)?;
    // Non-blocking would complicate the loop; a modest read timeout keeps the
    // listener responsive so it can exit cleanly if we ever add shutdown.
    s.set_read_timeout(Some(Duration::from_secs(1)))?;
    Ok(s)
}

/// Build the JSON announce payload once per tick. Keep it small — UDP datagrams
/// above ~512 bytes risk fragmentation on some networks.
fn build_payload(
    instance_name: &str,
    nickname: &str,
    pet: &str,
    ip: &str,
    port: u16,
) -> Vec<u8> {
    let v = serde_json::json!({
        "magic": MAGIC,
        "instance_name": instance_name,
        "nickname": nickname,
        "pet": pet,
        "ip": ip,
        "port": port,
    });
    v.to_string().into_bytes()
}

fn announce_loop(
    socket: Arc<UdpSocket>,
    instance_name: String,
    nickname: String,
    pet: String,
    http_port: u16,
) {
    let broadcast_addr: SocketAddr = SocketAddr::from(([255u8, 255, 255, 255], BROADCAST_PORT));
    let mut tick: u64 = 0;

    loop {
        tick += 1;
        let ip = detect_local_ip().unwrap_or_default();
        let payload = build_payload(&instance_name, &nickname, &pet, &ip, http_port);
        let size = payload.len();

        match socket.send_to(&payload, broadcast_addr) {
            Ok(sent) => {
                // Log every tick for the first few (so users see it working),
                // then once per minute to avoid log spam.
                if tick <= 3 || tick % 12 == 0 {
                    crate::app_log!(
                        "[broadcast] announced #{} ({} bytes, sent={}, ip={}, http_port={})",
                        tick, size, sent, ip, http_port
                    );
                }
            }
            Err(e) => {
                crate::app_error!(
                    "[broadcast] send_to 255.255.255.255:{} failed: {} (firewall? network entitlement missing?)",
                    BROADCAST_PORT, e
                );
            }
        }

        std::thread::sleep(Duration::from_secs(ANNOUNCE_INTERVAL_SECS));
    }
}

fn listen_loop(
    socket: Arc<UdpSocket>,
    app_handle: tauri::AppHandle,
    app_state: Arc<Mutex<AppState>>,
    my_instance: String,
) {
    let mut buf = [0u8; 1500];
    crate::app_log!("[broadcast] listening for peer announcements on 0.0.0.0:{}", BROADCAST_PORT);

    loop {
        match socket.recv_from(&mut buf) {
            Ok((n, from)) => {
                let raw = &buf[..n];
                match serde_json::from_slice::<serde_json::Value>(raw) {
                    Ok(v) => handle_announce(&v, from, &app_handle, &app_state, &my_instance),
                    Err(e) => {
                        crate::app_warn!(
                            "[broadcast] received {} bytes from {} that isn't JSON: {}",
                            n, from, e
                        );
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock
                || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                // Normal — read_timeout fired. Loop around.
            }
            Err(e) => {
                crate::app_error!("[broadcast] recv_from error: {}", e);
                std::thread::sleep(Duration::from_secs(1));
            }
        }
    }
}

fn handle_announce(
    v: &serde_json::Value,
    from: SocketAddr,
    app_handle: &tauri::AppHandle,
    app_state: &Arc<Mutex<AppState>>,
    my_instance: &str,
) {
    let magic = v["magic"].as_str().unwrap_or("");
    if magic != MAGIC {
        // Silently ignore foreign traffic on our port — not worth logging.
        return;
    }

    let instance_name = match v["instance_name"].as_str() {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => {
            crate::app_warn!("[broadcast] announce from {} missing instance_name, skipping", from);
            return;
        }
    };

    if instance_name == my_instance {
        return; // our own broadcast bouncing back
    }

    let nickname = v["nickname"].as_str().unwrap_or("Unknown").to_string();
    let pet = v["pet"].as_str().unwrap_or("rottweiler").to_string();
    let port = v["port"].as_u64().unwrap_or(1234) as u16;

    // Prefer the IP the peer advertised; fall back to the UDP source IP.
    let advertised_ip = v["ip"].as_str().unwrap_or("").to_string();
    let ip = if !advertised_ip.is_empty() {
        advertised_ip
    } else {
        from.ip().to_string()
    };

    let now = now_secs();
    let mut st = app_state.lock().unwrap();
    let was_known = st.peers.contains_key(&instance_name);
    let last_seen_before = st.broadcast_seen.get(&instance_name).copied();

    let peer = PeerInfo {
        instance_name: instance_name.clone(),
        nickname: nickname.clone(),
        pet: pet.clone(),
        ip: ip.clone(),
        port,
    };
    st.peers.insert(instance_name.clone(), peer);
    st.broadcast_seen.insert(instance_name.clone(), now);
    let peer_count = st.peers.len();
    let peers: Vec<PeerInfo> = st.peers.values().cloned().collect();
    drop(st);

    if !was_known {
        crate::app_log!(
            "[broadcast] NEW peer: {} ({}) at {}:{} via {} — total peers={}",
            nickname, pet, ip, port, from, peer_count
        );
        if let Err(e) = app_handle.emit("peers-changed", &peers) {
            crate::app_error!("[broadcast] failed to emit peers-changed: {}", e);
        }
    } else {
        // Log refresh once per peer per minute to confirm liveness without spam.
        let should_log = match last_seen_before {
            Some(prev) => now - prev >= 60,
            None => true,
        };
        if should_log {
            crate::app_log!(
                "[broadcast] refresh peer: {} ({}) at {}:{} (known={}s)",
                nickname, pet, ip, port,
                last_seen_before.map(|t| now - t).unwrap_or(0)
            );
        }
    }
}

fn expiry_loop(app_state: Arc<Mutex<AppState>>, app_handle: tauri::AppHandle) {
    loop {
        std::thread::sleep(Duration::from_secs(ANNOUNCE_INTERVAL_SECS));
        let now = now_secs();

        let mut st = app_state.lock().unwrap();
        let stale: Vec<String> = st.broadcast_seen
            .iter()
            .filter(|(_, ts)| now.saturating_sub(**ts) > PEER_EXPIRY_SECS)
            .map(|(name, _)| name.clone())
            .collect();

        if stale.is_empty() {
            continue;
        }

        for name in &stale {
            let age = st.broadcast_seen.get(name).map(|t| now - *t).unwrap_or(0);
            st.broadcast_seen.remove(name);
            if st.peers.remove(name).is_some() {
                crate::app_warn!(
                    "[broadcast] EXPIRED peer: {} (no announce for {}s, limit={}s)",
                    name, age, PEER_EXPIRY_SECS
                );
            }
        }

        let peers: Vec<PeerInfo> = st.peers.values().cloned().collect();
        let peer_count = peers.len();
        drop(st);

        crate::app_log!("[broadcast] after expiry sweep: total peers={}", peer_count);
        if let Err(e) = app_handle.emit("peers-changed", &peers) {
            crate::app_error!("[broadcast] failed to emit peers-changed: {}", e);
        }
    }
}
