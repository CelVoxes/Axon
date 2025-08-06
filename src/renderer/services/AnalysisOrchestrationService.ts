import { BackendClient, GEODataset } from "./BackendClient";
import { Dataset, DataTypeAnalysis, AnalysisPlan } from "./types";
import { WorkspaceManager } from "./WorkspaceManager";

// Types from AnalysisPlanner
export interface AnalysisUnderstanding {
	userQuestion: string;
	requiredSteps: string[];
	dataNeeded: string[];
	expectedOutputs: string[];
	analysisType?: string;
	priority?: string;
	estimatedTime?: string;
	datasets?: Dataset[];
}

// Types from AnalysisSuggestionsService
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

/**
 * Unified AnalysisOrchestrationService handles all analysis planning and suggestions
 * Combines functionality from AnalysisPlanner and AnalysisSuggestionsService
 */
export class AnalysisOrchestrationService {
	private backendClient: BackendClient;
	private workspaceManager: WorkspaceManager;
	private statusCallback?: (status: string) => void;

	// Global code context to track all generated code across the conversation
	private globalCodeContext = new Map<string, string>();
	private conversationId: string;

	constructor(backendClient: BackendClient) {
		this.backendClient = backendClient;
		this.workspaceManager = new WorkspaceManager();
		this.conversationId = `conv_${Date.now()}_${Math.random()
			.toString(36)
			.substr(2, 9)}`;
	}

	setStatusCallback(callback: (status: string) => void) {
		this.statusCallback = callback;
		this.workspaceManager.setStatusCallback(callback);
	}

	// ========== GLOBAL CODE CONTEXT MANAGEMENT ==========

	/**
	 * Add code to the global context
	 */
	addCodeToContext(codeId: string, code: string): void {
		this.globalCodeContext.set(codeId, code);
		console.log(`📝 Added code to global context: ${codeId}`);
	}

	/**
	 * Get all code from the global context
	 */
	getGlobalCodeContext(): string {
		const allCode = Array.from(this.globalCodeContext.values()).join("\n\n");
		return allCode;
	}

	/**
	 * Get code context as a formatted string for LLM prompts
	 */
	getFormattedCodeContext(): string {
		if (this.globalCodeContext.size === 0) {
			return "";
		}

		const contextEntries = Array.from(this.globalCodeContext.entries())
			.map(([id, code]) => `// Code Block: ${id}\n${code}`)
			.join("\n\n");

		return `\n\nPREVIOUSLY GENERATED CODE (DO NOT REPEAT IMPORTS OR SETUP):
\`\`\`python
${contextEntries}
\`\`\`

IMPORTANT: Do not repeat imports, setup code, or functions that were already generated. Focus only on new functionality for this step.`;
	}

	/**
	 * Clear the global code context (useful for new conversations)
	 */
	clearCodeContext(): void {
		this.globalCodeContext.clear();
		console.log("🧹 Cleared global code context");
	}

	/**
	 * Get the current conversation ID
	 */
	getConversationId(): string {
		return this.conversationId;
	}

	/**
	 * Start a new conversation (clears context and generates new ID)
	 */
	startNewConversation(): void {
		this.clearCodeContext();
		this.conversationId = `conv_${Date.now()}_${Math.random()
			.toString(36)
			.substr(2, 9)}`;
		console.log(`🆕 Started new conversation: ${this.conversationId}`);
	}

	private updateStatus(message: string) {
		if (this.statusCallback) {
			this.statusCallback(message);
		}
	}

	// ========== ANALYSIS PLANNING (from AnalysisPlanner) ==========

	async createAnalysisPlan(
		query: string,
		datasets: Dataset[] = []
	): Promise<AnalysisPlan> {
		this.updateStatus("Understanding your question...");

		// Step 1: Analyze the user question
		const understanding = await this.analyzeUserQuestion(query, datasets);

		// Step 2: Find required data
		this.updateStatus("Identifying required data...");
		const foundDatasets = await this.findRequiredData(understanding);

		// Step 3: Create workspace with virtual environment
		this.updateStatus("Setting up workspace...");
		const workingDirectory =
			await this.workspaceManager.createAnalysisWorkspace(query);

		this.updateStatus("Analysis plan created successfully!");

		return {
			understanding,
			datasets: foundDatasets.length > 0 ? foundDatasets : datasets,
			workingDirectory,
			metadata: {
				createdAt: new Date().toISOString(),
				analysisType: understanding.analysisType || "exploratory",
				complexity: this.determineComplexity(understanding),
				estimatedDuration: understanding.estimatedTime || "30-60 minutes",
			},
		};
	}

	async createAnalysisPlanWithData(
		query: string,
		datasets: Dataset[],
		currentWorkspace: string
	): Promise<AnalysisPlan> {
		this.updateStatus("Understanding your question with provided data...");

		// Step 1: Analyze the user question with existing data context
		const understanding = await this.analyzeUserQuestion(query, datasets);

		// Step 2: Create analysis-specific workspace
		this.updateStatus("Setting up analysis workspace...");
		const workingDirectory =
			await this.workspaceManager.createAnalysisWorkspace(
				query,
				currentWorkspace
			);

		// Step 3: Create workspace metadata with kernel information
		const metadata = {
			createdAt: new Date().toISOString(),
			analysisType: understanding.analysisType || "data-driven",
			complexity: this.determineComplexity(understanding),
			estimatedDuration: understanding.estimatedTime || "45-90 minutes",
			kernelName: "python3", // Default kernel name
			userQuestion: query,
			datasets: datasets.map((d) => ({
				id: d.id,
				title: d.title,
				source: d.source,
			})),
		};

		// Create the workspace metadata file
		await this.workspaceManager.createWorkspaceMetadata(
			workingDirectory,
			metadata
		);

		this.updateStatus("Analysis plan with data created successfully!");

		return {
			understanding,
			datasets,
			workingDirectory,
			metadata,
		};
	}

	async analyzeUserQuestion(
		query: string,
		datasets: Dataset[] = []
	): Promise<AnalysisUnderstanding> {
		try {
			const result = await this.backendClient.analyzeQuery(query);

			// Enhanced understanding with dataset context
			const understanding: AnalysisUnderstanding = {
				userQuestion: query,
				requiredSteps: result.analysis_type
					? [result.analysis_type]
					: ["Load and explore data", "Perform analysis", "Visualize results"],
				dataNeeded: result.data_types || ["Dataset files", "Analysis tools"],
				expectedOutputs: result.entities || [
					"Analysis results",
					"Visualizations",
				],
				analysisType: result.analysis_type || "exploratory",
				datasets,
			};

			return understanding;
		} catch (error) {
			console.error(
				"AnalysisOrchestrationService: Error analyzing query:",
				error
			);

			// Fallback understanding
			return {
				userQuestion: query,
				requiredSteps: [
					"Load and explore the data",
					"Perform statistical analysis",
					"Create visualizations",
					"Interpret results",
				],
				dataNeeded: ["Dataset files"],
				expectedOutputs: ["Analysis results", "Charts and graphs"],
				analysisType: "exploratory",
				datasets,
			};
		}
	}

	async findRequiredData(
		understanding: AnalysisUnderstanding
	): Promise<Dataset[]> {
		if (understanding.dataNeeded.length === 0) {
			return [];
		}

		try {
			// Extract search terms from data requirements
			const searchTerms = understanding.dataNeeded
				.map((need) => need.toLowerCase())
				.filter((term) => !["dataset", "data", "files"].includes(term));

			if (searchTerms.length === 0) {
				return [];
			}

			// Use backend to find relevant datasets
			const searchResults: GEODataset[] =
				await this.backendClient.searchDatasets({
					query: searchTerms.join(" "),
					limit: 10,
				});

			return searchResults.map((d) => ({
				...d,
				source: d.source || "GEO",
			}));
		} catch (error) {
			console.error("AnalysisOrchestrationService: Error finding data:", error);
			return [];
		}
	}

	static async getWorkspaceMetadata(workspacePath: string): Promise<any> {
		try {
			const metadataPath = `${workspacePath}/workspace_metadata.json`;
			const content = await window.electronAPI.readFile(metadataPath);
			return JSON.parse(content);
		} catch (error) {
			console.warn(
				"AnalysisOrchestrationService: Could not read workspace metadata:",
				error
			);
			// Return default metadata for new workspaces
			return {
				kernelName: "python3",
				analysisType: "exploratory",
				createdAt: new Date().toISOString(),
				complexity: "medium",
				estimatedDuration: "45-90 minutes",
			};
		}
	}

	// ========== ANALYSIS SUGGESTIONS (from AnalysisSuggestionsService) ==========

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
					organism: d.organism,
					dataType: d.dataType,
				})),
				contextInfo: currentContext,
			});

			return {
				suggestions: result.suggestions || [],
				recommended_approaches: result.recommended_approaches || [],
				data_insights: result.data_insights || [],
				next_steps: result.next_steps || [],
			};
		} catch (error) {
			console.error(
				"AnalysisOrchestrationService: Error generating suggestions:",
				error
			);

			// Return fallback suggestions
			return this.generateFallbackSuggestions(
				dataTypes,
				userQuestion,
				datasets
			);
		}
	}

	formatSuggestionsForChat(
		suggestions: DataTypeSuggestions,
		userQuestion: string
	): string {
		let formatted = `## 🎯 **Analysis Suggestions**\n\n`;
		formatted += `Based on your question: *"${userQuestion}"*\n\n`;

		// Analysis suggestions
		if (suggestions.suggestions.length > 0) {
			formatted += `### 💡 **Recommended Analyses**\n`;
			suggestions.suggestions.forEach((suggestion, index) => {
				formatted += `${index + 1}. **${suggestion.title}** _(${
					suggestion.complexity
				}, ~${suggestion.estimated_time})_\n`;
				formatted += `   ${suggestion.description}\n`;
				if (suggestion.expected_insights.length > 0) {
					formatted += `   *Expected insights: ${suggestion.expected_insights.join(
						", "
					)}*\n`;
				}
				formatted += `\n`;
			});
		}

		// Recommended approaches
		if (suggestions.recommended_approaches.length > 0) {
			formatted += `### 🔬 **Recommended Approaches**\n`;
			suggestions.recommended_approaches.forEach((approach) => {
				formatted += `- **${approach.approach}**: ${approach.description}\n`;
				if (approach.tools.length > 0) {
					formatted += `  *Tools: ${approach.tools.join(", ")}*\n`;
				}
			});
			formatted += `\n`;
		}

		// Data insights
		if (suggestions.data_insights.length > 0) {
			formatted += `### 📊 **Data Insights**\n`;
			suggestions.data_insights
				.filter((insight) => insight.confidence !== "low")
				.forEach((insight) => {
					const emoji = insight.confidence === "high" ? "🔥" : "💡";
					formatted += `${emoji} ${insight.insight}\n`;
				});
			formatted += `\n`;
		}

		// Next steps
		if (suggestions.next_steps.length > 0) {
			formatted += `### 🚀 **Next Steps**\n`;
			suggestions.next_steps.forEach((step, index) => {
				formatted += `${index + 1}. ${step}\n`;
			});
		}

		return formatted;
	}

	// ========== HELPER METHODS ==========

	private determineComplexity(understanding: AnalysisUnderstanding): string {
		const stepCount = understanding.requiredSteps.length;
		const dataComplexity = understanding.dataNeeded.length;

		if (stepCount <= 3 && dataComplexity <= 2) return "simple";
		if (stepCount <= 6 && dataComplexity <= 4) return "moderate";
		return "complex";
	}

	private generateFallbackSuggestions(
		dataTypes: string[],
		userQuestion: string,
		datasets: Dataset[]
	): DataTypeSuggestions {
		const commonSuggestions: AnalysisSuggestion[] = [
			{
				title: "Exploratory Data Analysis",
				description:
					"Get familiar with your data through descriptive statistics and visualizations",
				data_types: dataTypes,
				complexity: "easy",
				estimated_time: "15-30 minutes",
				expected_insights: ["Data distribution", "Missing values", "Outliers"],
			},
			{
				title: "Statistical Analysis",
				description: "Perform hypothesis testing and statistical comparisons",
				data_types: dataTypes,
				complexity: "medium",
				estimated_time: "30-60 minutes",
				expected_insights: [
					"Significant differences",
					"Correlations",
					"P-values",
				],
			},
		];

		const fallbackApproaches: RecommendedApproach[] = [
			{
				approach: "Data-driven exploration",
				description: "Start with data visualization and summary statistics",
				tools: ["pandas", "matplotlib", "seaborn"],
				data_types: dataTypes,
			},
		];

		return {
			suggestions: commonSuggestions,
			recommended_approaches: fallbackApproaches,
			data_insights: [],
			next_steps: [
				"Load and explore your datasets",
				"Create initial visualizations",
				"Identify patterns and trends",
			],
		};
	}
}
