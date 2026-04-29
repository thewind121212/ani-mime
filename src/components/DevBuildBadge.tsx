import "../styles/dev-build-badge.css";

/** Renders only in `bun run tauri dev` builds — Vite sets
 *  `import.meta.env.DEV` to true there and false for `vite build` (release). */
export function DevBuildBadge() {
  if (!import.meta.env.DEV) return null;
  return <div className="dev-build-badge" data-testid="dev-build-badge">DEV</div>;
}
