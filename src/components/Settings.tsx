import { useState } from "react";
import { useTheme, type Theme } from "../hooks/useTheme";
import { usePet } from "../hooks/usePet";
import { useBubble } from "../hooks/useBubble";
import { useNickname } from "../hooks/useNickname";
import { pets } from "../constants/sprites";
import "../styles/settings.css";

type Tab = "general" | "about";

export function Settings() {
  const { theme, setTheme } = useTheme();
  const { pet, setPet } = usePet();
  const { enabled: bubbleEnabled, setEnabled: setBubbleEnabled } = useBubble();
  const { nickname, setNickname } = useNickname();
  const [tab, setTab] = useState<Tab>("general");

  return (
    <div className="settings">
      <nav className="settings-sidebar">
        <button
          className={`sidebar-item ${tab === "general" ? "active" : ""}`}
          onClick={() => setTab("general")}
        >
          General
        </button>
        <button
          className={`sidebar-item ${tab === "about" ? "active" : ""}`}
          onClick={() => setTab("about")}
        >
          About
        </button>
      </nav>
      <main className="settings-content">
        <h1 className="settings-title">{tab === "general" ? "General" : "About"}</h1>
        {tab === "general" && (
          <>
          <div className="settings-section">
            <div className="settings-section-title">Identity</div>
            <div className="settings-card">
              <div className="settings-row">
                <span className="settings-row-label">Nickname</span>
                <input
                  type="text"
                  className="settings-input"
                  value={nickname}
                  placeholder="Enter your name"
                  maxLength={20}
                  onChange={(e) => setNickname(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-section-title">Appearance</div>
            <div className="settings-card">
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
            <div className="settings-section-title">Pet</div>
            <div className="pet-grid">
              {pets.map((p) => {
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
                        backgroundSize: `auto 64px`,
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
        {tab === "about" && (
          <div className="settings-section">
            <div className="settings-card">
              <div className="about-info">
                <div className="about-name">Ani-Mime</div>
                <div className="about-version">Version 0.14.2</div>
                <div className="about-desc">A floating macOS desktop mascot that reacts to terminal and Claude Code activity in real-time.</div>
              </div>
            </div>
            <div className="settings-card" style={{ marginTop: 12 }}>
              <div className="about-info">
                <div className="about-label">Author</div>
                <div className="about-value">vietnguyenhoangw</div>
              </div>
            </div>
            <div className="settings-card" style={{ marginTop: 12 }}>
              <div className="about-info">
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
        )}
      </main>
    </div>
  );
}
