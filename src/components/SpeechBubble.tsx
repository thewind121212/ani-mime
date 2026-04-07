import "../styles/speech-bubble.css";

interface SpeechBubbleProps {
  visible: boolean;
  message: string;
  onDismiss: () => void;
}

export function SpeechBubble({ visible, message, onDismiss }: SpeechBubbleProps) {
  if (!visible) return null;

  return (
    <div className="speech-bubble" onClick={onDismiss}>
      <span className="speech-bubble-text">{message}</span>
      <div className="speech-bubble-tail" />
    </div>
  );
}
