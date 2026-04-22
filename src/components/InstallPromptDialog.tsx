import { useEffect, useRef, useState } from "react";
import type { InstallPromptPayload } from "../hooks/useInstallPrompt";
import { useCustomMimes } from "../hooks/useCustomMimes";

interface Props {
  prompt: InstallPromptPayload | null;
  error?: string | null;
  onDone: () => void;
}

export function InstallPromptDialog({ prompt, error: rustError = null, onDone }: Props) {
  const { importFromBytes } = useCustomMimes();
  const [busy, setBusy] = useState(false);
  const [frontendError, setFrontendError] = useState<string | null>(null);
  const firstBtn = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { if (prompt) firstBtn.current?.focus(); }, [prompt]);

  // Neither prompt nor any error — render nothing.
  if (!prompt && !rustError) return null;

  const displayError = rustError ?? frontendError;

  // Error-only: Rust rejected the install before a payload arrived.
  if (!prompt) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-title"
        data-testid="install-prompt-dialog"
        className="install-prompt"
      >
        <div className="install-prompt__card">
          <h2 id="install-title">Install from marketplace</h2>
          {displayError && (
            <div className="install-prompt__error" role="alert">{displayError}</div>
          )}
          <div className="install-prompt__actions">
            <button
              ref={firstBtn}
              type="button"
              onClick={onDone}
              data-testid="install-cancel"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  const kb = Math.round(prompt.size_bytes / 1024);
  const sizeLabel = prompt.size_bytes < 1024 ? "< 1 KB" : `${kb} KB`;

  const handleInstall = async () => {
    setBusy(true);
    setFrontendError(null);
    try {
      const res = await fetch(prompt.download_url);
      if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      await importFromBytes(bytes, `${prompt.name}.animime`);
      onDone();
    } catch (e) {
      setFrontendError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-title"
      data-testid="install-prompt-dialog"
      className="install-prompt"
    >
      <div className="install-prompt__card">
        <h2 id="install-title">Install from marketplace</h2>
        <img
          src={prompt.preview_url}
          alt=""
          width={128}
          height={128}
          className="install-prompt__preview pixel"
        />
        <div className="install-prompt__meta">
          <div className="install-prompt__name">{prompt.name}</div>
          {prompt.creator && (
            <div className="install-prompt__creator">by {prompt.creator}</div>
          )}
          <div className="install-prompt__size">{sizeLabel}</div>
        </div>
        {displayError && (
          <div className="install-prompt__error" role="alert">{displayError}</div>
        )}
        <div className="install-prompt__actions">
          <button
            ref={firstBtn}
            type="button"
            onClick={onDone}
            disabled={busy}
            data-testid="install-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleInstall}
            disabled={busy}
            data-testid="install-confirm"
          >
            {busy ? "Installing…" : "Install"}
          </button>
        </div>
      </div>
    </div>
  );
}
