import { BackendClient } from "./BackendClient";
import { DataTypeAnalysis } from "./DatasetManager";
import { StatusManager } from "./StatusManager";

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
	private statusManager: StatusManager;

	constructor(backendClient: BackendClient) {
		this.backendClient = backendClient;
		this.statusManager = StatusManager.getInstance();
	}

	setStatusCallback(callback: (status: string) => void) {
		// Convert string callback to StatusUpdate callback
		this.statusManager.setStatusCallback((statusUpdate) => {
			callback(statusUpdate.message);
		});
	}

	private updateStatus(message: string) {
		this.statusManager.updateStatus(message);
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

		// Step 3: Create workspace with virtual environment
		this.updateStatus("Setting up workspace...");
		const workingDirectory = await this.createAnalysisWorkspace(query);

		this.updateStatus("Analysis plan created successfully!");

		return {
			understanding,
			datasets: foundDatasets,
			workingDirectory,
		};
	}

	async createAnalysisPlanWithData(
		query: string,
		downloadedDatasets: Dataset[],
		currentWorkspace?: string
	): Promise<AnalysisPlan> {
		this.updateStatus("Analyzing your research question...");

		console.log(
			"AnalysisPlanner: createAnalysisPlanWithData called with currentWorkspace =",
			currentWorkspace
		);

		// Step 1: Analyze the user question with existing data
		const understanding = await this.analyzeUserQuestion(
			query,
			downloadedDatasets
		);

		// Step 2: Create workspace with virtual environment (use current workspace if provided)
		const workingDirectory = await this.createAnalysisWorkspace(
			query,
			currentWorkspace
		);

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
			const result = await this.backendClient.generatePlan({
				question: question,
				context: `Research question: ${question}`,
				current_state: {
					datasets_available: datasets?.length || 0,
					datasets: datasets?.map((d) => ({ id: d.id, title: d.title })) || [],
				},
			});

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

	async generateDataTypeSpecificPlan(
		userQuestion: string,
		dataAnalysis: DataTypeAnalysis,
		datasets: Dataset[]
	): Promise<{
		steps: Array<{ description: string; prerequisites?: string[] }>;
	}> {
		const steps: Array<{ description: string; prerequisites?: string[] }> = [];

		// Add data loading step
		steps.push({
			description:
				"Load and preprocess datasets with data type-specific handling",
		});

		// Add data type specific steps
		for (const dataType of dataAnalysis.dataTypes) {
			switch (dataType) {
				case "single_cell_expression":
					steps.push(
						{
							description: "Load single-cell data and perform quality control",
						},
						{ description: "Normalize and scale single-cell expression data" },
						{
							description:
								"Perform feature selection and dimensionality reduction",
						},
						{ description: "Cluster cells and identify cell types" },
						{
							description:
								"Perform differential expression analysis between clusters",
						},
						{
							description:
								"Create single-cell visualizations (UMAP, t-SNE, heatmaps)",
						},
						{
							description:
								"Annotate cell types and perform trajectory analysis",
						}
					);
					break;

				case "expression_matrix":
					steps.push(
						{ description: "Perform quality control on expression data" },
						{ description: "Normalize expression data" },
						{ description: "Perform differential expression analysis" },
						{ description: "Create expression heatmaps and visualizations" }
					);
					break;

				case "clinical_data":
					steps.push(
						{ description: "Clean and validate clinical data" },
						{
							description: "Perform statistical analysis on clinical variables",
						},
						{ description: "Create clinical data visualizations" }
					);
					break;

				case "sequence_data":
					steps.push(
						{ description: "Perform sequence quality control" },
						{ description: "Analyze sequence characteristics" },
						{ description: "Create sequence analysis visualizations" }
					);
					break;

				case "variant_data":
					steps.push(
						{ description: "Load and validate variant data" },
						{ description: "Perform variant frequency analysis" },
						{ description: "Create variant annotation and visualization" }
					);
					break;

				case "metadata":
					steps.push(
						{ description: "Analyze metadata quality and completeness" },
						{ description: "Create metadata summary and visualizations" }
					);
					break;
			}
		}

		// Add integration steps if multiple data types
		if (dataAnalysis.dataTypes.length > 1) {
			steps.push({
				description: "Integrate and correlate multiple data types",
				prerequisites: ["step_1", "step_2"], // Depends on previous steps
			});
		}

		// Add final analysis step
		steps.push({
			description: "Generate comprehensive analysis report and insights",
			prerequisites: steps.map((_, i) => `step_${i + 1}`),
		});

		return { steps };
	}

	private async createWorkspace(
		query: string,
		currentWorkspace?: string
	): Promise<string> {
		console.log(
			"AnalysisPlanner: createWorkspace called with currentWorkspace =",
			currentWorkspace
		);

		// If currentWorkspace is provided, create a question-specific folder within it
		if (currentWorkspace) {
			// Create a safe folder name from the query
			const timestamp = new Date()
				.toISOString()
				.slice(0, 19)
				.replace(/[:-]/g, "");
			const safeName = query
				.replace(/[^a-zA-Z0-9\s]/g, "")
				.replace(/\s+/g, "_")
				.substring(0, 30);
			const questionFolderName = `${safeName}_${timestamp}`;
			const questionFolderPath = `${currentWorkspace}/${questionFolderName}`;

			console.log(
				"AnalysisPlanner: Creating question folder:",
				questionFolderPath
			);

			// Create the question-specific folder and its subdirectories
			const directories = [
				questionFolderPath,
				`${questionFolderPath}/data`,
				`${questionFolderPath}/results`,
				`${questionFolderPath}/figures`,
			];

			for (const dir of directories) {
				try {
					await window.electronAPI.createDirectory(dir);
					console.log("AnalysisPlanner: Created directory:", dir);
				} catch (error) {
					console.error(`Failed to create directory ${dir}:`, error);
					throw new Error(`Failed to create workspace directory: ${dir}`);
				}
			}

			console.log(
				"AnalysisPlanner: Question folder created:",
				questionFolderPath
			);
			return questionFolderPath;
		}

		// This should never happen if users are required to select a workspace
		throw new Error("No workspace is currently open. Please select a workspace first.");
	}

	async createAnalysisWorkspace(
		query: string,
		currentWorkspace?: string
	): Promise<string> {
		// Validate current workspace if provided
		if (currentWorkspace) {
			const workspaceExists = await window.electronAPI.directoryExists(currentWorkspace);
			if (!workspaceExists) {
				throw new Error(`Workspace directory does not exist: ${currentWorkspace}`);
			}
		}

		const workspaceDir = await this.createWorkspace(query, currentWorkspace);

		// Validate that the workspace was created successfully
		const workspaceDirExists = await window.electronAPI.directoryExists(workspaceDir);
		if (!workspaceDirExists) {
			throw new Error(`Failed to create workspace directory: ${workspaceDir}`);
		}

		// Create virtual environment in the workspace
		this.updateStatus("Setting up virtual environment...");
		try {
			const venvResult = await window.electronAPI.createVirtualEnv(
				workspaceDir
			);
			if (venvResult.success) {
				console.log("Virtual environment created successfully:", venvResult);
				this.updateStatus("Virtual environment ready!");
				
				// Store kernel name in workspace metadata
				if (venvResult.kernelName) {
					await this.storeWorkspaceMetadata(workspaceDir, {
						kernelName: venvResult.kernelName,
						pythonPath: venvResult.pythonPath,
						venvPath: venvResult.venvPath,
						createdAt: new Date().toISOString()
					});
				}
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

	/**
	 * Store workspace metadata like kernel name
	 */
	private async storeWorkspaceMetadata(workspaceDir: string, metadata: any): Promise<void> {
		try {
			const metadataPath = `${workspaceDir}/.axon-metadata.json`;
			await window.electronAPI.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
			console.log("Workspace metadata stored:", metadata);
		} catch (error) {
			console.warn("Failed to store workspace metadata:", error);
		}
	}

	/**
	 * Get workspace metadata like kernel name
	 */
	static async getWorkspaceMetadata(workspaceDir: string): Promise<any> {
		try {
			const metadataPath = `${workspaceDir}/.axon-metadata.json`;
			const metadataContent = await window.electronAPI.readFile(metadataPath);
			return JSON.parse(metadataContent);
		} catch (error) {
			console.warn("Failed to read workspace metadata:", error);
			return null;
		}
	}
}
