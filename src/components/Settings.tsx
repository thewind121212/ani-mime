import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit } from "@tauri-apps/api/event";
import { useTheme, type Theme } from "../hooks/useTheme";
import { usePet } from "../hooks/usePet";
import { useBubble } from "../hooks/useBubble";
import { useGlow, type GlowMode } from "../hooks/useGlow";
import { useNickname } from "../hooks/useNickname";
import { mimeCategories, getMimesByCategory } from "../constants/sprites";
import "../styles/settings.css";

type Tab = "general" | "mime" | "about";

const tabTitles: Record<Tab, string> = {
  general: "General",
  mime: "Mime",
  about: "About",
};

export function Settings() {
  const { theme, setTheme } = useTheme();
  const { pet, setPet } = usePet();
  const { enabled: bubbleEnabled, setEnabled: setBubbleEnabled } = useBubble();
  const { mode: glowMode, setMode: setGlowMode } = useGlow();
  const { nickname, setNickname } = useNickname();
  const [tab, setTab] = useState<Tab>("general");
  const [draftNickname, setDraftNickname] = useState(nickname);
  const nicknameChanged = draftNickname !== nickname;

  useEffect(() => {
    setDraftNickname(nickname);
  }, [nickname]);
  const [devMode, setDevMode] = useState(false);
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Dev mode is session-only: always starts off, cleared on app restart
  useLayoutEffect(() => {
    load("settings.json").then(async (store) => {
      await store.set("devMode", false);
      await store.save();
    });
  }, []);

  const handleVersionClick = async () => {
    if (devMode) return;

    clickCountRef.current += 1;
    clearTimeout(clickTimerRef.current);

    if (clickCountRef.current >= 10) {
      clickCountRef.current = 0;
      setDevMode(true);
      await emit("dev-mode-changed", true);
    } else {
      clickTimerRef.current = setTimeout(() => {
        clickCountRef.current = 0;
      }, 3000);
    }
  };

  return (
    <div className="settings">
      <nav className="settings-sidebar">
        {(["general", "mime", "about"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`sidebar-item ${tab === t ? "active" : ""}`}
            onClick={() => setTab(t)}
          >
            {tabTitles[t]}
          </button>
        ))}
      </nav>
      <main className="settings-content">
        <h1 className="settings-title">{tabTitles[tab]}</h1>
        {tab === "general" && (
          <>
          <div className="settings-section">
            <div className="settings-section-title">Appearance</div>
            <div className="settings-card">
              <div className="settings-row">
                <span className="settings-row-label">Glow Effect</span>
                <div className="theme-toggle">
                  {(["off", "light", "dark"] as GlowMode[]).map((g) => (
                    <button
                      key={g}
                      className={glowMode === g ? "active" : ""}
                      onClick={() => setGlowMode(g)}
                    >
                      {g.charAt(0).toUpperCase() + g.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">Theme</span>
                <div className="theme-toggle">
                  {(["dark", "light"] as Theme[]).map((t) => (
                    <button
                      key={t}
                      className={theme === t ? "active" : ""}
                      onClick={() => setTheme(t)}
                    >
                      {t === "dark" ? "Dark" : "Light"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-section-title">Behavior</div>
            <div className="settings-card">
              <div className="settings-row">
                <span className="settings-row-label">Speech Bubbles</span>
                <button
                  className={`toggle-switch ${bubbleEnabled ? "active" : ""}`}
                  onClick={() => setBubbleEnabled(!bubbleEnabled)}
                >
                  <span className="toggle-knob" />
                </button>
              </div>
            </div>
          </div>
          </>
        )}
        {tab === "mime" && (
          <>
            <p className="mime-desc">Select your mime</p>
            <div className="settings-section">
              <div className="settings-section-title">Identity</div>
              <div className="settings-card">
                <div className="settings-row">
                  <span className="settings-row-label">Nickname</span>
                  <div className="nickname-group">
                    <input
                      type="text"
                      className="settings-input"
                      style={{ textAlign: "right" }}
                      value={draftNickname}
                      placeholder="Enter your name"
                      maxLength={20}
                      onChange={(e) => setDraftNickname(e.target.value)}
                    />
                    <button
                      className={`nickname-save ${nicknameChanged ? "active" : ""}`}
                      disabled={!nicknameChanged}
                      onClick={() => setNickname(draftNickname)}
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            </div>
            {mimeCategories.map((cat) => {
              const mimes = getMimesByCategory(cat.key);
              if (mimes.length === 0) return null;
              return (
                <div className="settings-section" key={cat.key}>
                  <div className="settings-section-title">{cat.label}</div>
                  <div className="pet-grid">
                    {mimes.map((p) => {
                      const previewUrl = new URL(
                        `../assets/sprites/${p.preview}`,
                        import.meta.url
                      ).href;
                      return (
                        <button
                          key={p.id}
                          className={`pet-card ${pet === p.id ? "active" : ""}`}
                          onClick={() => setPet(p.id)}
                        >
                          <div
                            className="pet-preview"
                            style={{
                              backgroundImage: `url(${previewUrl})`,
                              backgroundSize: `auto 48px`,
                              backgroundPosition: "0 0",
                              backgroundRepeat: "no-repeat",
                              imageRendering: "pixelated",
                            }}
                          />
                          <span className="pet-name">{p.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </>
        )}
        {tab === "about" && (
          <div className="settings-section">
            <div className="settings-card">
              <div className="about-info">
                <div className="about-name">Ani-Mime</div>
                <div
                  className={`about-version ${devMode ? "dev-active" : ""}`}
                  onClick={handleVersionClick}
                  style={{ userSelect: "none" }}
                >
                  Version 0.14.16{devMode && " (Dev Mode)"}
                </div>
                <div className="about-desc">A floating macOS desktop mascot that reacts to terminal and Claude Code activity in real-time.</div>
              </div>
            </div>
            <div className="settings-card" style={{ marginTop: 12 }}>
              <div className="settings-row">
                <div>
                  <div className="about-label">Author</div>
                  <div className="about-value">vietnguyenhoangw</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="about-label">Twitter</div>
                  <a
                    className="about-link"
                    href="https://x.com/vietnguyenw"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    @vietnguyenw
                  </a>
                </div>
              </div>
            </div>
            <div className="settings-card" style={{ marginTop: 12 }}>
              <div className="about-info">
                <div className="about-label">Contributors</div>
                <div className="about-desc" style={{ marginBottom: 8 }}>Ani-Mime wouldn't be the same without these wonderful people. Thank you for your time, ideas, and code — you made this project better.</div>
                <div className="contributors">
                  {[
                    { login: "thnh-dng", avatar: "https://avatars.githubusercontent.com/u/213000297?v=4" },
                    { login: "yanmad27", avatar: "https://avatars.githubusercontent.com/u/38394675?v=4" },
                    { login: "thanh-dong", avatar: "https://avatars.githubusercontent.com/u/15724923?v=4" },
                  ].map((c) => (
                    <a
                      key={c.login}
                      className="contributor"
                      href={`https://github.com/${c.login}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <img className="contributor-avatar" src={c.avatar} alt={c.login} />
                      <span className="contributor-name">{c.login}</span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
