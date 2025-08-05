import { BackendClient } from "./BackendClient";
import { Dataset } from "./AnalysisPlanner";

export interface AnalysisSuggestion {
	title: string;
	description: string;
	data_types: string[];
	complexity: "easy" | "medium" | "hard";
	estimated_time: string;
	expected_insights: string[];
}

export interface RecommendedApproach {
	approach: string;
	description: string;
	tools: string[];
	data_types: string[];
}

export interface DataInsight {
	insight: string;
	data_type: string;
	confidence: "high" | "medium" | "low";
}

export interface DataTypeSuggestions {
	suggestions: AnalysisSuggestion[];
	recommended_approaches: RecommendedApproach[];
	data_insights: DataInsight[];
	next_steps: string[];
}

export class AnalysisSuggestionsService {
	private backendClient: BackendClient;

	constructor(backendClient: BackendClient) {
		this.backendClient = backendClient;
	}

	async generateSuggestions(
		dataTypes: string[],
		userQuestion: string,
		datasets: Dataset[],
		currentContext: string = ""
	): Promise<DataTypeSuggestions> {
		try {
			const result = await this.backendClient.generateSuggestions({
				dataTypes: dataTypes,
				query: userQuestion,
				selectedDatasets: datasets.map((d) => ({
					id: d.id,
					title: d.title,
					description: d.description,
					dataType: d.dataType,
					organism: d.organism,
					samples: d.samples,
					platform: d.platform,
				})),
				contextInfo: currentContext,
			});
			return result;
		} catch (error) {
			console.error("Error generating suggestions:", error);
			return this.generateFallbackSuggestions(dataTypes, userQuestion, datasets);
		}
	}

	public generateFallbackSuggestions(
		dataTypes: string[],
		userQuestion: string,
		datasets: Dataset[] = []
	): DataTypeSuggestions {
		const suggestions: AnalysisSuggestion[] = [];
		const approaches: RecommendedApproach[] = [];
		const insights: DataInsight[] = [];

		// Generate suggestions based on data types
		for (const dataType of dataTypes) {
			switch (dataType) {
				case "single_cell_expression":
					suggestions.push({
						title: "Single-cell Clustering Analysis",
						description:
							"Identify distinct cell populations and their gene expression patterns",
						data_types: ["single_cell_expression"],
						complexity: "medium",
						estimated_time: "30-60 minutes",
						expected_insights: [
							"Cell type identification",
							"Gene expression patterns",
							"Cell population heterogeneity",
						],
					});
					suggestions.push({
						title: "Differential Expression Analysis",
						description:
							"Find genes that are differentially expressed between cell types or conditions",
						data_types: ["single_cell_expression"],
						complexity: "medium",
						estimated_time: "20-40 minutes",
						expected_insights: [
							"Marker genes",
							"Pathway enrichment",
							"Functional differences",
						],
					});
					approaches.push({
						approach: "Single-cell RNA-seq Analysis",
						description: "Standard pipeline for single-cell data analysis",
						tools: ["scanpy", "seurat", "monocle"],
						data_types: ["single_cell_expression"],
					});
					break;

				case "expression_matrix":
					suggestions.push({
						title: "Expression Pattern Analysis",
						description:
							"Analyze gene expression patterns across samples or conditions",
						data_types: ["expression_matrix"],
						complexity: "easy",
						estimated_time: "15-30 minutes",
						expected_insights: [
							"Expression trends",
							"Sample clustering",
							"Gene correlations",
						],
					});
					approaches.push({
						approach: "Bulk RNA-seq Analysis",
						description: "Standard pipeline for bulk expression data",
						tools: ["DESeq2", "edgeR", "limma"],
						data_types: ["expression_matrix"],
					});
					break;

				case "clinical_data":
					suggestions.push({
						title: "Clinical Data Summary",
						description:
							"Generate comprehensive summary statistics and visualizations",
						data_types: ["clinical_data"],
						complexity: "easy",
						estimated_time: "10-20 minutes",
						expected_insights: [
							"Patient demographics",
							"Clinical correlations",
							"Risk factors",
						],
					});
					approaches.push({
						approach: "Clinical Data Analysis",
						description: "Statistical analysis of clinical variables",
						tools: ["pandas", "scipy", "matplotlib"],
						data_types: ["clinical_data"],
					});
					break;

				case "sequence_data":
					suggestions.push({
						title: "Sequence Quality Assessment",
						description:
							"Evaluate sequence data quality and perform basic analysis",
						data_types: ["sequence_data"],
						complexity: "medium",
						estimated_time: "20-40 minutes",
						expected_insights: [
							"Quality metrics",
							"Sequence characteristics",
							"Potential issues",
						],
					});
					approaches.push({
						approach: "Sequence Analysis",
						description: "Quality control and basic sequence analysis",
						tools: ["fastqc", "samtools", "bedtools"],
						data_types: ["sequence_data"],
					});
					break;

				case "variant_data":
					suggestions.push({
						title: "Variant Analysis",
						description: "Analyze genetic variants and their potential impact",
						data_types: ["variant_data"],
						complexity: "medium",
						estimated_time: "25-45 minutes",
						expected_insights: [
							"Variant frequency",
							"Functional impact",
							"Disease associations",
						],
					});
					approaches.push({
						approach: "Variant Analysis",
						description: "Comprehensive variant analysis pipeline",
						tools: ["bcftools", "annovar", "vep"],
						data_types: ["variant_data"],
					});
					break;
			}

			// Add general insights for each data type
			insights.push({
				insight: `Quality assessment for ${dataType.replace("_", " ")} data`,
				data_type: dataType,
				confidence: "high",
			});
		}

		// Add integration suggestions if multiple data types
		if (dataTypes.length > 1) {
			suggestions.push({
				title: "Multi-omics Integration",
				description:
					"Integrate and correlate multiple data types for comprehensive analysis",
				data_types: dataTypes,
				complexity: "hard",
				estimated_time: "60-120 minutes",
				expected_insights: [
					"Cross-data type correlations",
					"Integrated biological insights",
					"Multi-modal patterns",
				],
			});
		}

		return {
			suggestions,
			recommended_approaches: approaches,
			data_insights: insights,
			next_steps: [
				"Load and examine your data",
				"Perform quality control checks",
				"Choose an analysis approach from the suggestions above",
			],
		};
	}

	formatSuggestionsForChat(suggestions: DataTypeSuggestions): string {
		let formattedMessage =
			"## 🔍 **Analysis Suggestions Based on Your Data**\n\n";

		// Add suggestions
		if (suggestions.suggestions.length > 0) {
			formattedMessage += "### **Recommended Analyses:**\n\n";
			suggestions.suggestions.forEach((suggestion, index) => {
				const complexityEmoji = {
					easy: "🟢",
					medium: "🟡",
					hard: "🔴",
				}[suggestion.complexity];

				formattedMessage += `${index + 1}. **${
					suggestion.title
				}** ${complexityEmoji}\n`;
				formattedMessage += `   • ${suggestion.description}\n`;
				formattedMessage += `   • ⏱️ Estimated time: ${suggestion.estimated_time}\n`;
				formattedMessage += `   • 📊 Expected insights: ${suggestion.expected_insights.join(
					", "
				)}\n\n`;
			});
		}

		// Add recommended approaches
		if (suggestions.recommended_approaches.length > 0) {
			formattedMessage += "### **Recommended Approaches:**\n\n";
			suggestions.recommended_approaches.forEach((approach) => {
				formattedMessage += `• **${approach.approach}**: ${approach.description}\n`;
				formattedMessage += `  Tools: ${approach.tools.join(", ")}\n\n`;
			});
		}

		// Add data insights
		if (suggestions.data_insights.length > 0) {
			formattedMessage += "### **Potential Insights:**\n\n";
			suggestions.data_insights.forEach((insight) => {
				const confidenceEmoji = {
					high: "🟢",
					medium: "🟡",
					low: "🔴",
				}[insight.confidence];

				formattedMessage += `• ${confidenceEmoji} ${insight.insight}\n`;
			});
			formattedMessage += "\n";
		}

		// Add next steps
		if (suggestions.next_steps.length > 0) {
			formattedMessage += "### **Next Steps:**\n\n";
			suggestions.next_steps.forEach((step, index) => {
				formattedMessage += `${index + 1}. ${step}\n`;
			});
		}

		formattedMessage +=
			"\n---\n*💡 **Tip**: You can ask me to execute any of these analyses, or request a custom analysis based on your specific research question.*";

		return formattedMessage;
	}
}
