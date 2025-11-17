import path from "path";
import { Dataset, DataTypeAnalysis } from "../types";
import { FilesystemAdapter } from "../../utils/fs/FilesystemAdapter";
import { DefaultFilesystemAdapter } from "../../utils/fs/DefaultFilesystemAdapter";
import { BackendClient } from "../backend/BackendClient";
import {
	getActiveChatSessionId,
	getWorkspaceScope,
} from "../../utils/SessionScope";

export interface FileAnalysis {
	dataType: string;
	format: string;
}

export class DatasetManager {
	private fs: FilesystemAdapter;
	private statusCallback?: (status: string) => void;
	private fileAnalysisCache = new Map<string, FileAnalysis>();
	private datasetAnalysisCache = new Map<string, FileAnalysis>();
	private sessionDatasetCache = new Map<
		string,
		{ datasets: Dataset[]; analysis: DataTypeAnalysis }
	>();
	private backendClient?: BackendClient;
	private readonly fallbackSessionInstanceId = `offline_${Date.now()}_${Math.random()
		.toString(36)
		.slice(2, 8)}`;

	constructor(fsAdapter?: FilesystemAdapter, backendClient?: BackendClient) {
		this.fs = fsAdapter ?? new DefaultFilesystemAdapter();
		this.backendClient = backendClient;
	}

	private buildSessionId(
		workspace?: string | null,
		chatId?: string | null
	): string | undefined {
		const ws = typeof workspace === "string" && workspace.trim()
			? workspace.trim()
			: undefined;
		if (!ws) {
			return undefined;
		}
		const chat =
			typeof chatId === "string" && chatId.trim()
				? chatId.trim()
				: "global";
		if (this.backendClient) {
			return this.backendClient.buildSessionId(ws, chat);
		}
		const suffix = [ws, chat]
			.map((part) => part.trim())
			.join(":");
		return `session:${this.fallbackSessionInstanceId}:${suffix}`;
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

			// 10x-style markers (traditional format)
			const hasMtx =
				names.includes("matrix.mtx") || names.includes("matrix.mtx.gz");
			const hasFeatures =
				names.includes("features.tsv") || names.includes("genes.tsv");
			const hasBarcodes =
				names.includes("barcodes.tsv") || names.includes("barcodes.tsv.gz");
			if (hasMtx && (hasFeatures || hasBarcodes)) {
				const base = dirPath.split(/[\\/]/).pop() || dirPath;
				addDataset({
					id: `local-${Math.abs(this.simpleHash(dirPath))}`,
					title: base,
					source: "Local",
					description:
						"Detected 10x-style matrix directory (matrix.mtx, features.tsv, barcodes.tsv)",
					platform: "10x",
					dataType: "single_cell_expression",
					fileFormat: "10x_mtx",
					localPath: dirPath,
					isLocalDirectory: true,
				});
				return; // already classified
			}

			// 10x Multiome or filtered feature barcode matrix (h5 format)
			const hasH5Files = entries.some(
				(e: any) =>
					!e.isDirectory &&
					/\.h5$/i.test(e.name) &&
					(/filtered_feature_bc_matrix|raw_feature_bc_matrix/i.test(e.name) ||
						/gene_expression|chromatin_accessibility/i.test(e.name))
			);
			if (hasH5Files) {
				const base = dirPath.split(/[\\/]/).pop() || dirPath;
				const h5File = entries.find(
					(e: any) => !e.isDirectory && /\.h5$/i.test(e.name)
				);
				addDataset({
					id: `local-${Math.abs(this.simpleHash(dirPath))}`,
					title: base,
					source: "Local",
					description: `Detected 10x H5 file: ${h5File?.name || "10x_h5_file"}`,
					platform: "10x",
					dataType: "single_cell_expression",
					fileFormat: "10x_h5",
					localPath: dirPath,
					isLocalDirectory: true,
				});
				return; // already classified
			}

			// Detect presence of FCS and spectral metadata (spillover/unmixing) files
			const hasFCS = entries.some(
				(e: any) => !e.isDirectory && /\.fcs(\.gz)?$/i.test(e.name)
			);
			const hasSpectralMeta = entries.some(
				(e: any) =>
					!e.isDirectory &&
					/\b(spill|spillover|unmix|unmixing)\b/i.test(e.name) &&
					/\.(csv|tsv|txt)$/i.test(e.name)
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
					platform: hasSpectralMeta
						? "Spectral Flow Cytometry"
						: "Flow Cytometry",
					dataType: hasSpectralMeta
						? "spectral_flow_cytometry"
						: "flow_cytometry",
					fileFormat: "fcs_bundle",
					localPath: dirPath,
					isLocalDirectory: true,
				});
				return;
			}

			// Heuristic: directory with multiple CSV/TSV files -> inspect first header for flow cytometry patterns
			const delimited = entries.filter(
				(e: any) => !e.isDirectory && /\.(csv|tsv|txt)$/i.test(e.name)
			);
			if (delimited.length >= 2) {
				try {
					const first = delimited[0].path;
					const content = await this.fs.readFile(first).catch(() => "");
					const head = (content || "").split(/\n/)[0] || "";
					if (head) {
						const isTsv =
							/\.(tsv|txt)$/i.test(first) ||
							(!/,/.test(head) && /\t/.test(head));
						const delim = isTsv ? "\t" : ",";
						const cols = head.split(delim).map((c: string) => c.trim());
						const lower = cols.map((c: string) => c.toLowerCase());
						const hasFSC = lower.some((c) => c.startsWith("fsc"));
						const hasSSC = lower.some((c) => c.startsWith("ssc"));
						const hasCD = cols.some((c: string) => /\bcd\d+/i.test(c));
						const hasFluor = cols.some((c: string) =>
							/(fitc|pe|apc|percp|bv\d{2,3}|af\d{2,3}|a[0-9]{2,3}|b[0-9]{2,3})/i.test(
								c
							)
						);
						const flowLike = hasFSC || hasSSC || hasCD || hasFluor;
						// Spectral metadata hint via filenames alongside CSVs
						const hasSpectralSidecar = entries.some(
							(e: any) =>
								/\b(spill|spillover|unmix|unmixing)\b/i.test(e.name) &&
								/\.(csv|tsv|txt)$/i.test(e.name)
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
								platform: hasSpectralSidecar
									? "Spectral Flow Cytometry"
									: "Flow Cytometry",
								dataType: hasSpectralSidecar
									? "spectral_flow_cytometry"
									: "flow_cytometry",
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
					// Single-cell formats
					lower.endsWith(".h5ad") ||
					lower.endsWith(".loom") ||
					lower.endsWith(".mtx") ||
					lower.endsWith(".mtx.gz") ||
					// 10x H5 formats
					(lower.includes("filtered_feature_bc_matrix") &&
						lower.endsWith(".h5")) ||
					(lower.includes("raw_feature_bc_matrix") && lower.endsWith(".h5")) ||
					// Delimited text formats
					lower.endsWith(".csv") ||
					lower.endsWith(".tsv") ||
					lower.endsWith(".txt") ||
					// Generic HDF5
					lower.endsWith(".h5") ||
					lower.endsWith(".hdf5") ||
					// Flow cytometry
					lower.endsWith(".fcs") ||
					lower.endsWith(".fcs.gz") ||
					// Genomics formats
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

	setBackendClient(backendClient: BackendClient) {
		this.backendClient = backendClient;
	}

	/**
	 * Clear all caches to force fresh analysis
	 */
	clearCaches() {
		this.fileAnalysisCache.clear();
		this.datasetAnalysisCache.clear();
		this.sessionDatasetCache.clear();
		this.updateStatus("Caches cleared - will perform fresh analysis");
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

	private inferAnalysisFromDatasetMetadata(
		dataset: Dataset
	): FileAnalysis | null {
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
		if (
			delimited?.count >= 2 &&
			delimited?.examples?.some?.((name: string) => /\.fcs(\.gz)?$/i.test(name))
		) {
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
		// 10x H5 formats (filtered/raw feature barcode matrix)
		if (lc.includes("filtered_feature_bc_matrix") && lc.endsWith(".h5"))
			return "10x_h5";
		if (lc.includes("raw_feature_bc_matrix") && lc.endsWith(".h5"))
			return "10x_h5";
		// Generic H5 (could be 10x or other single-cell formats)
		if (lc.endsWith(".h5") || lc.endsWith(".hdf5")) return "h5";
		if (lc.endsWith(".loom")) return "loom";
		if (/\.fcs(\.gz)?$/i.test(lc)) return "fcs";
		return "unknown";
	}

	private dataTypeFromExtension(
		format: string,
		filePath: string
	): string | null {
		switch (format) {
			case "h5ad":
			case "loom":
			case "10x_h5": // 10x filtered/raw feature barcode matrix H5 files
			case "mtx": // Matrix market format (often 10x)
				return "single_cell_expression";
			case "fcs": {
				const spectralHint =
					/\b(spectral|cytek|aurora|unmix|unmixed|spill|spillover)\b/.test(
						filePath.toLowerCase()
					);
				return spectralHint ? "spectral_flow_cytometry" : "flow_cytometry";
			}
			case "h5": {
				// Generic H5 files - could be single-cell or other data
				const lc = filePath.toLowerCase();
				// Check for 10x-style naming patterns
				if (
					lc.includes("filtered_feature_bc_matrix") ||
					lc.includes("raw_feature_bc_matrix") ||
					lc.includes("gene_expression") ||
					lc.includes("chromatin_accessibility")
				) {
					return "single_cell_expression";
				}
				// Default to unknown for generic H5 files
				return null;
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

	private detectDataTypeFromContent(lines: string[], format: string): string {
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
		const entries = await this.fs
			.listDirectory(dirPath)
			.catch(() => [] as any[]);
		const lowerNames = entries.map((e: any) =>
			String(e.name || "").toLowerCase()
		);
		if (
			lowerNames.includes("matrix.mtx") ||
			lowerNames.includes("matrix.mtx.gz")
		) {
			return { dataType: "single_cell_expression", format: "mtx" };
		}
		const filteredDir = entries.find(
			(e: any) =>
				e.isDirectory &&
				/filtered_feature_bc_matrix/i.test(String(e.name || ""))
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
				dataType: hasSpectralMeta
					? "spectral_flow_cytometry"
					: "flow_cytometry",
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

	private async resolveDatasetAnalysis(
		dataset: Dataset,
		workspaceDir: string
	): Promise<FileAnalysis> {
		const cacheKey = this.buildDatasetCacheKey(dataset);
		const label = dataset.title || dataset.id || "dataset";

		// Check cache FIRST (was checked after expensive operations before)
		if (cacheKey && this.datasetAnalysisCache.has(cacheKey)) {
			this.updateStatus(`Using cached analysis for ${label} (fast!)`);
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
				dataset.dataType ||
				this.inferDataTypeFromMetadata(dataset) ||
				"unknown",
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
		// Create session key for caching
		const sessionId = (() => {
			const workspace = getWorkspaceScope();
			const chatRaw = getActiveChatSessionId();
			const session = this.buildSessionId(workspace, chatRaw);
			if (session) return session;
			return `session:${this.fallbackSessionInstanceId}:${chatRaw || "global"}`;
		})();

		// Create cache key based on dataset IDs and workspace
		const datasetIds = datasets
			.map((d) => d.id)
			.sort()
			.join(",");
		const cacheKey = `${sessionId}:${workspaceDir}:${datasetIds}`;

		// Check cache first
		if (this.sessionDatasetCache.has(cacheKey)) {
			const cached = this.sessionDatasetCache.get(cacheKey)!;
			this.updateStatus("Using cached dataset analysis (fast!)");
			return cached.analysis;
		}

		this.updateStatus(
			"Analyzing data types and selecting appropriate tools..."
		);

		try {
			// Resolve each dataset using metadata shortcuts, cached analysis, and lightweight file probes
			const detectedDataTypes: string[] = [];
			const detectedFormats: string[] = [];

			for (const dataset of datasets) {
				const analysis = await this.resolveDatasetAnalysis(
					dataset,
					workspaceDir
				);
				detectedDataTypes.push(analysis.dataType);
				detectedFormats.push(analysis.format);
			}

			// Get tool recommendations based on detected data types
			const toolRecommendations = await this.getToolRecommendations(
				detectedDataTypes,
				detectedFormats
			);

			const analysisResult = {
				dataTypes: detectedDataTypes,
				recommendedTools: toolRecommendations.tools,
				analysisApproaches: toolRecommendations.approaches,
				dataComplexity: "moderate" as const,
				suggestedApproach: "standard analysis pipeline",
				estimatedCells: detectedDataTypes.length * 3,
			};

			// Cache the result for future use
			this.sessionDatasetCache.set(cacheKey, {
				datasets,
				analysis: analysisResult,
			});

			return analysisResult;
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
				const info = await this.fs.getFileInfo(p).catch(() => null as any);
				if (info && info.isDirectory) {
					const entries = await this.fs
						.listDirectory(p)
						.catch(() => [] as any[]);
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
		if (
			/\b(flow|cytometry|fcs)\b/.test(title) ||
			/\b(flow|cytometry|fcs)\b/.test(description)
		) {
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
					// Core spectral flow analysis
					tools.add("pandas");
					tools.add("numpy");
					tools.add("scipy");
					tools.add("scikit-learn");
					// FCS file handling and spectral analysis
					tools.add("fcsparser");
					tools.add("flowkit");
					// Spectral unmixing specific tools
					tools.add("specpy");
					// Visualization and analysis
					tools.add("matplotlib");
					tools.add("seaborn");

					// Integration with single-cell analysis
					tools.add("anndata");
					tools.add("scanpy");
					tools.add("umap-learn");
					// Spectral flow specific approaches
					approaches.add("spectral_unmixing");
					approaches.add("compensation_correction");
					approaches.add("spectral_parameter_analysis");
					approaches.add("scanpy_integration");
					approaches.add("quality_control");
					approaches.add("dimensionality_reduction");
					approaches.add("clustering");
					approaches.add("spectral_visualization");
					approaches.add("marker_expression_analysis");
					break;
				case "flow_cytometry":
					// Core data processing
					tools.add("pandas");
					tools.add("numpy");
					tools.add("scipy");
					// Machine learning and analysis
					tools.add("scikit-learn");
					tools.add("umap-learn");
					tools.add("hdbscan");
					// Visualization
					tools.add("matplotlib");
					tools.add("seaborn");

					// FCS file handling
					tools.add("fcsparser");
					// Flow cytometry specific tools
					tools.add("flowkit");
					approaches.add("fcs_processing");
					approaches.add("compensation_correction");
					approaches.add("gating_analysis");
					approaches.add("dimensionality_reduction");
					approaches.add("clustering");
					approaches.add("marker_expression_analysis");
					approaches.add("visualization");
					approaches.add("flow_cytometry_qc");
					break;
				case "single_cell_expression":
					// Core scverse libraries for single-cell analysis
					tools.add("scanpy");
					tools.add("anndata");
					// Essential scientific computing
					tools.add("numpy");
					tools.add("scipy");
					tools.add("pandas");
					// Visualization libraries
					tools.add("matplotlib");
					tools.add("seaborn");

					// Quality control and preprocessing
					tools.add("scrublet"); // Doublet detection
					// Dimensionality reduction and clustering
					tools.add("leidenalg"); // Leiden clustering
					tools.add("umap-learn"); // UMAP dimensionality reduction
					// Batch correction and integration
					// Cell type annotation and marker analysis

					// Complete Scanpy workflow approaches
					approaches.add("scanpy_complete_workflow");
					approaches.add("data_loading_10x_h5");
					approaches.add("qc_metrics_calculation");
					approaches.add("mitochondrial_ribosomal_detection");
					approaches.add("cell_gene_filtering");
					approaches.add("doublet_detection_scrublet");
					approaches.add("normalization_log1p");
					approaches.add("highly_variable_genes");
					approaches.add("pca_dimensionality_reduction");
					approaches.add("neighbors_graph_construction");
					approaches.add("umap_visualization");
					approaches.add("leiden_clustering");
					approaches.add("marker_gene_analysis");
					approaches.add("differential_expression");
					approaches.add("cell_type_annotation");
					approaches.add("batch_effect_correction");
					break;

				case "expression_matrix":
					// Core data processing
					tools.add("pandas");
					tools.add("numpy");
					tools.add("scipy");
					// Statistical analysis and machine learning
					tools.add("scikit-learn");
					tools.add("statsmodels");
					// Differential expression analysis
					tools.add("deseq2");
					tools.add("limma");
					// Visualization
					tools.add("matplotlib");
					tools.add("seaborn");

					// Pathway analysis
					tools.add("gseapy");
					tools.add("clusterprofiler");
					// Expression matrix specific approaches
					approaches.add("expression_qc");
					approaches.add("normalization_detection");
					approaches.add("differential_expression");
					approaches.add("pca_analysis");
					approaches.add("heatmap_visualization");
					approaches.add("volcano_plotting");
					approaches.add("pathway_enrichment");
					approaches.add("correlation_analysis");
					break;

				case "clinical_data":
					// Core data processing
					tools.add("pandas");
					tools.add("numpy");
					tools.add("scipy");
					// Statistical analysis
					tools.add("scikit-learn");
					tools.add("statsmodels");
					// Survival analysis
					tools.add("lifelines");
					// Machine learning for clinical data
					tools.add("xgboost");
					tools.add("lightgbm");
					// Visualization
					tools.add("matplotlib");
					tools.add("seaborn");
					// Missing value imputation
					tools.add("missingno");
					// Clinical data specific approaches
					approaches.add("clinical_data_qc");
					approaches.add("missing_value_imputation");
					approaches.add("exploratory_data_analysis");
					approaches.add("statistical_testing");
					approaches.add("survival_analysis");
					approaches.add("predictive_modeling");
					approaches.add("feature_importance");
					approaches.add("model_validation");
					approaches.add("correlation_analysis");
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
					// 10x matrix market format - requires scanpy for loading
					tools.add("scanpy");
					tools.add("anndata");
					tools.add("leidenalg");
					approaches.add("tenx_ingestion");
					approaches.add("scanpy_10x_workflow");
					approaches.add("matrix_market_loading");
					break;
				case "10x_h5":
					// 10x H5 format (filtered/raw feature barcode matrix)
					tools.add("scanpy");
					tools.add("anndata");
					tools.add("leidenalg");
					approaches.add("tenx_h5_ingestion");
					approaches.add("scanpy_10x_workflow");
					approaches.add("h5_matrix_loading");
					break;
				case "h5ad":
				case "loom":
					// AnnData formats are Scanpy's native format
					tools.add("scanpy");
					tools.add("anndata");
					approaches.add("anndata_workflow");
					approaches.add("scanpy_native_format");
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

	/**
	 * Analyze user question intent and extract key analysis requirements
	 */
	async analyzeUserQuestionIntent(
		userQuestion: string,
		datasets: Dataset[] = []
	): Promise<{
		intent: string;
		analysisGoals: string[];
		expectedOutputs: string[];
		analysisType: string;
		complexity: string;
	}> {
		if (!this.backendClient) {
			// Fallback analysis based on question keywords
			return this.fallbackQuestionAnalysis(userQuestion);
		}

		try {
			this.updateStatus(
				"Analyzing user question to understand research intent..."
			);

			const analysis = await this.backendClient.analyzeQuery(userQuestion);

			// Extract data types from datasets if not provided in analysis
			const detectedDataTypes =
				datasets.length > 0
					? await this.analyzeDataTypes(datasets)
					: analysis.data_types || ["unknown"];

			const goals = this.extractAnalysisGoalsFromQuestion(
				userQuestion,
				detectedDataTypes
			);
			const outputs = this.extractExpectedOutputsFromQuestion(userQuestion);

			return {
				intent: analysis.intent || "data_exploration",
				analysisGoals: goals,
				expectedOutputs: outputs,
				analysisType: this.determineAnalysisType(
					userQuestion,
					detectedDataTypes
				),
				complexity: this.determineComplexity(goals, detectedDataTypes),
			};
		} catch (error) {
			console.error("Error analyzing user question:", error);
			return this.fallbackQuestionAnalysis(userQuestion);
		}
	}

	/**
	 * Fallback analysis when LLM is not available
	 */
	private fallbackQuestionAnalysis(userQuestion: string): {
		intent: string;
		analysisGoals: string[];
		expectedOutputs: string[];
		analysisType: string;
		complexity: string;
	} {
		const question = userQuestion.toLowerCase();
		const goals: string[] = [];
		const outputs: string[] = [];

		// Extract goals based on keywords
		if (question.includes("cluster") || question.includes("group")) {
			goals.push("clustering");
		}
		if (question.includes("differential") || question.includes("compare")) {
			goals.push("differential_expression");
		}
		if (question.includes("visual") || question.includes("plot")) {
			goals.push("visualization");
		}
		if (question.includes("quality") || question.includes("qc")) {
			goals.push("quality_control");
		}
		if (question.includes("pathway") || question.includes("enrich")) {
			goals.push("pathway_analysis");
		}

		// Extract expected outputs
		if (question.includes("plot") || question.includes("graph")) {
			outputs.push("visualizations");
		}
		if (question.includes("table") || question.includes("result")) {
			outputs.push("analysis_results");
		}
		if (question.includes("list") || question.includes("genes")) {
			outputs.push("gene_lists");
		}

		// Default goals if none found
		if (goals.length === 0) {
			goals.push("exploratory_analysis");
		}
		if (outputs.length === 0) {
			outputs.push("analysis_results", "visualizations");
		}

		return {
			intent: "data_exploration",
			analysisGoals: goals,
			expectedOutputs: outputs,
			analysisType: "exploratory",
			complexity: "medium",
		};
	}

	/**
	 * Extract analysis goals from user question
	 */
	private extractAnalysisGoalsFromQuestion(
		question: string,
		dataTypes: string[]
	): string[] {
		const goals: string[] = [];
		const questionLower = question.toLowerCase();

		// Common analysis goals by data type
		if (dataTypes.includes("single_cell_expression")) {
			if (questionLower.includes("cluster")) {
				goals.push("cell_clustering");
			}
			if (
				questionLower.includes("trajectory") ||
				questionLower.includes("development")
			) {
				goals.push("trajectory_analysis");
			}
			if (
				questionLower.includes("differential") ||
				questionLower.includes("compare")
			) {
				goals.push("differential_expression");
			}
			if (questionLower.includes("marker")) {
				goals.push("marker_gene_analysis");
			}
			if (
				questionLower.includes("type") ||
				questionLower.includes("identity")
			) {
				goals.push("cell_type_annotation");
			}
		}

		if (
			dataTypes.includes("flow_cytometry") ||
			dataTypes.includes("spectral_flow_cytometry")
		) {
			if (questionLower.includes("cluster")) {
				goals.push("cell_clustering");
			}
			if (
				questionLower.includes("compensate") ||
				questionLower.includes("unmix")
			) {
				goals.push("compensation_unmixing");
			}
			if (questionLower.includes("gate")) {
				goals.push("gating_analysis");
			}
			if (
				questionLower.includes("marker") ||
				questionLower.includes("express")
			) {
				goals.push("marker_expression_analysis");
			}
		}

		if (dataTypes.includes("expression_matrix")) {
			if (
				questionLower.includes("differential") ||
				questionLower.includes("compare")
			) {
				goals.push("differential_expression");
			}
			if (
				questionLower.includes("pathway") ||
				questionLower.includes("enrich")
			) {
				goals.push("pathway_analysis");
			}
			if (questionLower.includes("correlate")) {
				goals.push("correlation_analysis");
			}
		}

		// Common goals across data types
		if (questionLower.includes("quality") || questionLower.includes("qc")) {
			goals.push("quality_control");
		}
		if (questionLower.includes("visual")) {
			goals.push("visualization");
		}
		if (
			questionLower.includes("explore") ||
			questionLower.includes("overview")
		) {
			goals.push("exploratory_analysis");
		}

		// Default goal if none found
		if (goals.length === 0) {
			goals.push("exploratory_analysis");
		}

		return goals;
	}

	/**
	 * Extract expected outputs from user question
	 */
	private extractExpectedOutputsFromQuestion(question: string): string[] {
		const outputs: string[] = [];
		const questionLower = question.toLowerCase();

		if (
			questionLower.includes("plot") ||
			questionLower.includes("graph") ||
			questionLower.includes("visual")
		) {
			outputs.push("visualizations");
		}
		if (
			questionLower.includes("list") ||
			questionLower.includes("gene") ||
			questionLower.includes("marker")
		) {
			outputs.push("gene_lists");
		}
		if (questionLower.includes("cluster") || questionLower.includes("group")) {
			outputs.push("cluster_assignments");
		}
		if (questionLower.includes("pathway") || questionLower.includes("enrich")) {
			outputs.push("pathway_results");
		}
		if (questionLower.includes("report") || questionLower.includes("summary")) {
			outputs.push("analysis_report");
		}

		// Always include basic outputs
		if (!outputs.includes("visualizations")) {
			outputs.push("visualizations");
		}
		if (!outputs.includes("analysis_results")) {
			outputs.push("analysis_results");
		}

		return outputs;
	}

	/**
	 * Determine analysis type based on question and data types
	 */
	private determineAnalysisType(question: string, dataTypes: string[]): string {
		const questionLower = question.toLowerCase();

		if (
			questionLower.includes("explore") ||
			questionLower.includes("overview")
		) {
			return "exploratory";
		}
		if (
			questionLower.includes("hypothesis") ||
			questionLower.includes("test")
		) {
			return "hypothesis_testing";
		}
		if (
			questionLower.includes("discover") ||
			questionLower.includes("identify")
		) {
			return "discovery";
		}
		if (
			questionLower.includes("characterize") ||
			questionLower.includes("describe")
		) {
			return "characterization";
		}

		// Default based on data type
		if (
			dataTypes.includes("single_cell_expression") ||
			dataTypes.includes("flow_cytometry")
		) {
			return "cellular_analysis";
		}
		if (dataTypes.includes("expression_matrix")) {
			return "transcriptomic_analysis";
		}

		return "exploratory";
	}

	/**
	 * Determine complexity based on goals and data types
	 */
	private determineComplexity(goals: string[], dataTypes: string[]): string {
		const complexityScore = goals.length + dataTypes.length;

		if (complexityScore <= 2) return "simple";
		if (complexityScore <= 5) return "moderate";
		return "complex";
	}

	/**
	 * Generate intelligent analysis plan based on user question intent and data types
	 */
	async generateIntelligentAnalysisPlan(
		userQuestion: string,
		datasets: Dataset[]
	): Promise<{
		steps: {
			description: string;
			prerequisites?: string[];
			implementation?: string;
			tools?: string[];
			expected_outputs?: string[];
		}[];
		metadata: {
			intent: string;
			analysisType: string;
			complexity: string;
			estimatedTime: string;
		};
	}> {
		this.updateStatus(
			"Analyzing user question and data to create intelligent analysis plan..."
		);

		// Step 1: Analyze user question intent
		const questionIntent = await this.analyzeUserQuestionIntent(
			userQuestion,
			datasets
		);

		// Step 2: Analyze data types
		const dataAnalysis = await this.analyzeDataTypesAndSelectTools(
			datasets,
			""
		);

		// Step 3: Combine question intent with data analysis to create intelligent plan
		const intelligentSteps = await this.createIntelligentSteps(
			questionIntent,
			dataAnalysis,
			datasets
		);

		// Step 4: Estimate time based on complexity
		const estimatedTime = this.estimateTime(
			questionIntent.complexity,
			dataAnalysis.dataTypes
		);

		return {
			steps: intelligentSteps,
			metadata: {
				intent: questionIntent.intent,
				analysisType: questionIntent.analysisType,
				complexity: questionIntent.complexity,
				estimatedTime,
			},
		};
	}

	/**
	 * Create intelligent steps based on question intent and data analysis
	 */
	private async createIntelligentSteps(
		questionIntent: any,
		dataAnalysis: DataTypeAnalysis,
		datasets: Dataset[]
	): Promise<
		{
			description: string;
			prerequisites?: string[];
			implementation?: string;
			tools?: string[];
			expected_outputs?: string[];
		}[]
	> {
		const steps: {
			description: string;
			prerequisites?: string[];
			implementation?: string;
			tools?: string[];
			expected_outputs?: string[];
		}[] = [];

		const primaryDataType = this.choosePrimaryDataType(dataAnalysis.dataTypes);

		// Add steps based on user goals
		for (const goal of questionIntent.analysisGoals) {
			await this.addGoalBasedSteps(steps, goal, primaryDataType, datasets);
		}

		// Always include essential steps
		await this.addEssentialSteps(steps, primaryDataType, datasets);

		// Add output generation steps
				steps.push({
			description: `Generate ${questionIntent.expectedOutputs.join(" and ")}`,
			prerequisites: questionIntent.analysisGoals,
			tools: ["matplotlib", "seaborn", "pandas"],
			expected_outputs: questionIntent.expectedOutputs,
		});

		return steps;
	}

	/**
	 * Add steps based on specific analysis goals
	 */
	private async addGoalBasedSteps(
		steps: any[],
		goal: string,
		dataType: string,
		datasets: Dataset[]
	): Promise<void> {
		switch (goal) {
			case "cell_clustering":
				if (dataType === "single_cell_expression") {
				steps.push({
					description:
							"Perform cell clustering using Scanpy's Leiden algorithm",
						prerequisites: ["quality_control", "normalization"],
						tools: ["scanpy", "leidenalg"],
						expected_outputs: ["cluster_assignments", "visualizations"],
					implementation:
							"sc.tl.leiden(adata); sc.pl.umap(adata, color=['leiden'])",
					});
				} else if (
					dataType === "flow_cytometry" ||
					dataType === "spectral_flow_cytometry"
				) {
				steps.push({
					description:
							"Perform cell clustering using HDBSCAN on compensated data",
						prerequisites: ["compensation_unmixing", "quality_control"],
						tools: ["hdbscan", "umap-learn"],
						expected_outputs: ["cluster_assignments", "visualizations"],
					implementation:
							"clusterer = hdbscan.HDBSCAN(); clusters = clusterer.fit_predict(X_umap)",
					});
				}
				break;

			case "differential_expression":
				if (
					dataType === "single_cell_expression" ||
					dataType === "expression_matrix"
				) {
				steps.push({
					description:
							"Identify differentially expressed genes between conditions",
						prerequisites: ["quality_control", "normalization"],
						tools: ["scanpy", "pandas"],
						expected_outputs: ["gene_lists", "visualizations"],
					implementation:
							"sc.tl.rank_genes_groups(adata, 'condition'); sc.pl.rank_genes_groups(adata)",
					});
				}
				break;

			case "marker_gene_analysis":
				if (dataType === "single_cell_expression") {
				steps.push({
						description: "Find marker genes for identified clusters",
						prerequisites: ["cell_clustering"],
						tools: ["scanpy"],
						expected_outputs: ["gene_lists"],
					implementation:
							"sc.tl.rank_genes_groups(adata, 'leiden'); sc.pl.rank_genes_groups(adata)",
					});
				}
				break;

			case "compensation_unmixing":
				if (dataType === "spectral_flow_cytometry") {
				steps.push({
						description: "Apply spectral unmixing using spillover matrix",
						prerequisites: ["data_loading"],
						tools: ["pandas", "numpy"],
						expected_outputs: ["compensated_data"],
						implementation: "compensated = df @ spillover_matrix.T",
					});
				}
				break;

			case "pathway_analysis":
				if (
					dataType === "expression_matrix" ||
					dataType === "single_cell_expression"
				) {
				steps.push({
					description:
							"Perform pathway enrichment analysis on significant genes",
						prerequisites: ["differential_expression"],
						tools: ["gseapy", "pandas"],
						expected_outputs: ["pathway_results"],
					implementation:
							"enr = gp.enrichr(gene_list=significant_genes, gene_sets='KEGG_2019_Human')",
					});
				}
				break;
		}
	}

	/**
	 * Add essential steps that are always needed
	 */
	private async addEssentialSteps(
		steps: any[],
		dataType: string,
		datasets: Dataset[]
	): Promise<void> {
		// Data loading step
				steps.push({
			description: `Load ${dataType.replace(
				"_",
				" "
			)} data from available datasets`,
			prerequisites: [],
			tools: ["scanpy", "pandas"],
			expected_outputs: ["loaded_data"],
		});

		// Quality control step
		if (!steps.some((step) => step.description.includes("quality"))) {
				steps.push({
				description: "Perform quality control and data cleaning",
				prerequisites: ["data_loading"],
				tools: ["scanpy", "pandas"],
				expected_outputs: ["cleaned_data"],
			});
		}

		// Normalization step for expression data
		if (
			(dataType === "single_cell_expression" ||
				dataType === "expression_matrix") &&
			!steps.some((step) => step.description.includes("normalization"))
		) {
				steps.push({
				description: "Normalize and transform expression data",
				prerequisites: ["quality_control"],
				tools: ["scanpy"],
				expected_outputs: ["normalized_data"],
				implementation: "sc.pp.normalize_total(adata); sc.pp.log1p(adata)",
			});
		}
	}

	/**
	 * Estimate analysis time based on complexity and data types
	 */
	private estimateTime(complexity: string, dataTypes: string[]): string {
		let baseTime = 30; // minutes

		// Adjust based on complexity
		switch (complexity) {
			case "simple":
				baseTime = 20;
				break;
			case "moderate":
				baseTime = 45;
				break;
			case "complex":
				baseTime = 90;
				break;
		}

		// Adjust based on data types
		if (dataTypes.includes("single_cell_expression")) {
			baseTime += 15;
		}
		if (dataTypes.includes("spectral_flow_cytometry")) {
			baseTime += 20;
		}

		const minTime = Math.max(15, baseTime - 15);
		const maxTime = baseTime + 15;

		return `${minTime}-${maxTime} minutes`;
	}

	/**
	 * Generate dynamic analysis roadmap using LLM instead of hardcoded logic
	 */
	async generateDynamicAnalysisRoadmap(
		userQuestion: string,
		datasets: Dataset[],
		workspaceDir: string = ""
	): Promise<{
		steps: {
			description: string;
			prerequisites?: string[];
			implementation?: string;
			tools?: string[];
			expected_outputs?: string[];
		}[];
		metadata: {
			intent: string;
			analysisType: string;
			complexity: string;
			estimatedTime: string;
			dataTypes: string[];
			recommendedTools: string[];
		};
	}> {
		this.updateStatus("Generating intelligent analysis roadmap using AI...");

		try {
			// Use minimal approach - let Responses API handle memory
			// Skip expensive analysis and go directly to LLM
			this.updateStatus("Creating dynamic analysis roadmap...");

			// Create minimal context for LLM
			const scopedSessionId = this.buildSessionId(
				getWorkspaceScope(),
				getActiveChatSessionId()
			);
			const minimalContext = {
				userQuestion,
				sessionId: scopedSessionId,
				datasetIds: datasets.map((d) => d.id),
			};

			const dynamicPlan = await this.generateLLMDrivenRoadmap(
				userQuestion,
				minimalContext
			);

			// Use fallback metadata since we skipped expensive analysis
			const estimatedTime = "15-30 minutes";

			return {
				steps: dynamicPlan.steps,
				metadata: {
					intent: "data_analysis",
					analysisType: "exploratory",
					complexity: "moderate",
					estimatedTime,
					dataTypes: datasets.map((d) => d.dataType || "unknown"),
					recommendedTools: ["python", "pandas", "numpy"],
				},
			};
		} catch (error) {
			console.error("Error in dynamic roadmap generation:", error);
			// Fallback to basic plan generation
			return this.generateBasicFallbackPlan(userQuestion, datasets);
		}
	}

	/**
	 * Use LLM to generate dynamic analysis roadmap
	 */
	private async generateLLMDrivenRoadmap(
		userQuestion: string,
		minimalContext: any
	): Promise<{
		steps: {
			description: string;
			prerequisites?: string[];
			implementation?: string;
			tools?: string[];
			expected_outputs?: string[];
		}[];
	}> {
		if (!this.backendClient) {
			return this.generateBasicFallbackPlan(userQuestion, []);
		}

		try {
			// Use the minimal context directly - no need to build massive context objects
			const context = minimalContext;

			// Use LLM to generate the roadmap
			const roadmapResponse = await this.backendClient.generateRoadmap(context);

			// Parse and structure the roadmap
			return this.parseAndStructureRoadmap(roadmapResponse, minimalContext);
		} catch (error) {
			console.error("Error generating LLM-driven roadmap:", error);
			return this.generateBasicFallbackPlan(userQuestion, []);
		}
	}

	/**
	 * Prepare context for LLM roadmap generation
	 */
	private prepareRoadmapContext(
		userQuestion: string,
		questionIntent: any,
		dataAnalysis: DataTypeAnalysis,
		datasets: Dataset[]
	): any {
		// Get session ID for Responses API memory
		const sessionId = this.buildSessionId(
			getWorkspaceScope(),
			getActiveChatSessionId()
		);

		return {
			userQuestion,
			// Only send essential session info - Responses API handles memory
			sessionId,
			// Minimal dataset info - just IDs to avoid redundancy
			datasetIds: datasets.map((d) => d.id),
			// Keep basic analysis type for first-time context
			analysisType: questionIntent.analysisType || "exploratory",
		};
	}

	/**
	 * Parse and structure the LLM-generated roadmap
	 */
	private parseAndStructureRoadmap(
		roadmapResponse: any,
		minimalContext: any
	): {
		steps: {
			description: string;
			prerequisites?: string[];
			implementation?: string;
			tools?: string[];
			expected_outputs?: string[];
		}[];
	} {
		const steps: {
			description: string;
			prerequisites?: string[];
			implementation?: string;
			tools?: string[];
			expected_outputs?: string[];
		}[] = [];

		// If LLM provided structured steps, use them
		if (
			roadmapResponse.next_steps &&
			Array.isArray(roadmapResponse.next_steps)
		) {
			for (let i = 0; i < roadmapResponse.next_steps.length; i++) {
				const stepDescription = roadmapResponse.next_steps[i];

				// Extract tools from step description if mentioned
				const tools = this.extractToolsFromStep(
					stepDescription,
					["python", "pandas", "numpy"] // Minimal fallback tools
				);

				// Extract expected outputs from step description
				const expected_outputs =
					this.extractExpectedOutputsFromStep(stepDescription);

				steps.push({
					description: stepDescription,
					prerequisites: i > 0 ? [roadmapResponse.next_steps[i - 1]] : [],
					tools: tools.length > 0 ? tools : ["python", "pandas", "numpy"],
					expected_outputs:
						expected_outputs.length > 0
							? expected_outputs
							: ["analysis_results"],
					implementation: this.generateImplementationHint(stepDescription),
				});
			}
		} else {
			// Fallback: create basic steps with minimal tools
				steps.push({
				description: "Load and explore available data",
				prerequisites: [],
				tools: ["python", "pandas", "numpy"],
				expected_outputs: ["loaded_data"],
			});

				steps.push({
				description: "Perform quality control and data preprocessing",
				prerequisites: ["loaded_data"],
				tools: ["python", "pandas", "numpy"],
				expected_outputs: ["cleaned_data"],
			});

				steps.push({
				description: "Apply general analysis methods",
				prerequisites: ["cleaned_data"],
				tools: ["python", "pandas", "numpy"],
				expected_outputs: ["analysis_results"],
			});
		}

		return { steps };
	}

	/**
	 * Extract tools mentioned in step description
	 */
	private extractToolsFromStep(
		stepDescription: string,
		availableTools: string[]
	): string[] {
		const tools: string[] = [];
		const lowerStep = stepDescription.toLowerCase();

		for (const tool of availableTools) {
			if (
				lowerStep.includes(tool.toLowerCase()) ||
				lowerStep.includes(tool.toLowerCase().replace(/[-_]/g, " "))
			) {
				tools.push(tool);
			}
		}

		return tools;
	}

	/**
	 * Extract expected outputs from step description
	 */
	private extractExpectedOutputsFromStep(stepDescription: string): string[] {
		const outputs: string[] = [];
		const lowerStep = stepDescription.toLowerCase();

		if (
			lowerStep.includes("visual") ||
			lowerStep.includes("plot") ||
			lowerStep.includes("graph")
		) {
			outputs.push("visualizations");
		}
		if (lowerStep.includes("cluster") || lowerStep.includes("group")) {
			outputs.push("cluster_assignments");
		}
		if (lowerStep.includes("gene") || lowerStep.includes("marker")) {
			outputs.push("gene_lists");
		}
		if (lowerStep.includes("pathway") || lowerStep.includes("enrich")) {
			outputs.push("pathway_results");
		}
		if (
			lowerStep.includes("differential") ||
			lowerStep.includes("expression")
		) {
			outputs.push("differential_expression_results");
		}

		// Always include basic outputs
		if (outputs.length === 0) {
			outputs.push("analysis_results");
		}

		return outputs;
	}

	/**
	 * Generate implementation hint for step
	 */
	private generateImplementationHint(stepDescription: string): string {
		const lowerStep = stepDescription.toLowerCase();

		if (lowerStep.includes("cluster") && lowerStep.includes("scanpy")) {
			return "sc.tl.leiden(adata); sc.pl.umap(adata, color=['leiden'])";
		}
		if (
			lowerStep.includes("differential") &&
			lowerStep.includes("expression")
		) {
			return "sc.tl.rank_genes_groups(adata, 'condition'); sc.pl.rank_genes_groups(adata)";
		}
		if (lowerStep.includes("pca")) {
			return "sc.tl.pca(adata); sc.pl.pca(adata)";
		}
		if (lowerStep.includes("umap")) {
			return "sc.pp.neighbors(adata); sc.tl.umap(adata); sc.pl.umap(adata)";
		}
		if (lowerStep.includes("normalize")) {
			return "sc.pp.normalize_total(adata); sc.pp.log1p(adata)";
		}

		return "# Implementation will be generated by code generation service";
	}

	/**
	 * Generate basic fallback plan when intelligent analysis fails
	 */
	private generateBasicFallbackPlan(
		userQuestion: string,
		datasets: Dataset[]
	): {
		steps: {
			description: string;
			prerequisites?: string[];
			implementation?: string;
			tools?: string[];
			expected_outputs?: string[];
		}[];
		metadata: {
			intent: string;
			analysisType: string;
			complexity: string;
			estimatedTime: string;
			dataTypes: string[];
			recommendedTools: string[];
		};
	} {
		const steps = [
			{
				description: "Load and explore available data",
				prerequisites: [],
				tools: ["pandas", "numpy"],
				expected_outputs: ["loaded_data"],
			},
			{
				description: "Perform basic quality assessment",
				prerequisites: ["loaded_data"],
				tools: ["pandas"],
				expected_outputs: ["quality_report"],
			},
			{
				description: "Generate summary statistics and visualizations",
				prerequisites: ["quality_report"],
				tools: ["matplotlib", "seaborn"],
				expected_outputs: ["analysis_results", "visualizations"],
			},
		];

		return {
			steps,
			metadata: {
				intent: "data_exploration",
				analysisType: "exploratory",
				complexity: "simple",
				estimatedTime: "15-30 minutes",
				dataTypes: ["unknown"],
				recommendedTools: ["pandas", "numpy", "matplotlib"],
			},
		};
	}

	async generateDataTypeSpecificPlan(
		userQuestion: string,
		dataAnalysis: DataTypeAnalysis,
		datasets: Dataset[]
	): Promise<{
		steps: {
			description: string;
			prerequisites?: string[];
			implementation?: string;
			tools?: string[];
			expected_outputs?: string[];
		}[];
	}> {
		// Fallback to basic steps since dynamic roadmap is now the main method
		const steps = [
			{
				description: "Load and explore available data",
				prerequisites: [],
				tools: dataAnalysis.recommendedTools.slice(0, 3),
				expected_outputs: ["loaded_data"],
			},
			{
				description: "Perform quality control and data preprocessing",
				prerequisites: ["loaded_data"],
				tools: dataAnalysis.recommendedTools.slice(0, 3),
				expected_outputs: ["cleaned_data"],
			},
			{
				description: "Apply appropriate analysis methods",
				prerequisites: ["cleaned_data"],
				tools: dataAnalysis.recommendedTools.slice(0, 3),
				expected_outputs: ["analysis_results"],
			},
		];

		return { steps };
	}
}
