import React from "react";

interface ValidationSuccessProps {
  message: string;
}

export const ValidationSuccess: React.FC<ValidationSuccessProps> = ({ message }) => {
  if (!message || message.trim().length === 0) return null;
  return (
    <div className="validation-success-indicator">
      <div className="validation-success-header">
        <div className="validation-success-title">
          <span>Validation Passed</span>
          <div className="success-dot" />
        </div>
      </div>
      <div className="validation-errors-details">
        <div className="validation-error-item">
          <span className="error-message">{message}</span>
        </div>
      </div>
    </div>
  );
};

