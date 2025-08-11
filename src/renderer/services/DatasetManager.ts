import { Dataset, DataTypeAnalysis } from "./types";
import { ElectronClient } from "../utils/ElectronClient";

export interface FileAnalysis {
	dataType: string;
	format: string;
}

export class DatasetManager {
	private statusCallback?: (status: string) => void;

	constructor() {
		// No dependencies
	}

	setStatusCallback(callback: (status: string) => void) {
		this.statusCallback = callback;
	}

	private updateStatus(message: string) {
		if (this.statusCallback) {
			this.statusCallback(message);
		}
	}

	/**
	 * Simple method to extract data types from datasets
	 */
	async analyzeDataTypes(datasets: Dataset[]): Promise<string[]> {
		const dataTypes: string[] = [];

		for (const dataset of datasets) {
			if (dataset.dataType) {
				dataTypes.push(dataset.dataType);
			} else {
				// Infer from metadata
				const inferredType = this.inferDataTypeFromMetadata(dataset);
				dataTypes.push(inferredType);
			}
		}

		// Remove duplicates
		return Array.from(new Set(dataTypes));
	}

	// Removed duplicate updateStatus method

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
				dataComplexity: "moderate" as const,
				suggestedApproach: "standard analysis pipeline",
				estimatedCells: detectedDataTypes.length * 3,
			};
		} catch (error) {
			console.error("Error analyzing data types:", error);
			// Fallback to basic tools
			return {
				dataTypes: ["unknown"],
				recommendedTools: ["pandas", "numpy", "matplotlib"],
				analysisApproaches: ["basic_analysis"],
				dataComplexity: "simple" as const,
				suggestedApproach: "basic data exploration",
				estimatedCells: 5,
			};
		}
	}

	async findDatasetFiles(
		dataset: Dataset,
		workspaceDir: string
	): Promise<string[]> {
		try {
			// If dataset directly references a local path, honor it
			if ((dataset as any).localPath) {
				return [(dataset as any).localPath as string];
			}

			// Otherwise search the workspace directory heuristically
			const files = await ElectronClient.listDirectory(workspaceDir);
			const normalizedTitle = (dataset.title || "")
				.toLowerCase()
				.replace(/\s+/g, "_");
			return files
				.filter((file) => !file.isDirectory)
				.map((file) => file.path)
				.filter((filePath: string) => {
					const lc = filePath.toLowerCase();
					return (
						(!!dataset.id && lc.includes(dataset.id.toLowerCase())) ||
						(!!normalizedTitle && lc.includes(normalizedTitle))
					);
				});
		} catch (error) {
			console.error("Error finding dataset files:", error);
			return [];
		}
	}

	async analyzeFileType(filePath: string): Promise<FileAnalysis> {
		try {
			// For large/binary files, avoid reading whole content unnecessarily
			let content = "";
			try {
				content = await ElectronClient.readFile(filePath);
			} catch (_) {
				// If cannot read as text, continue with extension-based detection
			}
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
			else if (filePath.endsWith(".mtx"))
				format = "mtx"; // Matrix market format
			else if (filePath.endsWith(".h5") || filePath.endsWith(".hdf5"))
				format = "h5";
			else if (filePath.endsWith(".loom")) format = "loom";

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
			} else if (format === "h5" || format === "loom") {
				dataType = "single_cell_expression";
			}

			return { dataType, format };
		} catch (error) {
			console.error("Error analyzing file type:", error);
			return { dataType: "unknown", format: "unknown" };
		}
	}

	inferDataTypeFromMetadata(dataset: Dataset): string {
		const title = dataset.title.toLowerCase();
		const description = (dataset.description || "").toLowerCase();
		const platform = (dataset.platform || "").toLowerCase();

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
	): Promise<{ steps: { description: string; prerequisites?: string[] }[] }> {
		const steps: { description: string; prerequisites?: string[] }[] = [];

		// Generate steps based on the primary data type
		const primaryDataType = dataAnalysis.dataTypes[0] || "unknown";

		switch (primaryDataType) {
			case "single_cell_expression":
				steps.push({ description: "Perform quality control and filtering" });
				steps.push({ description: "Normalize and scale the data" });
				steps.push({ description: "Identify highly variable genes" });
				steps.push({
					description: "Perform dimensionality reduction (PCA and UMAP)",
				});
				steps.push({ description: "Cluster cells to identify populations" });
				steps.push({
					description: "Find marker genes for each cluster",
				});
				break;

			case "expression_matrix":
				steps.push({ description: "Perform quality control" });
				steps.push({ description: "Normalize the data" });
				steps.push({ description: "Perform differential expression analysis" });
				steps.push({
					description: "Visualize results with heatmaps and volcano plots",
				});
				break;

			default:
				steps.push({ description: "Load and explore the data" });
				steps.push({ description: "Perform basic statistical analysis" });
				steps.push({ description: "Generate visualizations" });
				break;
		}

		return { steps };
	}
}
