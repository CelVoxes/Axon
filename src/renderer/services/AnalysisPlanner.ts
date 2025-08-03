import { BackendClient } from "./BackendClient";

export interface Dataset {
	id: string;
	title: string;
	source: string;
	organism: string;
	samples: number;
	platform: string;
	description: string;
	url?: string;
	dataType?: string;
	fileFormat?: string;
	columns?: string[];
	dimensions?: number[];
}

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

export interface AnalysisPlan {
	understanding: AnalysisUnderstanding;
	datasets: Dataset[];
	workingDirectory: string;
}

export class AnalysisPlanner {
	private backendClient: BackendClient;
	private statusCallback?: (status: string) => void;

	constructor(backendClient: BackendClient) {
		this.backendClient = backendClient;
	}

	setStatusCallback(callback: (status: string) => void) {
		this.statusCallback = callback;
	}

	private updateStatus(message: string) {
		if (this.statusCallback) {
			this.statusCallback(message);
		}
	}

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

		// Step 3: Create workspace
		this.updateStatus("Setting up workspace...");
		const workingDirectory = await this.createWorkspace(query);

		this.updateStatus("Analysis plan created successfully!");

		return {
			understanding,
			datasets: foundDatasets,
			workingDirectory,
		};
	}

	async createAnalysisPlanWithData(
		query: string,
		downloadedDatasets: Dataset[]
	): Promise<AnalysisPlan> {
		this.updateStatus("Analyzing your research question...");

		// Step 1: Analyze the user question with existing data
		const understanding = await this.analyzeUserQuestion(
			query,
			downloadedDatasets
		);

		// Step 2: Create workspace
		const workingDirectory = await this.createWorkspace(query);

		this.updateStatus("Analysis plan created successfully!");

		return {
			understanding,
			datasets: downloadedDatasets,
			workingDirectory,
		};
	}

	private async analyzeUserQuestion(
		question: string,
		datasets: Dataset[]
	): Promise<AnalysisUnderstanding> {
		this.updateStatus("Analyzing your research question...");

		try {
			// Call the backend LLM API to generate a plan
			const response = await fetch(
				`${this.backendClient.getBaseUrl()}/llm/plan`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						question: question,
						context: `Research question: ${question}`,
						current_state: {
							datasets_available: datasets?.length || 0,
							datasets:
								datasets?.map((d) => ({ id: d.id, title: d.title })) || [],
						},
						available_data:
							datasets?.map((d) => ({
								id: d.id,
								title: d.title,
								description: d.description,
								samples: d.samples,
								platform: d.platform,
							})) || [],
						task_type: "analysis",
					}),
				}
			);

			if (response.ok) {
				const result = await response.json();
				console.log("LLM plan result:", result);
				return {
					userQuestion: question,
					requiredSteps: result.next_steps || [],
					dataNeeded: result.data_needed || [
						"Biological datasets relevant to the question",
					],
					expectedOutputs: result.expected_outputs || [
						"Analysis results",
						"Visualizations",
					],
					analysisType: result.task_type || "analysis",
					priority: result.priority || "medium",
					estimatedTime: result.estimated_time || "unknown",
					datasets: datasets,
				};
			} else {
				const errorText = await response.text();
				console.warn(
					`LLM plan API call failed. Status: ${response.status}, Error: ${errorText}`
				);
			}
		} catch (apiError) {
			console.warn(`LLM plan API error:`, apiError);
		}

		// Fallback to basic analysis if LLM fails
		console.log("Using fallback analysis for user question");
		return this.generateFallbackAnalysis(question, datasets);
	}

	private generateFallbackAnalysis(
		query: string,
		datasets: Dataset[]
	): AnalysisUnderstanding {
		// Extract key terms from the query to create a more intelligent fallback
		const queryLower = query.toLowerCase();

		let analysisType = "general biological analysis";
		let steps = [
			"Set up analysis environment and install required packages",
			"Acquire and preprocess relevant biological datasets",
			"Perform the requested analysis",
			"Generate visualizations and results",
			"Create comprehensive summary report",
		];
		let dataNeeded = ["Biological datasets relevant to the question"];
		let expectedOutputs = ["Analysis results", "Visualizations"];

		// Detect analysis type based on query content
		if (queryLower.includes("differential") || queryLower.includes("deg")) {
			analysisType = "differential gene expression analysis";
			steps = [
				"Load and preprocess gene expression data",
				"Perform quality control and normalization",
				"Identify differentially expressed genes",
				"Perform statistical analysis and multiple testing correction",
				"Generate volcano plots and heatmaps",
				"Perform pathway enrichment analysis",
				"Create comprehensive differential expression report",
			];
			dataNeeded = ["Gene expression datasets (RNA-seq or microarray)"];
			expectedOutputs = [
				"DEG lists",
				"Volcano plots",
				"Heatmaps",
				"Pathway enrichment results",
			];
		} else if (
			queryLower.includes("subtype") ||
			queryLower.includes("cluster")
		) {
			analysisType = "subtype/clustering analysis";
			steps = [
				"Load and preprocess gene expression data",
				"Perform quality control and normalization",
				"Apply dimensionality reduction (PCA, t-SNE)",
				"Perform clustering analysis (k-means, hierarchical)",
				"Identify subtype-specific gene signatures",
				"Validate clustering results",
				"Generate subtype-specific visualizations",
			];
			dataNeeded = ["Gene expression datasets with multiple samples"];
			expectedOutputs = [
				"Clustering results",
				"Subtype assignments",
				"Signature genes",
				"Visualization plots",
			];
		} else if (
			queryLower.includes("biomarker") ||
			queryLower.includes("signature")
		) {
			analysisType = "biomarker discovery analysis";
			steps = [
				"Load and preprocess gene expression data",
				"Perform quality control and normalization",
				"Apply feature selection methods",
				"Train machine learning models for classification",
				"Perform cross-validation and model evaluation",
				"Identify top biomarker candidates",
				"Generate biomarker validation plots",
			];
			dataNeeded = ["Gene expression datasets with clinical annotations"];
			expectedOutputs = [
				"Biomarker lists",
				"Model performance metrics",
				"Validation plots",
			];
		} else if (
			queryLower.includes("pathway") ||
			queryLower.includes("enrichment")
		) {
			analysisType = "pathway enrichment analysis";
			steps = [
				"Load gene expression or gene list data",
				"Perform differential expression analysis if needed",
				"Extract gene lists for enrichment analysis",
				"Perform pathway enrichment analysis (GO, KEGG)",
				"Apply statistical testing and multiple correction",
				"Generate enrichment plots and networks",
				"Create pathway analysis report",
			];
			dataNeeded = ["Gene expression data or gene lists"];
			expectedOutputs = [
				"Enrichment results",
				"Pathway plots",
				"Gene set analysis",
			];
		}

		return {
			userQuestion: query,
			requiredSteps: steps,
			dataNeeded: dataNeeded,
			expectedOutputs: expectedOutputs,
			analysisType,
			priority: "medium",
			estimatedTime: "variable",
			datasets,
		};
	}

	private async findRequiredData(
		understanding: AnalysisUnderstanding
	): Promise<Dataset[]> {
		if (understanding.dataNeeded.length === 0) {
			return [];
		}

		const datasets = [];

		// Search for specific datasets mentioned
		for (const dataItem of understanding.dataNeeded) {
			if (dataItem.match(/GSE\d+/)) {
				// This is a specific GEO dataset
				datasets.push({
					id: dataItem,
					title: `Dataset ${dataItem}`,
					source: "GEO",
					organism: "unknown",
					samples: 0,
					platform: "unknown",
					description: `Dataset ${dataItem} required for analysis`,
					url: `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${dataItem}`,
				});
			}
		}

		// If no specific datasets, search for relevant ones
		if (datasets.length === 0) {
			try {
				this.updateStatus("Searching for relevant datasets...");

				console.log(
					"Searching for datasets with query:",
					understanding.userQuestion
				);

				// Use the backend client to search for datasets
				const searchResponse = await this.backendClient.searchDatasets({
					query: understanding.userQuestion,
					limit: 10,
					organism: "Homo sapiens", // Default to human data
				});

				console.log("Search response:", {
					datasetsFound: searchResponse.length,
				});

				// Convert backend dataset format to our format
				for (const dataset of searchResponse.slice(0, 5)) {
					datasets.push({
						id: dataset.id,
						title: dataset.title,
						source: "GEO",
						organism: dataset.organism || "Unknown",
						samples: 0,
						platform: "Unknown",
						description: dataset.description || "",
						url:
							dataset.url ||
							`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${dataset.id}`,
					});
				}
			} catch (error) {
				console.error("Error searching for datasets:", error);
				this.updateStatus(
					"No specific datasets found, will use general data sources"
				);
			}
		}

		return datasets;
	}

	private async createWorkspace(
		query: string,
		currentWorkspace?: string
	): Promise<string> {
		const timestamp = new Date()
			.toISOString()
			.slice(0, 19)
			.replace(/[:-]/g, "");
		const safeName = query
			.replace(/[^a-zA-Z0-9\s]/g, "")
			.replace(/\s+/g, "_")
			.substring(0, 30);
		const dirName = `${safeName}_${timestamp}`;
		// Use the provided workspace path or fallback to /tmp
		const workspacePath = currentWorkspace || "/tmp";
		const fullPath = `${workspacePath}/workspaces/${dirName}`;

		console.log("AnalysisPlanner: Creating workspace:", {
			dirName,
			fullPath,
		});

		const directories = [
			fullPath,
			`${fullPath}/data`,
			`${fullPath}/results`,
			`${fullPath}/figures`,
		];

		for (const dir of directories) {
			try {
				await window.electronAPI.createDirectory(dir);
				console.log("AnalysisPlanner: Created directory:", dir);
			} catch (error) {
				console.warn(`Could not create directory ${dir}:`, error);
			}
		}

		console.log("AnalysisPlanner: Workspace created successfully:", fullPath);
		return fullPath;
	}

	async createAnalysisWorkspace(
		query: string,
		currentWorkspace?: string
	): Promise<string> {
		const workspaceDir = await this.createWorkspace(query, currentWorkspace);

		// Create virtual environment in the workspace
		this.updateStatus("Setting up virtual environment...");
		try {
			const venvResult = await window.electronAPI.createVirtualEnv(
				workspaceDir
			);
			if (venvResult.success) {
				console.log("Virtual environment created successfully:", venvResult);
				this.updateStatus("Virtual environment ready!");
			} else {
				console.warn("Failed to create virtual environment:", venvResult.error);
				this.updateStatus(
					"Warning: Using system Python (virtual environment creation failed)"
				);
			}
		} catch (error) {
			console.error("Error creating virtual environment:", error);
			this.updateStatus(
				"Warning: Using system Python (virtual environment creation failed)"
			);
		}

		return workspaceDir;
	}
}
