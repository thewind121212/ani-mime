import { useState, useLayoutEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types ──────────────────────────────────────────────────────────────

export interface PluginInfo {
  id: string;
  name: string;
  marketplace: string;
  version: string;
  enabled: boolean;
  install_path: string;
  installed_at: string;
  skills: string[];
}

export interface SkillInfo {
  name: string;
  path: string;
}

export interface CommandInfo {
  name: string;
  file_name: string;
}

export interface McpServerInfo {
  name: string;
  command: string;
  args: string[];
  server_type: string;
}

export interface ProjectMcpServers {
  project_path: string;
  servers: McpServerInfo[];
}

export interface HookDetail {
  hook_type: string;
  command: string;
  timeout: number | null;
  status_message: string | null;
}

export interface HookEntry {
  matcher: string;
  hooks: HookDetail[];
}

export interface HookEventInfo {
  event: string;
  entries: HookEntry[];
}

export interface ClaudeConfig {
  plugins: PluginInfo[];
  skills: SkillInfo[];
  commands: CommandInfo[];
  global_mcp_servers: McpServerInfo[];
  project_mcp_servers: ProjectMcpServers[];
  hooks: HookEventInfo[];
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useClaudeConfig() {
  const [config, setConfig] = useState<ClaudeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await invoke<ClaudeConfig>("get_claude_config");
      setConfig(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useLayoutEffect(() => {
    refresh();
  }, [refresh]);

  const setPluginEnabled = useCallback(async (pluginId: string, enabled: boolean) => {
    await invoke("set_plugin_enabled", { pluginId, enabled });
    await refresh();
  }, [refresh]);

  const getCommandContent = useCallback(async (name: string): Promise<string> => {
    return invoke<string>("get_command_content", { name });
  }, []);

  const deleteCommand = useCallback(async (name: string) => {
    await invoke("delete_command", { name });
    await refresh();
  }, [refresh]);

  const deleteMcpServer = useCallback(async (name: string, projectPath?: string) => {
    await invoke("delete_mcp_server", { name, projectPath: projectPath ?? null });
    await refresh();
  }, [refresh]);

  const deleteHookEntry = useCallback(async (event: string, entryIndex: number) => {
    await invoke("delete_hook_entry", { event, entryIndex });
    await refresh();
  }, [refresh]);

  return {
    config,
    loading,
    error,
    refresh,
    setPluginEnabled,
    getCommandContent,
    deleteCommand,
    deleteMcpServer,
    deleteHookEntry,
  };
}
