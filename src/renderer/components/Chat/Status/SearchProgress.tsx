import React from "react";

interface SearchProgressData {
  message: string;
  progress: number;
  step: string;
  datasetsFound?: number;
  currentTerm?: string;
}

interface SearchProgressProps {
  progress: SearchProgressData | null;
}

export const SearchProgress: React.FC<SearchProgressProps> = ({ progress }) => {
  if (!progress) return null;
  return (
    <div
      style={{
        background: "#2d2d30",
        border: "1px solid #3c3c3c",
        borderRadius: "8px",
        margin: "0",
        padding: "12px",
        color: "white",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "8px",
        }}
      >
        <span style={{ fontWeight: "bold" }}>Search Progress</span>
        <span style={{ color: "#007acc" }}>{progress.progress}%</span>
      </div>

      <div style={{ marginBottom: "8px" }}>
        <strong>Step:</strong> {progress.step || "Processing"}
      </div>

      <div style={{ marginBottom: "8px" }}>
        <strong>Message:</strong> {progress.message}
      </div>

      {progress.currentTerm && (
        <div style={{ marginBottom: "8px" }}>
          <strong>Search Term:</strong> {progress.currentTerm}
        </div>
      )}

      {progress.datasetsFound !== undefined && (
        <div style={{ marginBottom: "8px" }}>
          <strong>Datasets Found:</strong> {progress.datasetsFound}
        </div>
      )}

      <div
        style={{
          width: "100%",
          height: "8px",
          background: "#1e1e1e",
          borderRadius: "4px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progress.progress}%`,
            height: "100%",
            background: "#007acc",
            transition: "width 0.3s ease",
          }}
        ></div>
      </div>
    </div>
  );
};


