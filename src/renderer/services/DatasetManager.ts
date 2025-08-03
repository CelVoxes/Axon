import { Dataset } from "./AnalysisPlanner";

export interface DataTypeAnalysis {
	dataTypes: string[];
	recommendedTools: string[];
	analysisApproaches: string[];
}

export interface FileAnalysis {
	dataType: string;
	format: string;
}

export class DatasetManager {
	private statusCallback?: (status: string) => void;

	constructor() {}

	setStatusCallback(callback: (status: string) => void) {
		this.statusCallback = callback;
	}

	private updateStatus(message: string) {
		if (this.statusCallback) {
			this.statusCallback(message);
		}
	}

	async analyzeDataTypesAndSelectTools(
		datasets: Dataset[],
		workspaceDir: string
	): Promise<DataTypeAnalysis> {
		this.updateStatus(
			"Analyzing data types and selecting appropriate tools..."
		);

		try {
			// First, try to detect data types from actual files if they exist
			const detectedDataTypes: string[] = [];
			const detectedFormats: string[] = [];

			for (const dataset of datasets) {
				// Check if files exist in workspace
				const datasetFiles = await this.findDatasetFiles(dataset, workspaceDir);

				if (datasetFiles.length > 0) {
					// Analyze actual files to determine data type
					const fileAnalysis = await this.analyzeFileType(datasetFiles[0]);
					detectedDataTypes.push(fileAnalysis.dataType);
					detectedFormats.push(fileAnalysis.format);
				} else {
					// Fall back to metadata-based detection
					detectedDataTypes.push(
						dataset.dataType || this.inferDataTypeFromMetadata(dataset)
					);
					detectedFormats.push(dataset.fileFormat || "unknown");
				}
			}

			// Get tool recommendations based on detected data types
			const toolRecommendations = await this.getToolRecommendations(
				detectedDataTypes,
				detectedFormats
			);

			return {
				dataTypes: detectedDataTypes,
				recommendedTools: toolRecommendations.tools,
				analysisApproaches: toolRecommendations.approaches,
			};
		} catch (error) {
			console.error("Error analyzing data types:", error);
			// Fallback to basic tools
			return {
				dataTypes: ["unknown"],
				recommendedTools: ["pandas", "numpy", "matplotlib"],
				analysisApproaches: ["basic_analysis"],
			};
		}
	}

	async findDatasetFiles(
		dataset: Dataset,
		workspaceDir: string
	): Promise<string[]> {
		try {
			// Use listDirectory to get files
			const files = await window.electronAPI.listDirectory(workspaceDir);
			return files
				.filter((file) => !file.isDirectory)
				.map((file) => file.path)
				.filter(
					(filePath: string) =>
						filePath.toLowerCase().includes(dataset.id.toLowerCase()) ||
						filePath
							.toLowerCase()
							.includes(dataset.title.toLowerCase().replace(/\s+/g, "_"))
				);
		} catch (error) {
			console.error("Error finding dataset files:", error);
			return [];
		}
	}

	async analyzeFileType(filePath: string): Promise<FileAnalysis> {
		try {
			const content = await window.electronAPI.readFile(filePath);
			const lines = content.split("\n").slice(0, 10); // Check first 10 lines

			// Detect format
			let format = "unknown";
			if (filePath.endsWith(".csv")) format = "csv";
			else if (filePath.endsWith(".tsv") || filePath.endsWith(".txt"))
				format = "tsv";
			else if (filePath.endsWith(".fastq") || filePath.endsWith(".fq"))
				format = "fastq";
			else if (filePath.endsWith(".bam")) format = "bam";
			else if (filePath.endsWith(".vcf")) format = "vcf";
			else if (filePath.endsWith(".h5ad"))
				format = "h5ad"; // AnnData format for single-cell
			else if (filePath.endsWith(".mtx")) format = "mtx"; // Matrix market format

			// Detect data type based on content patterns
			let dataType = "unknown";

			if (format === "csv" || format === "tsv") {
				const delimiter = format === "csv" ? "," : "\t";
				const header = lines[0]?.split(delimiter) || [];

				// Check for single-cell expression patterns
				if (
					header.some((col) => col.toLowerCase().includes("cell")) &&
					header.some((col) => col.toLowerCase().includes("gene"))
				) {
					dataType = "single_cell_expression";
				}
				// Check for bulk expression matrix patterns
				else if (
					header.some((col) => col.toLowerCase().includes("gene")) &&
					header.some((col) => col.toLowerCase().includes("sample"))
				) {
					dataType = "expression_matrix";
				}
				// Check for clinical data patterns
				else if (
					header.some((col) => col.toLowerCase().includes("patient")) ||
					header.some((col) => col.toLowerCase().includes("clinical"))
				) {
					dataType = "clinical_data";
				}
				// Check for metadata patterns
				else if (
					header.some((col) => col.toLowerCase().includes("metadata")) ||
					header.some((col) => col.toLowerCase().includes("info"))
				) {
					dataType = "metadata";
				}
			} else if (format === "h5ad") {
				dataType = "single_cell_expression"; // AnnData is primarily for single-cell
			} else if (format === "mtx") {
				// Check if it's likely single-cell based on file size and patterns
				if (content.length > 1000000) {
					// Large matrix files are often single-cell
					dataType = "single_cell_expression";
				} else {
					dataType = "expression_matrix";
				}
			} else if (format === "fastq") {
				dataType = "sequence_data";
			} else if (format === "bam") {
				dataType = "alignment_data";
			} else if (format === "vcf") {
				dataType = "variant_data";
			}

			return { dataType, format };
		} catch (error) {
			console.error("Error analyzing file type:", error);
			return { dataType: "unknown", format: "unknown" };
		}
	}

	inferDataTypeFromMetadata(dataset: Dataset): string {
		const title = dataset.title.toLowerCase();
		const description = dataset.description.toLowerCase();
		const platform = dataset.platform.toLowerCase();

		// Check for single-cell data first (more specific)
		if (
			title.includes("single-cell") ||
			title.includes("single cell") ||
			title.includes("scrnaseq") ||
			title.includes("sc-rna-seq") ||
			description.includes("single-cell") ||
			description.includes("single cell") ||
			description.includes("scrnaseq") ||
			description.includes("sc-rna-seq") ||
			platform.includes("10x") ||
			platform.includes("dropseq") ||
			platform.includes("smart-seq")
		) {
			return "single_cell_expression";
		}

		if (
			title.includes("expression") ||
			title.includes("rna-seq") ||
			platform.includes("microarray")
		) {
			return "expression_matrix";
		}
		if (title.includes("clinical") || title.includes("patient")) {
			return "clinical_data";
		}
		if (
			title.includes("sequence") ||
			title.includes("fastq") ||
			title.includes("bam")
		) {
			return "sequence_data";
		}
		if (title.includes("variant") || title.includes("vcf")) {
			return "variant_data";
		}
		if (title.includes("metadata") || title.includes("info")) {
			return "metadata";
		}

		return "unknown";
	}

	async getToolRecommendations(
		dataTypes: string[],
		formats: string[]
	): Promise<{ tools: string[]; approaches: string[] }> {
		const tools = new Set<string>();
		const approaches = new Set<string>();

		for (const dataType of dataTypes) {
			switch (dataType) {
				case "single_cell_expression":
					// Primary single-cell analysis tools
					tools.add("scanpy");
					tools.add("anndata");
					tools.add("pandas");
					tools.add("numpy");
					tools.add("scipy");
					tools.add("matplotlib");
					tools.add("seaborn");
					tools.add("plotly");
					tools.add("leidenalg"); // For clustering
					tools.add("umap-learn"); // For dimensionality reduction
					tools.add("scikit-learn");
					approaches.add("single_cell_quality_control");
					approaches.add("normalization");
					approaches.add("feature_selection");
					approaches.add("dimensionality_reduction");
					approaches.add("clustering");
					approaches.add("differential_expression");
					approaches.add("trajectory_analysis");
					approaches.add("cell_type_annotation");
					break;

				case "expression_matrix":
					tools.add("pandas");
					tools.add("numpy");
					tools.add("scipy");
					tools.add("scikit-learn");
					tools.add("matplotlib");
					tools.add("seaborn");
					tools.add("plotly");
					approaches.add("differential_expression");
					approaches.add("clustering");
					approaches.add("pca");
					approaches.add("correlation_analysis");
					break;

				case "clinical_data":
					tools.add("pandas");
					tools.add("numpy");
					tools.add("scipy");
					tools.add("scikit-learn");
					tools.add("matplotlib");
					tools.add("seaborn");
					tools.add("statsmodels");
					approaches.add("statistical_analysis");
					approaches.add("survival_analysis");
					approaches.add("correlation_analysis");
					break;

				case "sequence_data":
					tools.add("pandas");
					tools.add("numpy");
					tools.add("biopython");
					tools.add("matplotlib");
					tools.add("seaborn");
					approaches.add("sequence_analysis");
					approaches.add("quality_control");
					approaches.add("alignment_analysis");
					break;

				case "variant_data":
					tools.add("pandas");
					tools.add("numpy");
					tools.add("matplotlib");
					tools.add("seaborn");
					tools.add("pysam");
					approaches.add("variant_analysis");
					approaches.add("frequency_analysis");
					approaches.add("annotation_analysis");
					break;

				case "metadata":
					tools.add("pandas");
					tools.add("numpy");
					tools.add("matplotlib");
					tools.add("seaborn");
					approaches.add("metadata_analysis");
					approaches.add("quality_control");
					break;

				default:
					tools.add("pandas");
					tools.add("numpy");
					tools.add("matplotlib");
					approaches.add("basic_analysis");
			}
		}

		return {
			tools: Array.from(tools),
			approaches: Array.from(approaches),
		};
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
}
