import React from "react";
import { FiSquare } from "react-icons/fi";

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  isProcessing: boolean;
  isLoading: boolean;
  disabled?: boolean;
}

export const Composer: React.FC<ComposerProps> = ({
  value,
  onChange,
  onSend,
  onStop,
  isProcessing,
  isLoading,
  disabled,
}) => {
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    // Auto-resize textarea
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
  };

  return (
    <div className="chat-input-container">
      <textarea
        value={value}
        onChange={handleTextareaChange}
        onKeyPress={handleKeyPress}
        placeholder="Plan, analyze, or ask me anything"
        disabled={!!disabled || isLoading}
        rows={2}
      />

      <button
        onClick={isProcessing ? onStop : onSend}
        disabled={!isProcessing && (!value.trim() || isLoading || !!disabled)}
        className={`send-button ${isProcessing ? "stop-mode" : ""}`}
        title={isProcessing ? "Stop" : "Send"}
      >
        {isProcessing ? (
          <FiSquare size={16} />
        ) : isLoading ? (
          <div className="loading-dots">
            <span>•</span>
            <span>•</span>
            <span>•</span>
          </div>
        ) : (
          <span style={{ fontSize: "10px", fontWeight: "900", color: "#2d2d30" }}>
            ▶
          </span>
        )}
      </button>
    </div>
  );
};


