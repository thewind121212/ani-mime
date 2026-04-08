use std::sync::{Arc, Mutex};
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use tauri::Emitter;

use crate::helpers::get_port;
use crate::state::{AppState, PeerInfo};

const SERVICE_TYPE: &str = "_ani-mime._tcp.local.";

/// Register this instance on the network and browse for peers.
pub fn start_discovery(
    app_handle: tauri::AppHandle,
    app_state: Arc<Mutex<AppState>>,
    nickname: String,
    pet: String,
) {
    std::thread::spawn(move || {
        crate::app_log!("[discovery] starting mDNS discovery (nickname={}, pet={})", nickname, pet);

        let port = get_port();
        crate::app_log!("[discovery] using port {}", port);

        let mdns = match ServiceDaemon::new() {
            Ok(d) => {
                crate::app_log!("[discovery] mDNS daemon created");
                d
            }
            Err(e) => {
                crate::app_error!("[discovery] failed to create mDNS daemon: {}", e);
                return;
            }
        };

        // Resolve hostname
        let raw_host = hostname::get()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let host_name = if raw_host.ends_with(".local") || raw_host.ends_with(".local.") {
            if raw_host.ends_with('.') { raw_host.clone() } else { format!("{}.", raw_host) }
        } else {
            format!("{}.local.", raw_host.trim_end_matches('.'))
        };
        crate::app_log!("[discovery] hostname: {} -> {}", raw_host, host_name);

        let instance_name = format!("{}-{}", nickname, std::process::id());

        let properties = [
            ("nickname", nickname.as_str()),
            ("pet", pet.as_str()),
        ];

        let service_info = match ServiceInfo::new(
            SERVICE_TYPE,
            &instance_name,
            &host_name,
            "",
            port,
            &properties[..],
        ) {
            Ok(info) => info.enable_addr_auto(),
            Err(e) => {
                crate::app_error!("[discovery] failed to create ServiceInfo: {}", e);
                return;
            }
        };

        match mdns.register(service_info.clone()) {
            Ok(_) => crate::app_log!("[discovery] registered as {} on {}", instance_name, host_name),
            Err(e) => {
                crate::app_error!("[discovery] failed to register mDNS service: {}", e);
                return;
            }
        }

        // Browse for peers
        let receiver = match mdns.browse(SERVICE_TYPE) {
            Ok(r) => {
                crate::app_log!("[discovery] browsing for {} peers", SERVICE_TYPE);
                r
            }
            Err(e) => {
                crate::app_error!("[discovery] failed to start mDNS browse: {}", e);
                return;
            }
        };

        let my_instance = instance_name.clone();

        loop {
            match receiver.recv() {
                Ok(event) => match event {
                    ServiceEvent::SearchStarted(stype) => {
                        crate::app_log!("[discovery] search started for {}", stype);
                    }
                    ServiceEvent::ServiceFound(stype, fullname) => {
                        crate::app_log!("[discovery] service found: {} (type={})", fullname, stype);
                    }
                    ServiceEvent::ServiceResolved(info) => {
                        let peer_instance = info.get_fullname().to_string();
                        // Skip ourselves
                        if peer_instance.contains(&my_instance) {
                            continue;
                        }

                        let nickname = info.get_property_val_str("nickname")
                            .unwrap_or("Unknown")
                            .to_string();
                        let pet = info.get_property_val_str("pet")
                            .unwrap_or("rottweiler")
                            .to_string();
                        let addrs: Vec<String> = info.get_addresses().iter()
                            .map(|a| a.to_string())
                            .collect();
                        let ip = addrs.first().cloned().unwrap_or_default();
                        let port = info.get_port();

                        crate::app_log!(
                            "[discovery] peer resolved: {} (nickname={}, pet={}, addrs=[{}], port={})",
                            peer_instance, nickname, pet, addrs.join(", "), port
                        );

                        if ip.is_empty() {
                            crate::app_warn!("[discovery] peer {} has no address, skipping", peer_instance);
                            continue;
                        }

                        let peer = PeerInfo {
                            instance_name: peer_instance.clone(),
                            nickname,
                            pet,
                            ip,
                            port,
                        };

                        let mut st = app_state.lock().unwrap();
                        st.peers.insert(peer_instance, peer);
                        let peer_count = st.peers.len();
                        let peers: Vec<PeerInfo> = st.peers.values().cloned().collect();
                        drop(st);

                        crate::app_log!("[discovery] total peers: {}", peer_count);

                        if let Err(e) = app_handle.emit("peers-changed", &peers) {
                            crate::app_error!("[discovery] failed to emit peers-changed: {}", e);
                        }
                    }
                    ServiceEvent::ServiceRemoved(stype, fullname) => {
                        crate::app_log!("[discovery] peer removed: {} (type={})", fullname, stype);

                        let mut st = app_state.lock().unwrap();
                        st.peers.remove(&fullname);
                        let peer_count = st.peers.len();
                        let peers: Vec<PeerInfo> = st.peers.values().cloned().collect();
                        drop(st);

                        crate::app_log!("[discovery] total peers after removal: {}", peer_count);

                        if let Err(e) = app_handle.emit("peers-changed", &peers) {
                            crate::app_error!("[discovery] failed to emit peers-changed: {}", e);
                        }
                    }
                    ServiceEvent::SearchStopped(stype) => {
                        crate::app_warn!("[discovery] search stopped for {}", stype);
                    }
                },
                Err(e) => {
                    crate::app_error!("[discovery] mDNS receiver error: {}", e);
                    break;
                }
            }
        }

        crate::app_warn!("[discovery] mDNS event loop exited");
    });
}
