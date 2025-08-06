import React from "react";

interface ExamplesComponentProps {
	onExampleSelect: (example: string) => void;
}

export const ExamplesComponent: React.FC<ExamplesComponentProps> = ({
	onExampleSelect,
}) => {
	const examples = [
		{
			title: "Load and explore data",
			description:
				"Start by loading your datasets and examining their structure",
			query: "Load my datasets and show me a summary of the data",
		},
		{
			title: "Create visualizations",
			description: "Generate plots and charts to understand your data",
			query: "Create some visualizations to explore my data",
		},
		{
			title: "Perform quality control",
			description: "Check data quality and identify potential issues",
			query: "Run quality control checks on my data",
		},
		{
			title: "Statistical analysis",
			description: "Perform basic statistical tests and analysis",
			query: "Perform statistical analysis on my data",
		},
		{
			title: "Differential expression",
			description:
				"Find genes that are differentially expressed between conditions",
			query: "Find differentially expressed genes between my conditions",
		},
		{
			title: "Clustering analysis",
			description: "Group similar samples or genes together",
			query: "Perform clustering analysis on my data",
		},
	];

	return (
		<div className="examples-container">
			<div className="examples-header">
				<h3>💡 Example Queries</h3>
				<p>Click on any example to get started:</p>
			</div>

			<div className="examples-grid">
				{examples.map((example, index) => (
					<div
						key={index}
						className="example-card"
						onClick={() => onExampleSelect(example.query)}
					>
						<div className="example-header">
							<span className="example-title">{example.title}</span>
						</div>

						<p className="example-description">{example.description}</p>

						<div className="example-footer">
							<span className="click-hint">Click to try →</span>
						</div>
					</div>
				))}
			</div>

			<div className="examples-footer">
				<p>
					💡 <strong>Tip:</strong> You can also ask me anything specific about
					your data analysis needs!
				</p>
			</div>
		</div>
	);
};
