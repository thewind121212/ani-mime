use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

use crate::helpers::{get_port, now_secs};
use crate::state::{AppState, PeerInfo};

/// UDP port used for peer announcements. Intentionally separate from the HTTP port
/// so a broken HTTP server doesn't block discovery (and vice versa).
const MULTICAST_PORT: u16 = 1235;

/// Link-local multicast group in the IANA "Local Network Control Block"
/// (`224.0.0.0/24`). Addresses in this range are **flooded** by switches —
/// never subject to IGMP snooping — which is what we want for local peer
/// discovery. This is the same class AirPlay/mDNS uses (`224.0.0.251`) and
/// is why those services work on networks that drop other multicast.
///
/// We tried `239.255.42.99` first (organization-scoped, `239.0.0.0/8`) and
/// the dev network silently dropped it despite the kernel-side socket/join
/// and `self-loop confirmed` both succeeding on each peer — classic IGMP
/// snooping behaviour on managed WiFi APs. `224.0.0.200` is unassigned by
/// IANA in the local block, so it's safe to claim for ani-mime.
///
/// Prior attempt before multicast: subnet broadcast (`255.255.255.255`) was
/// dropped outright — many enterprise APs suppress broadcast to prevent
/// broadcast storms.
const MULTICAST_ADDR: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 200);

const ANNOUNCE_INTERVAL_SECS: u64 = 5;
const PEER_EXPIRY_SECS: u64 = 30;
const MAGIC: &str = "ani-mime/1";

/// How often to sweep the full local /24 via direct UDP unicast. Fallback
/// for networks that filter both subnet broadcast and link-local multicast
/// (managed WiFi / enterprise APs with "Bonjour Gateway" allowlists — we
/// saw exactly this on the dev network where even 224.0.0.200 never crossed
/// between clients despite unicast working fine).
const UNICAST_SCAN_INTERVAL_SECS: u64 = 30;
/// Spacing between individual sends within one scan — keeps the burst
/// under ~100 pps so we don't look like a port scanner.
const UNICAST_SEND_SPACING_MS: u64 = 10;

/// Detect the machine's primary LAN IPv4 via the UDP-connect trick.
/// No packet is actually sent — the kernel just picks the default source addr.
fn detect_local_ipv4() -> Option<Ipv4Addr> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    match s.local_addr().ok()?.ip() {
        IpAddr::V4(addr) => Some(addr),
        _ => None,
    }
}

/// Start the UDP-multicast peer discovery.
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
        "[broadcast] starting (instance={}, nickname={}, pet={}, multicast={}:{}, http_port={}, announce_every={}s, unicast_scan_every={}s, expiry={}s)",
        instance_name, nickname, pet, MULTICAST_ADDR, MULTICAST_PORT, http_port,
        ANNOUNCE_INTERVAL_SECS, UNICAST_SCAN_INTERVAL_SECS, PEER_EXPIRY_SECS
    );

    let iface_ip = detect_local_ipv4();
    match iface_ip {
        Some(ip) => crate::app_log!("[broadcast] detected local IPv4: {}", ip),
        None => crate::app_warn!("[broadcast] could not detect local IPv4 — joining multicast via 0.0.0.0 (kernel picks interface)"),
    }

    // ---- Listen socket (also used for sending) -----------------------------
    let listen_socket = match bind_multicast_socket(iface_ip) {
        Ok(s) => {
            crate::app_log!(
                "[broadcast] listen socket bound on 0.0.0.0:{}, joined multicast group {} on iface={}",
                MULTICAST_PORT,
                MULTICAST_ADDR,
                iface_ip.map(|i| i.to_string()).unwrap_or_else(|| "0.0.0.0 (kernel)".into())
            );
            Arc::new(s)
        }
        Err(e) => {
            crate::app_error!(
                "[broadcast] FAILED to bind/join multicast {}:{} — {} (check Local Network permission / firewall / interface IPv4)",
                MULTICAST_ADDR, MULTICAST_PORT, e
            );
            let _ = app_handle.emit(
                "discovery-error",
                format!("broadcast multicast setup failed: {}", e),
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

    // ---- Unicast subnet scan thread ----------------------------------------
    // Fallback for networks that drop multicast — we directly UDP-poke every
    // IP in the local /24 on a slow cadence. Receive side needs no change;
    // the listen socket already accepts unicast on port 1235.
    let scan_socket = listen_socket.clone();
    let scan_instance = instance_name.clone();
    let scan_nickname = nickname.clone();
    let scan_pet = pet.clone();
    std::thread::spawn(move || {
        unicast_scan_loop(scan_socket, scan_instance, scan_nickname, scan_pet, http_port);
    });

    // ---- Expiry thread -----------------------------------------------------
    let exp_state = app_state.clone();
    let exp_handle = app_handle.clone();
    std::thread::spawn(move || {
        expiry_loop(exp_state, exp_handle);
    });

    // ---- Listen thread -----------------------------------------------------
    // One-shot flag: flipped the first time we receive our own packet back.
    // Proves that send → kernel → multicast group → recv is fully functional
    // on THIS machine, independent of whether any peer is reachable.
    let self_loop_confirmed = Arc::new(AtomicBool::new(false));
    let my_instance = instance_name.clone();
    std::thread::spawn(move || {
        listen_loop(listen_socket, app_handle, app_state, my_instance, self_loop_confirmed);
    });
}

/// Bind a UDP socket on the multicast port and join the group. The socket
/// will both receive multicast announces (via the group join) and send them
/// (via send_to to the multicast address).
///
/// `iface_ip` is the interface to join on. Passing `None` → `0.0.0.0`, which
/// tells the kernel to pick. Passing a specific IP binds the join to that
/// interface — useful on multi-homed machines (e.g. Mac mini with en0 + en1).
fn bind_multicast_socket(iface_ip: Option<Ipv4Addr>) -> std::io::Result<UdpSocket> {
    let s = UdpSocket::bind(SocketAddr::from(([0u8, 0, 0, 0], MULTICAST_PORT)))?;
    let join_iface = iface_ip.unwrap_or(Ipv4Addr::UNSPECIFIED);
    s.join_multicast_v4(&MULTICAST_ADDR, &join_iface)?;
    // TTL=1 keeps packets on the local segment — same as mDNS.
    s.set_multicast_ttl_v4(1)?;
    // Receive our own packets too (handle_announce filters self by instance_name).
    // Useful as a self-test: if we see our own announce come back in, we know
    // send+receive are both working on the right interface.
    s.set_multicast_loop_v4(true)?;
    // Short read timeout so the listen loop can eventually exit cleanly
    // if we ever add shutdown handling.
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
    let multicast_addr: SocketAddr = SocketAddr::from((MULTICAST_ADDR, MULTICAST_PORT));

    // Give the network stack a moment to finish setting up the multicast
    // membership before the first send — eliminates the "No route to host"
    // on send #1 we saw on some Macs when the send raced the kernel.
    std::thread::sleep(Duration::from_millis(500));

    let mut tick: u64 = 0;
    loop {
        tick += 1;
        let ip = detect_local_ipv4()
            .map(|v| v.to_string())
            .unwrap_or_default();
        let payload = build_payload(&instance_name, &nickname, &pet, &ip, http_port);
        let size = payload.len();

        match socket.send_to(&payload, multicast_addr) {
            Ok(sent) => {
                // Log every tick for the first few (so users see it working),
                // then once per minute to avoid log spam.
                if tick <= 3 || tick % 12 == 0 {
                    crate::app_log!(
                        "[broadcast] announced #{} ({} bytes, sent={}, ip={}, http_port={}, via multicast {}:{})",
                        tick, size, sent, ip, http_port, MULTICAST_ADDR, MULTICAST_PORT
                    );
                }
            }
            Err(e) => {
                crate::app_error!(
                    "[broadcast] send_to {}:{} failed: {} (interface gone? multicast route missing? permission revoked?)",
                    MULTICAST_ADDR, MULTICAST_PORT, e
                );
            }
        }

        std::thread::sleep(Duration::from_secs(ANNOUNCE_INTERVAL_SECS));
    }
}

/// Sweep the local /24 via direct UDP unicast. Every
/// `UNICAST_SCAN_INTERVAL_SECS`, send our announce payload to every IP in
/// the subnet (.1–.254, skipping self). The receive side on each peer
/// handles unicast the same way as multicast — the `handle_announce` logic
/// is unchanged.
fn unicast_scan_loop(
    socket: Arc<UdpSocket>,
    instance_name: String,
    nickname: String,
    pet: String,
    http_port: u16,
) {
    // Let the network come up before the first scan.
    std::thread::sleep(Duration::from_secs(3));

    let mut scan_num: u64 = 0;
    loop {
        scan_num += 1;
        let local = match detect_local_ipv4() {
            Some(ip) => ip,
            None => {
                crate::app_warn!("[broadcast] unicast scan #{}: no local IPv4 detected, skipping", scan_num);
                std::thread::sleep(Duration::from_secs(UNICAST_SCAN_INTERVAL_SECS));
                continue;
            }
        };

        let octets = local.octets();
        let local_last = octets[3];
        let prefix = format!("{}.{}.{}.", octets[0], octets[1], octets[2]);
        let payload = build_payload(&instance_name, &nickname, &pet, &local.to_string(), http_port);

        let started = std::time::Instant::now();
        let mut ok_count: u32 = 0;
        let mut err_count: u32 = 0;

        for last in 1u8..=254u8 {
            if last == local_last {
                continue;
            }
            let target: SocketAddr = match format!("{}{}:{}", prefix, last, MULTICAST_PORT).parse() {
                Ok(a) => a,
                Err(_) => continue,
            };
            match socket.send_to(&payload, target) {
                Ok(_) => ok_count += 1,
                Err(_) => err_count += 1, // EHOSTUNREACH / ENETUNREACH are common + noisy
            }
            std::thread::sleep(Duration::from_millis(UNICAST_SEND_SPACING_MS));
        }

        let elapsed = started.elapsed().as_millis();
        crate::app_log!(
            "[broadcast] unicast scan #{} done: prefix={}x/24, sent_ok={}, send_err={}, took={}ms",
            scan_num, prefix, ok_count, err_count, elapsed
        );

        // Wait the remainder of the interval before the next scan.
        let spent_secs = started.elapsed().as_secs();
        let remaining = UNICAST_SCAN_INTERVAL_SECS.saturating_sub(spent_secs);
        std::thread::sleep(Duration::from_secs(remaining));
    }
}

fn listen_loop(
    socket: Arc<UdpSocket>,
    app_handle: tauri::AppHandle,
    app_state: Arc<Mutex<AppState>>,
    my_instance: String,
    self_loop_confirmed: Arc<AtomicBool>,
) {
    let mut buf = [0u8; 1500];
    crate::app_log!(
        "[broadcast] listening for peer announcements on 0.0.0.0:{} (multicast group {})",
        MULTICAST_PORT, MULTICAST_ADDR
    );

    loop {
        match socket.recv_from(&mut buf) {
            Ok((n, from)) => {
                let raw = &buf[..n];
                match serde_json::from_slice::<serde_json::Value>(raw) {
                    Ok(v) => handle_announce(&v, from, &app_handle, &app_state, &my_instance, &self_loop_confirmed),
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
    self_loop_confirmed: &AtomicBool,
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
        // Our own multicast looping back. Log once to confirm the local
        // send→recv pipeline works — absence of this line means multicast
        // is broken on this machine even before we talk to any peer.
        if !self_loop_confirmed.swap(true, Ordering::Relaxed) {
            crate::app_log!(
                "[broadcast] self-loop confirmed: received own packet from {} — local multicast OK",
                from
            );
        }
        return;
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
