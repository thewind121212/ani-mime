import { invoke } from "@tauri-apps/api/core";
import "../styles/dev-tag.css";

export function DevTag() {
  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await invoke("open_superpower");
  };

  return (
    <button className="dev-tag" onClick={handleClick}>
      DEV
    </button>
  );
}
