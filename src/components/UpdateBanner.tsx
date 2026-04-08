import { invoke } from "@tauri-apps/api/core";
import "../styles/update-banner.css";

interface UpdateBannerProps {
  latest: string;
  current: string;
  onDismiss: () => void;
}

export function UpdateBanner({ latest, current, onDismiss }: UpdateBannerProps) {
  const handleUpdate = async () => {
    await invoke("update_now");
    onDismiss();
  };

  const handleSkip = async () => {
    await invoke("skip_version", { version: latest });
    onDismiss();
  };

  return (
    <div className="update-banner">
      <div className="update-text">
        v{latest} available
      </div>
      <div className="update-actions">
        <button className="update-btn primary" onClick={handleUpdate}>Update</button>
        <button className="update-btn" onClick={onDismiss}>Later</button>
        <button className="update-btn" onClick={handleSkip}>Skip</button>
      </div>
    </div>
  );
}
