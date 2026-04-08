import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTheme } from "../hooks/useTheme";
import { ScenarioViewer } from "./scenarios";
import "../styles/theme.css";
import "../styles/superpower.css";

interface LogEntry {
  timestamp: number;
  level: string;
  message: string;
}

type LogFilter = "all" | "info" | "warn" | "error";
type MenuItem = "logs" | "scenarios";

function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleTimeString("en-US", { hour12: false });
}

const tagColorMap: Record<string, string> = {
  http: "#5e5ce6",
  visit: "#af52de",
  discovery: "#007aff",
  watchdog: "#ff9f0a",
  setup: "#34c759",
  app: "#5ac8fa",
  state: "#64d2ff",
  platform: "#636366",
};

function LogTag({ tag }: { tag: string }) {
  const color = tagColorMap[tag] || "#636366";
  return <span className="log-tag" style={{ color }}>{tag}</span>;
}

function LogLevel({ level }: { level: string }) {
  if (level === "info") return null;
  return <span className={`log-level log-level-${level}`}>{level.toUpperCase()}</span>;
}

function parseLogTag(message: string): { tag: string; rest: string } {
  const match = message.match(/^\[(\w+)]\s*(.*)/);
  if (match) return { tag: match[1], rest: match[2] };
  return { tag: "", rest: message };
}

function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogFilter>("all");
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const entries = await invoke<LogEntry[]>("get_logs");
      setLogs(entries);
    } catch {
      // silently ignore
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 1000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  const filtered = logs.filter((entry) => {
    if (filter !== "all" && entry.level !== filter) return false;
    if (search && !entry.message.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filtered, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  };

  const handleClear = async () => {
    await invoke("clear_logs");
    setLogs([]);
  };

  const warnCount = logs.filter((l) => l.level === "warn").length;
  const errorCount = logs.filter((l) => l.level === "error").length;

  return (
    <div className="log-viewer">
      <div className="log-toolbar">
        <span className="log-toolbar-title">Logs</span>
        <div className="log-toolbar-actions">
          <input
            className="log-search"
            type="text"
            placeholder="Filter..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="log-filter-group">
            {(["all", "info", "warn", "error"] as LogFilter[]).map((f) => (
              <button
                key={f}
                className={`log-filter-btn ${filter === f ? "active" : ""} ${f === "warn" && warnCount > 0 ? "has-warn" : ""} ${f === "error" && errorCount > 0 ? "has-error" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "All" : f === "info" ? "Info" : f === "warn" ? `Warn${warnCount > 0 ? ` (${warnCount})` : ""}` : `Error${errorCount > 0 ? ` (${errorCount})` : ""}`}
              </button>
            ))}
          </div>
          <span className="log-count">{filtered.length}/{logs.length}</span>
          <button className="log-btn" onClick={handleClear}>Clear</button>
        </div>
      </div>
      <div
        className="log-container"
        ref={containerRef}
        onScroll={handleScroll}
      >
        {filtered.length === 0 && (
          <div className="log-empty">
            {logs.length === 0
              ? "No logs yet. Activity will appear here."
              : "No logs match the current filter."}
          </div>
        )}
        {filtered.map((entry, i) => {
          const { tag, rest } = parseLogTag(entry.message);
          return (
            <div key={i} className={`log-entry log-entry-${entry.level}`}>
              <span className="log-time">{formatTime(entry.timestamp)}</span>
              <LogLevel level={entry.level} />
              {tag && <LogTag tag={tag} />}
              <span className="log-msg">{rest}</span>
            </div>
          );
        })}
      </div>
      {!autoScroll && (
        <button
          className="log-scroll-btn"
          onClick={() => {
            setAutoScroll(true);
            containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: "smooth" });
          }}
        >
          Scroll to bottom
        </button>
      )}
    </div>
  );
}

export function SuperpowerTool() {
  const [activeMenu, setActiveMenu] = useState<MenuItem>("logs");
  useTheme();

  return (
    <div className="superpower">
      <nav className="superpower-sidebar">
        <div className="superpower-logo">Superpower</div>
        <button
          className={`superpower-menu-item ${activeMenu === "logs" ? "active" : ""}`}
          onClick={() => setActiveMenu("logs")}
        >
          <span className="menu-icon">&#9776;</span>
          Logs
        </button>
        <button
          className={`superpower-menu-item ${activeMenu === "scenarios" ? "active" : ""}`}
          onClick={() => setActiveMenu("scenarios")}
        >
          <span className="menu-icon">&#9655;</span>
          Scenarios
        </button>
      </nav>
      <main className="superpower-content">
        {activeMenu === "logs" && <LogViewer />}
        {activeMenu === "scenarios" && <ScenarioViewer />}
      </main>
    </div>
  );
}
