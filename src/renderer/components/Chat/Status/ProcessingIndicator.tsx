import React from "react";

export interface ProcessingIndicatorProps {
	text?: string;
}

export const ProcessingIndicator: React.FC<ProcessingIndicatorProps> = ({
	text = "Thinking...",
}) => {
	const letters = React.useMemo(() => Array.from(text), [text]);
	return (
		<div className="processing-indicator">
			<div className="processing-content">
				<span className="processing-text shimmer-text">{text}</span>
			</div>
		</div>
	);
};
