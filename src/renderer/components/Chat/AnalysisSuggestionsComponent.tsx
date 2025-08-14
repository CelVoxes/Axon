import React from "react";

interface ExamplesComponentProps {
	onExampleSelect: (example: string) => void;
}

export const ExamplesComponent: React.FC<ExamplesComponentProps> = ({
	onExampleSelect,
}) => {
	const examples = [
		"Load my datasets and show a quick summary",
		"Create basic visualizations to explore my data",
		"Run quality control checks",
		"Perform basic statistical analysis",
		"Find differentially expressed genes",
		"Run a simple clustering analysis",
	];

	return (
		<div className="examples-container">
			<div className="examples-header">
				<h3>💡 Example Queries</h3>
			</div>

			<div
				style={{
					display: "flex",
					flexWrap: "wrap",
					gap: 8,
				}}
			>
				{examples.map((query, index) => (
					<button
						key={index}
						onClick={() => onExampleSelect(query)}
						style={{
							background: "#2d2d30",
							border: "1px solid #3c3c3c",
							borderRadius: 6,
							padding: "6px 8px",
							fontSize: 13,
							color: "#e5e7eb",
							cursor: "pointer",
						}}
					>
						{query}
					</button>
				))}
			</div>
		</div>
	);
};
