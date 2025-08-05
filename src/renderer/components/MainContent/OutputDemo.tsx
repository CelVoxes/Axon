import React from "react";
import styled from "styled-components";
import { NotebookOutputRenderer } from "./NotebookOutputRenderer";

const DemoContainer = styled.div`
	padding: 20px;
	background: #151515;
	min-height: 100vh;
`;

const DemoTitle = styled.h1`
	color: #ffffff;
	font-size: 24px;
	margin-bottom: 20px;
	text-align: center;
`;

const DemoSection = styled.div`
	margin-bottom: 40px;
`;

const SectionTitle = styled.h2`
	color: #007acc;
	font-size: 18px;
	margin-bottom: 16px;
`;

const DemoGrid = styled.div`
	display: grid;
	gap: 20px;
`;

export const OutputDemo: React.FC = () => {
	// Sample outputs to demonstrate the enhanced rendering
	const sampleOutputs = [
		{
			title: "DataFrame Output",
			output: `   Name  Age  City
0  John   25  NYC
1  Jane   30  LA
2  Bob    35  SF
3  Alice  28  CHI`,
			type: "dataframe" as const,
		},
		{
			title: "JSON Output",
			output: JSON.stringify(
				{
					results: {
						accuracy: 0.95,
						precision: 0.92,
						recall: 0.88,
						f1_score: 0.9,
					},
					metadata: {
						model: "RandomForest",
						dataset: "iris",
						timestamp: "2024-01-15T10:30:00Z",
					},
				},
				null,
				2
			),
			type: "json" as const,
		},
		{
			title: "Markdown Output",
			output: `# Analysis Results

## Summary
This analysis shows **significant improvements** in model performance.

### Key Findings:
- Accuracy increased by *15%*
- Processing time reduced by 30%
- Memory usage optimized

\`\`\`python
# Example code
import pandas as pd
df = pd.read_csv('data.csv')
\`\`\`

> **Note**: Results are based on 1000 test samples.`,
			type: "markdown" as const,
		},
		{
			title: "Progress Output",
			output:
				"Processing data... 75% complete\nEpoch 15/20 - Loss: 0.0234\nValidation accuracy: 94.2%",
			type: "progress" as const,
		},
		{
			title: "Metrics Output",
			output:
				"Accuracy: 0.9452\nPrecision: 0.9234\nRecall: 0.8876\nF1-Score: 0.9051\nAUC: 0.9789",
			type: "metrics" as const,
		},
		{
			title: "Success Output",
			output:
				"✅ Model training completed successfully!\n📊 Results saved to 'results.json'\n🎯 Model deployed to production",
			type: "success" as const,
		},
		{
			title: "Warning Output",
			output:
				"⚠️ Warning: Some features have missing values\nDeprecationWarning: 'old_function' is deprecated, use 'new_function' instead\nConsider using the updated API for better performance",
			type: "warning" as const,
		},
		{
			title: "Error Output",
			output:
				"❌ Error: ModuleNotFoundError: No module named 'missing_package'\nTraceback (most recent call last):\n  File 'script.py', line 5, in <module>\n    import missing_package\nModuleNotFoundError: No module named 'missing_package'",
			type: "error" as const,
		},
		{
			title: "Chart Output",
			output:
				"📈 Matplotlib figure generated\nFigure size: 800x600\nSaved as: plot_20240115.png\nChart type: Line plot with confidence intervals",
			type: "chart" as const,
		},
		{
			title: "Long Text Output",
			output:
				"This is a very long output that demonstrates the collapsible functionality. ".repeat(
					50
				) +
				"\n\n" +
				"Additional lines to show line counting. ".repeat(30),
			type: "text" as const,
		},
	];

	return (
		<DemoContainer>
			<DemoTitle>Enhanced Notebook Output Renderer Demo</DemoTitle>

			<DemoSection>
				<SectionTitle>Rich Output Types</SectionTitle>
				<DemoGrid>
					{sampleOutputs.map((sample, index) => (
						<div key={index}>
							<h3 style={{ color: "#ffffff", marginBottom: "8px" }}>
								{sample.title}
							</h3>
							<NotebookOutputRenderer
								output={sample.output}
								outputType={sample.type}
								hasError={sample.type === "error"}
							/>
						</div>
					))}
				</DemoGrid>
			</DemoSection>

			<DemoSection>
				<SectionTitle>Features Demonstrated</SectionTitle>
				<div style={{ color: "#d4d4d4", lineHeight: "1.6" }}>
					<ul>
						<li>
							<strong>📊 Data Tables:</strong> Automatic parsing and display of
							pandas DataFrames
						</li>
						<li>
							<strong>🔧 JSON Formatting:</strong> Pretty-printed JSON with
							syntax highlighting
						</li>
						<li>
							<strong>📝 Rich Text:</strong> Markdown rendering with syntax
							highlighting
						</li>
						<li>
							<strong>⏳ Progress Tracking:</strong> Visual progress bars and
							status indicators
						</li>
						<li>
							<strong>📊 Metrics Display:</strong> Card-based layout for key
							metrics
						</li>
						<li>
							<strong>🎨 Status Indicators:</strong> Color-coded success,
							warning, and error states
						</li>
						<li>
							<strong>📏 Collapsible Content:</strong> Long outputs can be
							collapsed/expanded
						</li>
						<li>
							<strong>📋 Copy & Download:</strong> Easy copying and downloading
							of outputs
						</li>
						<li>
							<strong>👁️ Raw View:</strong> Toggle between formatted and raw
							text views
						</li>
						<li>
							<strong>📱 Responsive Design:</strong> Adapts to different screen
							sizes
						</li>
					</ul>
				</div>
			</DemoSection>
		</DemoContainer>
	);
};
