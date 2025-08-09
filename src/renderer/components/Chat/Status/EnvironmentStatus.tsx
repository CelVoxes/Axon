import React from "react";

interface EnvironmentStatusProps {
  virtualEnvStatus: string;
  showLog: boolean;
  onToggleLog: () => void;
  isAutoExecuting?: boolean;
}

export const EnvironmentStatus: React.FC<EnvironmentStatusProps> = ({
  virtualEnvStatus,
  showLog,
  onToggleLog,
  isAutoExecuting,
}) => {
  if (!virtualEnvStatus && !isAutoExecuting) return null;

  return (
    <div className="status-display">
      {virtualEnvStatus && (
        <div className="status-item virtual-env-status">
          <div className="status-header" onClick={onToggleLog} style={{ cursor: "pointer" }}>
            <span>Virtual Environment</span>
            <div className="pulse-dot"></div>
            <span className="expand-arrow">{showLog ? "▼" : "▶"}</span>
          </div>
          {showLog && (
            <div className="status-details">
              <div className="status-log">
                <div className="log-content">{virtualEnvStatus}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {isAutoExecuting && (
        <div className="status-item auto-execution-status">
          <div className="status-header">
            <span>Auto-Execution Pipeline</span>
            <div className="pulse-dot"></div>
          </div>
          <div className="status-details">
            <div className="status-log">
              <div className="log-content">Executing analysis steps automatically...</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


