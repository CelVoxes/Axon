import path from "path";
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
    private fileAnalysisCache = new Map<string, FileAnalysis>();
    private datasetAnalysisCache = new Map<string, FileAnalysis>();

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

	private normalizeFsPath(p?: string | null): string | null {
		if (!p) return null;
		try {
			return path.normalize(p).replace(/\\/g, "/");
		} catch (_) {
			return p;
		}
	}

	private buildDatasetCacheKey(dataset: Dataset): string | null {
		const localPath = this.normalizeFsPath((dataset as any)?.localPath || null);
		if (localPath) return `path:${localPath}`;
		if (dataset.id) return `id:${dataset.id}`;
		if (dataset.title) return `title:${dataset.title}`;
		return null;
	}

	private recordDatasetAnalysis(
		cacheKey: string | null,
		analysis: FileAnalysis
	): FileAnalysis {
		if (cacheKey) this.datasetAnalysisCache.set(cacheKey, analysis);
		return analysis;
	}

	private recordFileAnalysis(
		pathKey: string | null,
		analysis: FileAnalysis
	): FileAnalysis {
		if (pathKey) this.fileAnalysisCache.set(pathKey, analysis);
		return analysis;
	}

	private inferAnalysisFromDatasetMetadata(dataset: Dataset): FileAnalysis | null {
		const dirMeta: any = (dataset as any)?.directory;
		const tenxMeta: any = dirMeta?.tenx;
		const contains: string[] = Array.isArray(dirMeta?.contains)
			? dirMeta.contains.map((c: any) => String(c || "").toLowerCase())
			: [];
		if (
			tenxMeta &&
			(tenxMeta.matrix_mtx || tenxMeta.features_genes || tenxMeta.barcodes)
		) {
			return { dataType: "single_cell_expression", format: "10x_mtx" };
		}
		if (
			contains.includes("matrix.mtx") ||
			contains.includes("matrix.mtx.gz") ||
			contains.includes("barcodes.tsv") ||
			contains.includes("features.tsv") ||
			contains.includes("genes.tsv")
		) {
			return { dataType: "single_cell_expression", format: "10x_mtx" };
		}

		const delimited = (dataset as any)?.delimited;
		if (delimited?.flow_like) {
			return { dataType: "flow_cytometry", format: "csv_bundle" };
		}
		if (delimited?.count >= 2 && delimited?.examples?.some?.((name: string) =>
			/\.fcs(\.gz)?$/i.test(name)
		)) {
			return { dataType: "flow_cytometry", format: "fcs_bundle" };
		}

		const url = String((dataset as any)?.url || "").toLowerCase();
		if (url.endsWith(".h5ad")) {
			return { dataType: "single_cell_expression", format: "h5ad" };
		}
		if (url.endsWith(".loom")) {
			return { dataType: "single_cell_expression", format: "loom" };
		}
		if (url.endsWith(".mtx")) {
			return { dataType: "single_cell_expression", format: "mtx" };
		}

		return null;
	}

	private detectFormatFromExtension(filePath: string): string {
		const lc = filePath.toLowerCase();
		if (lc.endsWith(".csv")) return "csv";
		if (lc.endsWith(".tsv") || lc.endsWith(".txt")) return "tsv";
		if (lc.endsWith(".fastq") || lc.endsWith(".fq")) return "fastq";
		if (lc.endsWith(".bam")) return "bam";
		if (lc.endsWith(".vcf")) return "vcf";
		if (lc.endsWith(".h5ad")) return "h5ad";
		if (lc.endsWith(".mtx") || lc.endsWith(".mtx.gz")) return "mtx";
		if (lc.endsWith(".h5") || lc.endsWith(".hdf5")) return "h5";
		if (lc.endsWith(".loom")) return "loom";
		if (/\.fcs(\.gz)?$/i.test(lc)) return "fcs";
		return "unknown";
	}

	private dataTypeFromExtension(format: string, filePath: string): string | null {
		switch (format) {
			case "h5ad":
			case "loom":
				return "single_cell_expression";
			case "mtx":
				return "single_cell_expression";
			case "fcs": {
				const spectralHint = /\b(spectral|cytek|aurora|unmix|unmixed|spill|spillover)\b/.test(
					filePath.toLowerCase()
				);
				return spectralHint ? "spectral_flow_cytometry" : "flow_cytometry";
			}
			case "fastq":
				return "sequence_data";
			case "bam":
				return "alignment_data";
			case "vcf":
				return "variant_data";
		}
		return null;
	}

	private shouldReadFileHead(
		info: { size?: number } | null,
		format: string
	): boolean {
		if (format !== "csv" && format !== "tsv" && format !== "unknown") {
			return false;
		}
		if (!info || typeof info.size !== "number") {
			return true;
		}
		return info.size <= 512_000; // 500 KB guardrail
	}

	private detectDataTypeFromCsvHeader(header: string[]): string {
		const headerLower = header.map((h) => h.toLowerCase());
		const hasFSC = headerLower.some((c) => c.startsWith("fsc"));
		const hasSSC = headerLower.some((c) => c.startsWith("ssc"));
		const hasCD = header.some((c) => /\bcd\d+/i.test(c));
		const hasFluor = header.some((c) =>
			/(fitc|pe|apc|percp|bv\d{2,3}|af\d{2,3}|a[0-9]{2,3}|b[0-9]{2,3})/i.test(c)
		);
		if (hasFSC || hasSSC || hasCD || hasFluor) {
			return "flow_cytometry";
		}
		if (
			headerLower.some((col) => col.includes("cell")) &&
			headerLower.some((col) => col.includes("gene"))
		) {
			return "single_cell_expression";
		}
		if (
			headerLower.some((col) => col.includes("gene")) &&
			headerLower.some((col) => col.includes("sample"))
		) {
			return "expression_matrix";
		}
		if (
			headerLower.some((col) => col.includes("patient")) ||
			headerLower.some((col) => col.includes("clinical"))
		) {
			return "clinical_data";
		}
		if (
			headerLower.some((col) => col.includes("metadata")) ||
			headerLower.some((col) => col.includes("info"))
		) {
			return "metadata";
		}
		return "unknown";
	}

	private detectDataTypeFromContent(
		lines: string[],
		format: string
	): string {
		if (format === "csv" || format === "tsv") {
			const delimiter = format === "csv" ? "," : "\t";
			const header = lines[0]?.split(delimiter) || [];
			if (header.length) {
				return this.detectDataTypeFromCsvHeader(header);
			}
		}
		if (format === "unknown" && lines.length) {
			const firstLine = lines[0] || "";
			if (firstLine.includes(",")) {
				return this.detectDataTypeFromCsvHeader(firstLine.split(","));
			}
			if (firstLine.includes("\t")) {
				return this.detectDataTypeFromCsvHeader(firstLine.split("\t"));
			}
		}
		if (format === "mtx") {
			return "single_cell_expression";
		}
		return "unknown";
	}

	private async analyzeDirectoryPath(dirPath: string): Promise<FileAnalysis> {
		const entries = await this.fs.listDirectory(dirPath).catch(() => [] as any[]);
		const lowerNames = entries.map((e: any) => String(e.name || "").toLowerCase());
		if (
			lowerNames.includes("matrix.mtx") ||
			lowerNames.includes("matrix.mtx.gz")
		) {
			return { dataType: "single_cell_expression", format: "mtx" };
		}
		const filteredDir = entries.find(
			(e: any) =>
				e.isDirectory && /filtered_feature_bc_matrix/i.test(String(e.name || ""))
		);
		if (filteredDir) {
			const nested = await this.analyzeDirectoryPath(filteredDir.path);
			if (nested.dataType !== "unknown") {
				return nested;
			}
		}
		const hasFCS = entries.some(
			(e: any) => !e.isDirectory && /\.fcs(\.gz)?$/i.test(String(e.name || ""))
		);
		if (hasFCS) {
			const hasSpectralMeta = entries.some(
				(e: any) =>
					!e.isDirectory &&
					/\b(spill|spillover|unmix|unmixing)\b/i.test(String(e.name || "")) &&
					/\.(csv|tsv|txt)$/i.test(String(e.name || ""))
			);
			return {
				dataType: hasSpectralMeta ? "spectral_flow_cytometry" : "flow_cytometry",
				format: "fcs_bundle",
			};
		}
		return { dataType: "unknown", format: "unknown" };
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

	private async resolveDatasetAnalysis(
		dataset: Dataset,
		workspaceDir: string
	): Promise<FileAnalysis> {
		const cacheKey = this.buildDatasetCacheKey(dataset);
		const label = dataset.title || dataset.id || "dataset";
		if (cacheKey && this.datasetAnalysisCache.has(cacheKey)) {
			return this.datasetAnalysisCache.get(cacheKey)!;
		}

		const metadataAnalysis = this.inferAnalysisFromDatasetMetadata(dataset);
		if (metadataAnalysis) {
			if (metadataAnalysis.dataType !== "unknown") {
				this.updateStatus(
					`Detected ${metadataAnalysis.dataType} (${metadataAnalysis.format}) for ${label} via metadata`
				);
			}
			return this.recordDatasetAnalysis(cacheKey, metadataAnalysis);
		}

		const candidatePaths = await this.findDatasetFiles(dataset, workspaceDir);
		for (const candidate of candidatePaths) {
			const analysis = await this.analyzeFileType(candidate);
			if (analysis.dataType !== "unknown" || analysis.format !== "unknown") {
				this.updateStatus(
					`Detected ${analysis.dataType} (${analysis.format}) for ${label} at ${candidate}`
				);
				return this.recordDatasetAnalysis(cacheKey, analysis);
			}
		}

		const fallback: FileAnalysis = {
			dataType:
				dataset.dataType || this.inferDataTypeFromMetadata(dataset) || "unknown",
			format: dataset.fileFormat || "unknown",
		};
		if (fallback.dataType !== "unknown") {
			this.updateStatus(
				`Fallback detected ${fallback.dataType} (${fallback.format}) for ${label}`
			);
		}
		return this.recordDatasetAnalysis(cacheKey, fallback);
	}

	async analyzeDataTypesAndSelectTools(
		datasets: Dataset[],
		workspaceDir: string
	): Promise<DataTypeAnalysis> {
		this.updateStatus(
			"Analyzing data types and selecting appropriate tools..."
		);

		try {
			// Resolve each dataset using metadata shortcuts, cached analysis, and lightweight file probes
			const detectedDataTypes: string[] = [];
			const detectedFormats: string[] = [];

			for (const dataset of datasets) {
				const analysis = await this.resolveDatasetAnalysis(dataset, workspaceDir);
				detectedDataTypes.push(analysis.dataType);
				detectedFormats.push(analysis.format);
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
                const info = await this.fs.getFileInfo(p).catch(
                        () => null as any
                );
                if (info && info.isDirectory) {
                    const entries = await this.fs.listDirectory(p).catch(() => [] as any[]);
                    const tenxSubdir = entries.find(
                        (entry: any) =>
                            entry.isDirectory &&
                            /filtered_feature_bc_matrix/i.test(String(entry.name || ""))
                    );
                    if (tenxSubdir) {
                        return [p, tenxSubdir.path];
                    }
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
		const normalized = this.normalizeFsPath(filePath);
		if (normalized && this.fileAnalysisCache.has(normalized)) {
			return this.fileAnalysisCache.get(normalized)!;
		}

		let info: { size?: number; isDirectory: boolean } | null = null;
		try {
			info = await this.fs.getFileInfo(filePath);
		} catch (_) {
			info = null;
		}

		if (info?.isDirectory) {
			const directoryAnalysis = await this.analyzeDirectoryPath(filePath);
			return this.recordFileAnalysis(normalized, directoryAnalysis);
		}

		const format = this.detectFormatFromExtension(filePath);
		const extensionDataType = this.dataTypeFromExtension(format, filePath);
		if (extensionDataType) {
			return this.recordFileAnalysis(normalized, {
				dataType: extensionDataType,
				format,
			});
		}

		let lines: string[] = [];
		if (this.shouldReadFileHead(info, format)) {
			try {
				const content = await this.fs.readFile(filePath);
				lines = content.split(/\r?\n/).slice(0, 10);
			} catch (_) {
				// ignore read failures and fall back to format heuristics
			}
		}

		const dataType = this.detectDataTypeFromContent(lines, format);
		return this.recordFileAnalysis(normalized, {
			dataType,
			format,
		});
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

		for (const format of formats) {
			switch (format) {
				case "10x_mtx":
					tools.add("scanpy");
					tools.add("anndata");
					tools.add("leidenalg");
					tools.add("pynndescent");
					approaches.add("tenx_ingestion");
					break;
				case "h5ad":
				case "loom":
					tools.add("scanpy");
					tools.add("anndata");
					approaches.add("anndata_workflow");
					break;
				case "fcs_bundle":
					tools.add("fcsparser");
					tools.add("flowkit");
					approaches.add("fcs_ingestion");
					break;
			}
		}

		return {
			tools: Array.from(tools),
			approaches: Array.from(approaches),
		};
	}

	private choosePrimaryDataType(dataTypes: string[]): string {
		const priorities = [
			"single_cell_expression",
			"spectral_flow_cytometry",
			"flow_cytometry",
			"expression_matrix",
			"sequence_data",
			"variant_data",
			"clinical_data",
			"metadata",
			"unknown",
		];
		const unique = dataTypes.length ? dataTypes : ["unknown"];
		for (const priority of priorities) {
			if (unique.includes(priority)) {
				return priority;
			}
		}
		return unique[0];
	}

	async generateDataTypeSpecificPlan(
		userQuestion: string,
		dataAnalysis: DataTypeAnalysis,
		datasets: Dataset[]
	): Promise<{ steps: { description: string; prerequisites?: string[] }[] }> {
		const steps: { description: string; prerequisites?: string[] }[] = [];

        // Generate steps based on the primary data type
		const primaryDataType = this.choosePrimaryDataType(
			dataAnalysis.dataTypes.map((d) => d || "unknown")
		);

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
                steps.push({ description: "Load 10x/AnnData dataset into an AnnData object" });
                steps.push({ description: "Run basic Scanpy QC metrics and filter obvious low-quality cells/genes" });
                steps.push({ description: "Normalize total counts and apply log1p transform" });
                steps.push({ description: "Select highly variable genes" });
                steps.push({ description: "Scale the data and compute PCA embeddings" });
                steps.push({ description: "Build the neighborhood graph from the PCA representation" });
                steps.push({ description: "Run UMAP on the neighbors graph" });
                steps.push({ description: "Cluster cells with Leiden" });
                steps.push({ description: "Rank marker genes per cluster" });
                steps.push({ description: "Plot UMAP colored by cluster and key markers" });
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
