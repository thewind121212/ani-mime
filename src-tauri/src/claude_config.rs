use serde::Serialize;
use std::path::PathBuf;

// ── Types ──────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ClaudeConfig {
    pub plugins: Vec<PluginInfo>,
    pub skills: Vec<SkillInfo>,
    pub commands: Vec<CommandInfo>,
    pub global_mcp_servers: Vec<McpServerInfo>,
    pub project_mcp_servers: Vec<ProjectMcpServers>,
    pub hooks: Vec<HookEventInfo>,
}

#[derive(Serialize)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub marketplace: String,
    pub version: String,
    pub enabled: bool,
    pub install_path: String,
    pub installed_at: String,
    pub skills: Vec<String>,
}

#[derive(Serialize)]
pub struct SkillInfo {
    pub name: String,
    pub path: String,
}

#[derive(Serialize)]
pub struct CommandInfo {
    pub name: String,
    pub file_name: String,
}

#[derive(Serialize)]
pub struct McpServerInfo {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub server_type: String,
}

#[derive(Serialize)]
pub struct ProjectMcpServers {
    pub project_path: String,
    pub servers: Vec<McpServerInfo>,
}

#[derive(Serialize)]
pub struct HookEventInfo {
    pub event: String,
    pub entries: Vec<HookEntry>,
}

#[derive(Serialize)]
pub struct HookEntry {
    pub matcher: String,
    pub hooks: Vec<HookDetail>,
}

#[derive(Serialize)]
pub struct HookDetail {
    pub hook_type: String,
    pub command: String,
    pub timeout: Option<u64>,
    pub status_message: Option<String>,
}

// ── Helpers ────────────────────────────────────────────────────────────

fn claude_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude"))
}

fn claude_json_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude.json"))
}

fn read_json(path: &PathBuf) -> Option<serde_json::Value> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

fn write_json_pretty(path: &PathBuf, value: &serde_json::Value) -> Result<(), String> {
    let json_str = serde_json::to_string_pretty(value)
        .map_err(|e| format!("failed to serialize: {}", e))?;
    std::fs::write(path, json_str)
        .map_err(|e| format!("failed to write {}: {}", path.display(), e))
}

// ── Readers ────────────────────────────────────────────────────────────

/// Scan a plugin's installPath for its skills/, commands/, and agents/ directories.
fn list_dir_names(dir: &std::path::Path) -> Vec<String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return vec![],
    };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    names.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    names
}

fn read_plugins_and_skills(claude: &PathBuf) -> (Vec<PluginInfo>, Vec<SkillInfo>) {
    let installed_path = claude.join("plugins/installed_plugins.json");
    let settings_path = claude.join("settings.json");
    let skills_dir = claude.join("skills");

    let installed = read_json(&installed_path).unwrap_or_default();
    let settings = read_json(&settings_path).unwrap_or_default();

    let enabled_map = settings.get("enabledPlugins")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();

    let plugins_map = match installed.get("plugins").and_then(|v| v.as_object()) {
        Some(m) => m.clone(),
        None => return (vec![], vec![]),
    };

    // Build plugin list — get skills by scanning each plugin's installPath/skills/
    let mut plugins = Vec::new();
    for (id, entries) in &plugins_map {
        let entry = match entries.as_array().and_then(|a| a.first()) {
            Some(e) => e,
            None => continue,
        };

        let parts: Vec<&str> = id.splitn(2, '@').collect();
        let name = parts.first().copied().unwrap_or(id).to_string();
        let marketplace = parts.get(1).copied().unwrap_or("").to_string();

        let enabled = enabled_map.get(id.as_str())
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let install_path = entry["installPath"].as_str().unwrap_or("");
        let skills = if !install_path.is_empty() {
            list_dir_names(&PathBuf::from(install_path).join("skills"))
        } else {
            vec![]
        };

        plugins.push(PluginInfo {
            id: id.clone(),
            name,
            marketplace,
            version: entry["version"].as_str().unwrap_or("unknown").to_string(),
            enabled,
            install_path: install_path.to_string(),
            installed_at: entry["installedAt"].as_str().unwrap_or("").to_string(),
            skills,
        });
    }

    plugins.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    // Standalone skills: entries in ~/.claude/skills/ that are direct directories (not symlinks)
    let mut standalone_skills: Vec<SkillInfo> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&skills_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let ft = match entry.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if !ft.is_dir() && !ft.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            standalone_skills.push(SkillInfo {
                name,
                path: entry.path().to_string_lossy().to_string(),
            });
        }
    }

    standalone_skills.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    (plugins, standalone_skills)
}

fn read_commands(claude: &PathBuf) -> Vec<CommandInfo> {
    let commands_dir = claude.join("commands");
    let entries = match std::fs::read_dir(&commands_dir) {
        Ok(e) => e,
        Err(_) => return vec![],
    };

    let mut result: Vec<CommandInfo> = entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path().extension().map(|ext| ext == "md").unwrap_or(false)
        })
        .map(|e| {
            let file_name = e.file_name().to_string_lossy().to_string();
            let name = file_name.strip_suffix(".md").unwrap_or(&file_name).to_string();
            CommandInfo { name, file_name }
        })
        .collect();

    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    result
}

fn read_mcp_servers(claude_json: &serde_json::Value) -> (Vec<McpServerInfo>, Vec<ProjectMcpServers>) {
    let mut global = Vec::new();
    let mut project = Vec::new();

    // Global servers
    if let Some(servers) = claude_json.get("mcpServers").and_then(|v| v.as_object()) {
        for (name, config) in servers {
            global.push(parse_mcp_server(name, config));
        }
        global.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    }

    // Per-project servers
    if let Some(projects) = claude_json.get("projects").and_then(|v| v.as_object()) {
        for (path, pconfig) in projects {
            if let Some(servers) = pconfig.get("mcpServers").and_then(|v| v.as_object()) {
                if servers.is_empty() {
                    continue;
                }
                let mut srvs: Vec<McpServerInfo> = servers
                    .iter()
                    .map(|(n, c)| parse_mcp_server(n, c))
                    .collect();
                srvs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
                project.push(ProjectMcpServers {
                    project_path: path.clone(),
                    servers: srvs,
                });
            }
        }
        project.sort_by(|a, b| a.project_path.cmp(&b.project_path));
    }

    (global, project)
}

fn parse_mcp_server(name: &str, config: &serde_json::Value) -> McpServerInfo {
    McpServerInfo {
        name: name.to_string(),
        command: config["command"].as_str().unwrap_or("").to_string(),
        args: config["args"]
            .as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default(),
        server_type: config["type"].as_str().unwrap_or("stdio").to_string(),
    }
}

fn read_hooks(claude: &PathBuf) -> Vec<HookEventInfo> {
    let settings_path = claude.join("settings.json");
    let settings = match read_json(&settings_path) {
        Some(s) => s,
        None => return vec![],
    };

    let hooks_obj = match settings.get("hooks").and_then(|v| v.as_object()) {
        Some(h) => h,
        None => return vec![],
    };

    let mut result = Vec::new();
    for (event, entries_val) in hooks_obj {
        let entries_arr = match entries_val.as_array() {
            Some(a) => a,
            None => continue,
        };

        let entries: Vec<HookEntry> = entries_arr
            .iter()
            .map(|entry| {
                let matcher = entry["matcher"].as_str().unwrap_or("").to_string();
                let hooks = entry["hooks"]
                    .as_array()
                    .map(|hks| {
                        hks.iter()
                            .map(|h| HookDetail {
                                hook_type: h["type"].as_str().unwrap_or("command").to_string(),
                                command: h["command"].as_str().unwrap_or("").to_string(),
                                timeout: h["timeout"].as_u64(),
                                status_message: h["statusMessage"].as_str().map(String::from),
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                HookEntry { matcher, hooks }
            })
            .collect();

        result.push(HookEventInfo {
            event: event.clone(),
            entries,
        });
    }

    result.sort_by(|a, b| a.event.cmp(&b.event));
    result
}

// ── Tauri Commands ─────────────────────────────────────────────────────

#[tauri::command]
pub fn get_claude_config() -> Result<ClaudeConfig, String> {
    let claude = claude_dir().ok_or("could not resolve home directory")?;
    let claude_json_p = claude_json_path().ok_or("could not resolve home directory")?;
    let claude_json = read_json(&claude_json_p).unwrap_or_default();

    let (plugins, skills) = read_plugins_and_skills(&claude);
    let commands = read_commands(&claude);
    let (global_mcp_servers, project_mcp_servers) = read_mcp_servers(&claude_json);
    let hooks = read_hooks(&claude);

    Ok(ClaudeConfig {
        plugins,
        skills,
        commands,
        global_mcp_servers,
        project_mcp_servers,
        hooks,
    })
}

#[tauri::command]
pub fn set_plugin_enabled(plugin_id: String, enabled: bool) -> Result<(), String> {
    let claude = claude_dir().ok_or("could not resolve home directory")?;
    let settings_path = claude.join("settings.json");

    let mut settings = read_json(&settings_path).unwrap_or(serde_json::json!({}));

    let enabled_plugins = settings
        .as_object_mut()
        .ok_or("settings is not an object")?
        .entry("enabledPlugins")
        .or_insert(serde_json::json!({}));

    if let Some(obj) = enabled_plugins.as_object_mut() {
        obj.insert(plugin_id, serde_json::Value::Bool(enabled));
    }

    write_json_pretty(&settings_path, &settings)
}

#[tauri::command]
pub fn get_command_content(name: String) -> Result<String, String> {
    let claude = claude_dir().ok_or("could not resolve home directory")?;
    let file_path = claude.join("commands").join(format!("{}.md", name));
    std::fs::read_to_string(&file_path)
        .map_err(|e| format!("failed to read command: {}", e))
}

#[tauri::command]
pub fn delete_command(name: String) -> Result<(), String> {
    let claude = claude_dir().ok_or("could not resolve home directory")?;
    let file_path = claude.join("commands").join(format!("{}.md", name));
    std::fs::remove_file(&file_path)
        .map_err(|e| format!("failed to delete command: {}", e))
}

#[tauri::command]
pub fn delete_mcp_server(name: String, project_path: Option<String>) -> Result<(), String> {
    let path = claude_json_path().ok_or("could not resolve home directory")?;
    let mut data = read_json(&path).unwrap_or(serde_json::json!({}));

    match project_path {
        None => {
            if let Some(servers) = data.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
                servers.remove(&name);
            }
        }
        Some(proj) => {
            if let Some(projects) = data.get_mut("projects").and_then(|v| v.as_object_mut()) {
                if let Some(pconfig) = projects.get_mut(&proj).and_then(|v| v.as_object_mut()) {
                    if let Some(servers) = pconfig.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
                        servers.remove(&name);
                    }
                }
            }
        }
    }

    write_json_pretty(&path, &data)
}

#[tauri::command]
pub fn delete_hook_entry(event: String, entry_index: usize) -> Result<(), String> {
    let claude = claude_dir().ok_or("could not resolve home directory")?;
    let settings_path = claude.join("settings.json");
    let mut settings = read_json(&settings_path)
        .ok_or("could not read settings.json")?;

    let hooks = settings
        .get_mut("hooks")
        .and_then(|v| v.as_object_mut())
        .ok_or("no hooks object in settings")?;

    let entries = hooks
        .get_mut(&event)
        .and_then(|v| v.as_array_mut())
        .ok_or_else(|| format!("no hook entries for event: {}", event))?;

    if entry_index >= entries.len() {
        return Err(format!("entry index {} out of range (len={})", entry_index, entries.len()));
    }

    entries.remove(entry_index);

    // Clean up empty event key
    if entries.is_empty() {
        hooks.remove(&event);
    }

    write_json_pretty(&settings_path, &settings)
}
