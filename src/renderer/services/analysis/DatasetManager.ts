import { Dataset, DataTypeAnalysis } from "../types";
import { FilesystemAdapter } from "../../utils/fs/FilesystemAdapter";
import { DefaultFilesystemAdapter } from "../../utils/fs/DefaultFilesystemAdapter";

export interface FileAnalysis {
	dataType: string;
	format: string;
}

export class DatasetManager {
    private fs: FilesystemAdapter;
	private statusCallback?: (status: string) => void;

    constructor(fsAdapter?: FilesystemAdapter) {
        this.fs = fsAdapter ?? new DefaultFilesystemAdapter();
    }

    /**
     * Scan a workspace for local data files/directories and infer dataset entries.
     * - Recognizes common directory-based formats (e.g., 10x MTX with matrix.mtx)
     * - Peeks into CSV/TSV headers to infer data types
     * - Checks top-level and a "data" subdirectory (one level deep)
     */
    async scanWorkspaceForData(workspaceDir: string): Promise<Dataset[]> {
        const results: Dataset[] = [];
        const seen = new Set<string>();

        const addDataset = (d: Dataset) => {
            if (!seen.has(d.localPath || d.id)) {
                results.push(d);
                seen.add(d.localPath || d.id);
            }
        };

        const safeListDir = async (dir: string) => {
            try {
                return await this.fs.listDirectory(dir);
            } catch (_) {
                return [] as any[];
            }
        };

        const inspectDirectory = async (dirPath: string) => {
            const entries = await safeListDir(dirPath);
            const names = entries.map((e: any) => e.name.toLowerCase());

            // 10x-style markers
            const hasMtx = names.includes("matrix.mtx") || names.includes("matrix.mtx.gz");
            const hasFeatures = names.includes("features.tsv") || names.includes("genes.tsv");
            const hasBarcodes = names.includes("barcodes.tsv") || names.includes("barcodes.tsv.gz");
            if (hasMtx && (hasFeatures || hasBarcodes)) {
                const base = dirPath.split(/[\\/]/).pop() || dirPath;
                addDataset({
                    id: `local-${Math.abs(this.simpleHash(dirPath))}`,
                    title: base,
                    source: "Local",
                    description: "Detected 10x-style matrix directory",
                    platform: "10x",
                    dataType: "single_cell_expression",
                    fileFormat: "10x_mtx",
                    localPath: dirPath,
                    isLocalDirectory: true,
                });
                return; // already classified
            }

            // Detect presence of FCS and spectral metadata (spillover/unmixing) files
            const hasFCS = entries.some((e: any) => !e.isDirectory && /\.fcs(\.gz)?$/i.test(e.name));
            const hasSpectralMeta = entries.some(
                (e: any) => !e.isDirectory && /\b(spill|spillover|unmix|unmixing)\b/i.test(e.name) && /\.(csv|tsv|txt)$/i.test(e.name)
            );
            if (hasFCS) {
                const base = dirPath.split(/[\\/]/).pop() || dirPath;
                addDataset({
                    id: `local-${Math.abs(this.simpleHash(dirPath))}`,
                    title: base,
                    source: "Local",
                    description: hasSpectralMeta
                        ? "Detected spectral flow cytometry folder (FCS + spill/unmix matrix)"
                        : "Detected flow cytometry FCS folder",
                    platform: hasSpectralMeta ? "Spectral Flow Cytometry" : "Flow Cytometry",
                    dataType: hasSpectralMeta ? "spectral_flow_cytometry" : "flow_cytometry",
                    fileFormat: "fcs_bundle",
                    localPath: dirPath,
                    isLocalDirectory: true,
                });
                return;
            }

            // Heuristic: directory with multiple CSV/TSV files -> inspect first header for flow cytometry patterns
            const delimited = entries.filter((e: any) => !e.isDirectory && /\.(csv|tsv|txt)$/i.test(e.name));
            if (delimited.length >= 2) {
                try {
                    const first = delimited[0].path;
                    const content = await this.fs.readFile(first).catch(() => "");
                    const head = (content || "").split(/\n/)[0] || "";
                    if (head) {
                        const isTsv = /\.(tsv|txt)$/i.test(first) || (!/,/.test(head) && /\t/.test(head));
                        const delim = isTsv ? "\t" : ",";
                        const cols = head.split(delim).map((c: string) => c.trim());
                        const lower = cols.map((c: string) => c.toLowerCase());
                        const hasFSC = lower.some((c) => c.startsWith("fsc"));
                        const hasSSC = lower.some((c) => c.startsWith("ssc"));
                        const hasCD = cols.some((c: string) => /\bcd\d+/i.test(c));
                        const hasFluor = cols.some((c: string) => /(fitc|pe|apc|percp|bv\d{2,3}|af\d{2,3}|a[0-9]{2,3}|b[0-9]{2,3})/i.test(c));
                        const flowLike = hasFSC || hasSSC || hasCD || hasFluor;
                        // Spectral metadata hint via filenames alongside CSVs
                        const hasSpectralSidecar = entries.some(
                            (e: any) => /\b(spill|spillover|unmix|unmixing)\b/i.test(e.name) && /\.(csv|tsv|txt)$/i.test(e.name)
                        );
                        if (flowLike || hasSpectralSidecar) {
                            const base = dirPath.split(/[\\/]/).pop() || dirPath;
                            addDataset({
                                id: `local-${Math.abs(this.simpleHash(dirPath))}`,
                                title: base,
                                source: "Local",
                                description: hasSpectralSidecar
                                    ? "Detected CSV bundle with spectral flow sidecar"
                                    : "Detected CSV bundle (flow cytometry-like)",
                                platform: hasSpectralSidecar ? "Spectral Flow Cytometry" : "Flow Cytometry",
                                dataType: hasSpectralSidecar ? "spectral_flow_cytometry" : "flow_cytometry",
                                fileFormat: "csv_bundle",
                                localPath: dirPath,
                                isLocalDirectory: true,
                            });
                            return;
                        }
                    }
                } catch (_) {
                    // ignore header errors
                }
                // Generic CSV bundle (unknown type)
                const base = dirPath.split(/[\\/]/).pop() || dirPath;
                addDataset({
                    id: `local-${Math.abs(this.simpleHash(dirPath))}`,
                    title: base,
                    source: "Local",
                    description: "Detected directory with multiple delimited files",
                    platform: "Local",
                    dataType: "unknown",
                    fileFormat: "csv_bundle",
                    localPath: dirPath,
                    isLocalDirectory: true,
                });
            }
        };

        const inspectFile = async (filePath: string) => {
            const base = filePath.split(/[\\/]/).pop() || filePath;
            const { dataType, format } = await this.analyzeFileType(filePath);
            addDataset({
                id: `local-${Math.abs(this.simpleHash(filePath))}`,
                title: base,
                source: "Local",
                description: "Local data file",
                dataType: dataType || undefined,
                fileFormat: format || undefined,
                localPath: filePath,
                isLocalDirectory: false,
            });
        };

        const considerEntry = async (entry: any) => {
            if (entry.isDirectory) {
                await inspectDirectory(entry.path);
            } else {
                const lower = entry.name.toLowerCase();
                if (
                    lower.endsWith(".h5ad") ||
                    lower.endsWith(".loom") ||
                    lower.endsWith(".mtx") ||
                    lower.endsWith(".csv") ||
                    lower.endsWith(".tsv") ||
                    lower.endsWith(".txt") ||
                    lower.endsWith(".h5") ||
                    lower.endsWith(".hdf5") ||
                    lower.endsWith(".fcs") ||
                    lower.endsWith(".fcs.gz") ||
                    lower.endsWith(".vcf") ||
                    lower.endsWith(".bam") ||
                    lower.endsWith(".fastq") ||
                    lower.endsWith(".fq")
                ) {
                    await inspectFile(entry.path);
                }
            }
        };

        // Top-level
        const top = await safeListDir(workspaceDir);
        for (const e of top) await considerEntry(e);

        // Common data subfolder
        const dataDir = `${workspaceDir}/data`;
        const dataEntries = await safeListDir(dataDir);
        for (const e of dataEntries) await considerEntry(e);

        // One more level: immediate subdirectories under data
        for (const e of dataEntries) {
            if (e.isDirectory) {
                const sub = await safeListDir(e.path);
                for (const s of sub) await considerEntry(s);
            }
        }

        return results;
    }

    private simpleHash(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0;
        }
        return hash;
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
                const p = (dataset as any).localPath as string;
                // If it's a directory, return signal for 10x-style folder rather than trying to read as file
                const info = await this.fs.getFileInfo(p).catch(
                        () => null as any
                );
                if (info && info.isDirectory) {
                    return [p];
                }
                return [p];
            }

			// Otherwise search the workspace directory heuristically
            const files = await this.fs.listDirectory(workspaceDir);
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
			// Detect directory-based 10x MTX structure early
            const info = await this.fs.getFileInfo(filePath).catch(
                () => null as any
            );
            if (info && info.isDirectory) {
                // Heuristics: matrix.mtx present -> MTX dataset
                const entries = await this.fs.listDirectory(filePath).catch(
                    () => []
                );
                const names = entries.map((e) => e.name.toLowerCase());
                if (names.includes("matrix.mtx") || names.includes("matrix.mtx.gz")) {
                    return { dataType: "single_cell_expression", format: "mtx" };
                }
                // Directory with FCS files and optional spectral metadata
                const hasFCS = entries.some((e: any) => !e.isDirectory && /\.fcs(\.gz)?$/i.test(e.name));
                const hasSpectralMeta = entries.some(
                    (e: any) => !e.isDirectory && /\b(spill|spillover|unmix|unmixing)\b/i.test(e.name) && /\.(csv|tsv|txt)$/i.test(e.name)
                );
                if (hasFCS) {
                    return {
                        dataType: hasSpectralMeta ? "spectral_flow_cytometry" : "flow_cytometry",
                        format: "fcs_bundle",
                    };
                }
                return { dataType: "unknown", format: "unknown" };
            }

			// For large/binary files, avoid reading whole content unnecessarily
			let content = "";
            try {
                content = await this.fs.readFile(filePath);
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
            else if (/\.fcs(\.gz)?$/i.test(filePath)) format = "fcs";

            // Detect data type based on content patterns
            let dataType = "unknown";

            if (format === "csv" || format === "tsv") {
                const delimiter = format === "csv" ? "," : "\t";
                const header = lines[0]?.split(delimiter) || [];

                // Flow cytometry-like: FSC/SSC/fluorochrome channel names or CD markers
                const headerLower = header.map((h) => h.toLowerCase());
                const hasFSC = headerLower.some((c) => c.startsWith("fsc"));
                const hasSSC = headerLower.some((c) => c.startsWith("ssc"));
                const hasCD = header.some((c) => /\bcd\d+/i.test(c));
                const hasFluor = header.some((c) => /(fitc|pe|apc|percp|bv\d{2,3}|af\d{2,3}|a[0-9]{2,3}|b[0-9]{2,3})/i.test(c));
                if (hasFSC || hasSSC || hasCD || hasFluor) {
                    dataType = "flow_cytometry";
                }
                // Otherwise fall through to other CSV heuristics

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
            } else if (format === "fcs") {
                // Default: flow cytometry; upgrade to spectral if filename hints present
                const lc = filePath.toLowerCase();
                const spectralHint = /\b(spectral|cytek|aurora|unmix|unmixed|spill|spillover)\b/.test(lc);
                dataType = spectralHint ? "spectral_flow_cytometry" : "flow_cytometry";
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

		// Spectral flow cytometry hints in metadata
		if (
			/\b(spectral|cytek|aurora|unmix|unmixing|spillover)\b/.test(title) ||
			/\b(spectral|cytek|aurora|unmix|unmixing|spillover)\b/.test(description)
		) {
			return "spectral_flow_cytometry";
		}

		// Conventional flow cytometry hints
		if (/\b(flow|cytometry|fcs)\b/.test(title) || /\b(flow|cytometry|fcs)\b/.test(description)) {
			return "flow_cytometry";
		}

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
                case "spectral_flow_cytometry":
                    // Spectral unmixing + cytometry pipeline with Scanpy for visualization
                    tools.add("pandas");
                    tools.add("numpy");
                    tools.add("scipy");
                    tools.add("scikit-learn");
                    tools.add("fcsparser"); // FCS IO
                    tools.add("umap-learn");
                    tools.add("matplotlib");
                    tools.add("seaborn");
                    // Optional: integrate with AnnData/Scanpy for downstream viz
                    tools.add("anndata");
                    tools.add("scanpy");
                    approaches.add("spectral_unmixing");
                    approaches.add("compensation");
                    approaches.add("quality_control");
                    approaches.add("dimensionality_reduction");
                    approaches.add("clustering");
                    approaches.add("visualization");
                    break;
                case "flow_cytometry":
                    tools.add("pandas");
                    tools.add("numpy");
                    tools.add("scikit-learn");
                    tools.add("umap-learn");
                    tools.add("matplotlib");
                    tools.add("seaborn");
                    tools.add("plotly");
                    approaches.add("dimensionality_reduction");
                    approaches.add("clustering");
                    approaches.add("visualization");
                    break;
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
            case "spectral_flow_cytometry":
                steps.push({ description: "List files; estimate events per file; write counts manifest" });
                steps.push({ description: "Sample across files to profile markers and detect scaling/compensation" });
                steps.push({ description: "Load spectral unmixing/spillover matrix (from CSV or FCS metadata)" });
                steps.push({ description: "Batch 1: load N files → apply unmix/compensation → persist cleaned parquet" });
                steps.push({ description: "Batch 2+: continue batch processing; append to manifest for resume" });
                steps.push({ description: "If raw: arcsinh(cofactor≈5); else respect existing scale" });
                steps.push({ description: "Standardize (skip if standardized); persist merged parquet" });
                steps.push({ description: "Export to AnnData (obs/var); save to results/" });
                steps.push({ description: "Neighbors + UMAP (fit on subset), then transform remaining in batches" });
                steps.push({ description: "Clustering (e.g., HDBSCAN/KMeans); save labels" });
                steps.push({ description: "Visualization: UMAP colored by clusters/sample" });
                break;
            case "flow_cytometry":
                steps.push({ description: "List files; estimate events per file; write counts manifest" });
                steps.push({ description: "Sample across files to profile markers and detect scaling/compensation" });
                steps.push({ description: "Batch-load files with sample labels; persist intermediate cleaned parquet" });
                steps.push({ description: "If raw: arcsinh(cofactor≈5); else respect existing scale" });
                steps.push({ description: "Standardize (skip if standardized); persist merged parquet" });
                steps.push({ description: "Neighbors + UMAP (fit on subset), then transform remaining in batches" });
                steps.push({ description: "Cluster (DBSCAN/HDBSCAN/KMeans) and save labels" });
                steps.push({ description: "Plot UMAP colored by clusters/sample" });
                break;
            case "single_cell_expression":
                steps.push({ description: "Perform quality control and filtering" });
                steps.push({ description: "Detect existing normalization/log transforms (log1p/CPM/TPM) and scaling; avoid double-normalization" });
                steps.push({ description: "If raw, normalize (library-size) and log1p; then scale" });
                steps.push({ description: "Identify highly variable genes" });
                steps.push({ description: "PCA (save embeddings), neighbors graph" });
                steps.push({ description: "UMAP (fit on subset), then transform remaining in batches" });
                steps.push({ description: "Cluster cells to identify populations" });
				steps.push({
					description: "Find marker genes for each cluster",
				});
				break;

			case "expression_matrix":
				steps.push({ description: "Perform quality control" });
				steps.push({ description: "Detect existing transformations (log, z-score) and units (TPM/CPM/FPKM); avoid double-transforming" });
                steps.push({ description: "If raw counts, normalize appropriately (e.g., CPM/TPM) and log-transform if needed" });
                steps.push({ description: "PCA (optional), then differential expression analysis (chunked by groups)" });
				steps.push({
					description: "Visualize results with heatmaps and volcano plots",
				});
				break;

			default:
				steps.push({ description: "Load and explore the data" });
				steps.push({ description: "Detect existing scaling/normalization (log/z-score/min-max) where applicable; avoid double-transforming" });
				steps.push({ description: "Perform basic statistical analysis" });
				steps.push({ description: "Generate visualizations" });
				break;
		}

		return { steps };
	}
}
