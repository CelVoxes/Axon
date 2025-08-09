import React from "react";

interface ProcessingIndicatorProps {
	text: string;
}

export const ProcessingIndicator: React.FC<ProcessingIndicatorProps> = ({
	text,
}) => {
	return (
		<div className="processing-indicator">
			<div className="processing-content">
				<span className="processing-text">{text || "Processing"}</span>
				<span className="loading-dots">
					<span>.</span>
					<span>.</span>
					<span>.</span>
				</span>
			</div>
		</div>
	);
};
