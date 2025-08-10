import { Dataset } from "./types";
import { electronAPI } from "../utils/electronAPI";
import { DatasetManager } from "./DatasetManager";

export interface LocalDatasetEntry extends Dataset {
	/** Absolute filesystem path of the dataset (file or directory) */
	localPath: string;
	/** If the localPath points to a directory */
	isLocalDirectory?: boolean;
	/** Suggested short alias for @mentions (defaults to basename) */
	alias?: string;
}

type PersistedRegistry = {
	datasets: LocalDatasetEntry[];
};

/**
 * LocalDatasetRegistry persists and resolves user-indexed local datasets (files/folders)
 * for easy @mention attachment in chat flows.
 */
export class LocalDatasetRegistry {
	private static STORE_KEY = "localDatasets";
	private datasets: LocalDatasetEntry[] = [];
	private datasetManager: DatasetManager;

	constructor() {
		this.datasetManager = new DatasetManager();
	}

	async load(): Promise<void> {
		const result = await electronAPI.storeGet(LocalDatasetRegistry.STORE_KEY);
		if (result?.success) {
			const data = result.data as PersistedRegistry | undefined;
			if (data && Array.isArray(data.datasets)) {
				this.datasets = data.datasets;
				return;
			}
		}
		// Initialize empty
		this.datasets = [];
	}

	private async persist(): Promise<void> {
		await electronAPI.storeSet(LocalDatasetRegistry.STORE_KEY, {
			datasets: this.datasets,
		} as PersistedRegistry);
	}

	list(): LocalDatasetEntry[] {
		return [...this.datasets];
	}

	private computeIdFromPath(absPath: string): string {
		// Stable simple hash to avoid long IDs; avoids extra deps
		const str = absPath;
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			hash = (hash << 5) - hash + str.charCodeAt(i);
			hash |= 0;
		}
		// Prefix to distinguish local datasets
		return `local-${Math.abs(hash)}`;
	}

	private inferFileFormatFromName(name: string): string | undefined {
		const lower = name.toLowerCase();
		if (lower.endsWith(".csv")) return "csv";
		if (lower.endsWith(".tsv") || lower.endsWith(".txt")) return "tsv";
		if (lower.endsWith(".h5ad")) return "h5ad";
		if (lower.endsWith(".h5") || lower.endsWith(".hdf5")) return "h5";
		if (lower.endsWith(".loom")) return "loom";
		if (lower.endsWith(".mtx")) return "mtx";
		if (lower.endsWith(".fastq") || lower.endsWith(".fq")) return "fastq";
		if (lower.endsWith(".bam")) return "bam";
		if (lower.endsWith(".vcf")) return "vcf";
		return undefined;
	}

	async addFromPath(
		absPath: string,
		alias?: string
	): Promise<LocalDatasetEntry | null> {
		try {
			// Sanity check
			const info = await electronAPI.getFileInfo(absPath);
			if (!info?.success || !info.data) return null;
			const { isDirectory } = info.data;

			const baseName = absPath.split(/[\\/]/).pop() || absPath;
			const id = this.computeIdFromPath(absPath);
			const defaultAlias = (alias || baseName).replace(/\s+/g, "_");

			const entry: LocalDatasetEntry = {
				id,
				title: baseName,
				source: "Local",
				description: isDirectory ? "Local data directory" : "Local data file",
				platform: "Local",
				organism: undefined,
				samples: undefined,
				url: undefined,
				localPath: absPath,
				isLocalDirectory: isDirectory,
				alias: defaultAlias,
			};

			// Try to infer file format and dataType
			const extFormat = !isDirectory
				? this.inferFileFormatFromName(baseName)
				: undefined;
			if (extFormat) {
				entry.fileFormat = extFormat;
			}

			// Best-effort type analysis using DatasetManager if this is a file
			try {
				if (!isDirectory) {
					const analysis = await this.datasetManager.analyzeFileType(absPath);
					entry.dataType = analysis.dataType;
					entry.fileFormat = entry.fileFormat || analysis.format;
				} else {
					// Heuristic: directory with matrix.mtx likely 10x matrix
					try {
						const listing = await electronAPI.listDirectory(absPath);
						if (listing?.success && Array.isArray(listing.data)) {
							const names = listing.data.map((x: any) => x.name.toLowerCase());
							if (
								names.includes("matrix.mtx") ||
								names.includes("features.tsv") ||
								names.includes("genes.tsv")
							) {
								entry.dataType = "single_cell_expression";
								entry.fileFormat = "10x_mtx";
							}
						}
					} catch (_) {}
				}
			} catch (_) {}

			// Ensure uniqueness (replace existing with same path id)
			const existingIdx = this.datasets.findIndex((d) => d.id === entry.id);
			if (existingIdx >= 0) {
				this.datasets[existingIdx] = entry;
			} else {
				this.datasets.push(entry);
			}
			await this.persist();
			return entry;
		} catch (error) {
			console.error("LocalDatasetRegistry:addFromPath error:", error);
			return null;
		}
	}

	async remove(id: string): Promise<void> {
		this.datasets = this.datasets.filter((d) => d.id !== id);
		await this.persist();
	}

	/**
	 * Resolve a token (without leading @) to matching datasets by alias or basename.
	 */
	resolveMention(token: string): LocalDatasetEntry[] {
		const norm = token.trim().toLowerCase();
		if (!norm) return [];
		return this.datasets.filter((d) => {
			const alias = (d.alias || "").toLowerCase();
			const base = (d.title || "").toLowerCase();
			return alias === norm || base === norm || base.includes(norm);
		});
	}
}
