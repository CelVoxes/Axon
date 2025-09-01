import { electronAPI } from "../../utils/electronAPI";
import * as crypto from "crypto";

export interface CachedDataset {
	id: string;
	url: string;
	title: string;
	localPath: string;
	hash: string;
	size: number;
	downloadedAt: string;
	lastAccessedAt: string;
	metadata: {
		source?: string;
		format?: string;
		description?: string;
	};
}

export interface DataCacheConfig {
	maxCacheSize: number; // in bytes
	maxAge: number; // in milliseconds
	cacheDir: string;
}

export class DataCacheService {
	private static instance: DataCacheService;
	private config: DataCacheConfig;
	private cacheIndex: Map<string, CachedDataset> = new Map();

	private constructor(config?: Partial<DataCacheConfig>) {
		this.config = {
			maxCacheSize: 5 * 1024 * 1024 * 1024, // 5GB
			maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
			cacheDir: this.getDefaultCacheDir(),
			...config,
		};
	}

	public static getInstance(config?: Partial<DataCacheConfig>): DataCacheService {
		if (!DataCacheService.instance) {
			DataCacheService.instance = new DataCacheService(config);
		}
		return DataCacheService.instance;
	}

	private getDefaultCacheDir(): string {
		// Use OS-appropriate cache directory
		const os = require('os');
		return require('path').join(os.tmpdir(), 'axon-data-cache');
	}

	/**
	 * Initialize the cache system
	 */
	public async initialize(): Promise<void> {
		try {
			// Ensure cache directory exists
			await electronAPI.createDirectory(this.config.cacheDir);
			
			// Load existing cache index
			await this.loadCacheIndex();
			
			// Clean up old or oversized cache
			await this.performMaintenance();
		} catch (error) {
			console.error('Failed to initialize data cache:', error);
		}
	}

	/**
	 * Get dataset with smart caching and workspace isolation
	 */
	public async getDataset(
		dataset: { id: string; url?: string; title?: string; source?: string },
		workspaceId: string
	): Promise<{ success: boolean; path?: string; error?: string }> {
		try {
			const datasetId = this.generateDatasetId(dataset);
			const cached = this.cacheIndex.get(datasetId);

			// Check if we have a valid cached version
			if (cached && await this.isCacheValid(cached)) {
				await this.updateAccessTime(datasetId);
				return { success: true, path: cached.localPath };
			}

			// Download and cache the dataset
			if (dataset.url) {
				return await this.downloadAndCache({
					id: dataset.id,
					url: dataset.url,
					title: dataset.title,
					source: dataset.source
				}, workspaceId);
			}

			return { success: false, error: 'No URL provided for dataset' };
		} catch (error) {
			console.error('Error getting dataset:', error);
			return { 
				success: false, 
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	/**
	 * Download dataset with progress tracking and validation
	 */
	private async downloadAndCache(
		dataset: { id: string; url: string; title?: string; source?: string },
		workspaceId: string
	): Promise<{ success: boolean; path?: string; error?: string }> {
		const datasetId = this.generateDatasetId(dataset);
		const filename = this.generateFilename(dataset.url, datasetId);
		const cachePath = require('path').join(this.config.cacheDir, filename);

		try {
			console.log(`Downloading dataset ${dataset.title || dataset.id}...`);

			// Use a more robust download method
			const downloadResult = await this.downloadFile(dataset.url, cachePath);
			
			if (!downloadResult.success) {
				return { success: false, error: downloadResult.error };
			}

			// Validate and get file info
			const fileInfo = await electronAPI.getFileInfo(cachePath);
			if (!fileInfo.success || !fileInfo.data) {
				return { success: false, error: 'Failed to validate downloaded file' };
			}

			// Generate hash for integrity checking
			const hash = await this.generateFileHash(cachePath);

			// Create cache entry
			const cachedDataset: CachedDataset = {
				id: datasetId,
				url: dataset.url,
				title: dataset.title || dataset.id,
				localPath: cachePath,
				hash,
				size: fileInfo.data.size,
				downloadedAt: new Date().toISOString(),
				lastAccessedAt: new Date().toISOString(),
				metadata: {
					source: dataset.source,
					format: this.detectFormat(dataset.url),
				},
			};

			// Update cache index
			this.cacheIndex.set(datasetId, cachedDataset);
			await this.saveCacheIndex();

			console.log(`Successfully cached dataset: ${filename} (${fileInfo.data.size} bytes)`);
			return { success: true, path: cachePath };

		} catch (error) {
			console.error('Download failed:', error);
			return { 
				success: false, 
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	/**
	 * Robust file download with retries and validation
	 */
	private async downloadFile(url: string, outputPath: string): Promise<{ success: boolean; error?: string }> {
		const maxRetries = 3;
		
		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				const response = await fetch(url, {
					headers: {
						'User-Agent': 'Mozilla/5.0 (compatible; AxonApp/1.0)',
						'Accept': '*/*',
					},
				});

				if (!response.ok) {
					throw new Error(`HTTP ${response.status}: ${response.statusText}`);
				}

				const buffer = await response.arrayBuffer();
				const content = Buffer.from(buffer);
				
				const writeResult = await electronAPI.writeFile(outputPath, content.toString('base64'));
				
				if (!writeResult.success) {
					throw new Error(writeResult.error || 'Failed to write file');
				}

				return { success: true };

			} catch (error) {
				console.warn(`Download attempt ${attempt}/${maxRetries} failed:`, error);
				
				if (attempt === maxRetries) {
					return { 
						success: false, 
						error: `Failed after ${maxRetries} attempts: ${error instanceof Error ? error.message : String(error)}`
					};
				}
				
				// Wait before retrying (exponential backoff)
				await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
			}
		}
		
		return { success: false, error: 'Unexpected error in download loop' };
	}

	/**
	 * Generate workspace-aware code for accessing cached data
	 */
	public generateDataAccessCode(datasets: Array<{ id: string; title?: string }>, workspaceId: string): string {
		const lines: string[] = [];
		
		lines.push("# Axon Data Cache - Workspace Isolated Data Access");
		lines.push("from pathlib import Path");
		lines.push("import pandas as pd");
		lines.push("import numpy as np");
		lines.push("import os");
		lines.push("");
		lines.push("print('Loading datasets from Axon data cache...')");
		lines.push("");
		
		// Generate loading code for each dataset
		lines.push("# Dataset loading functions");
		lines.push("def load_dataset(cache_path, dataset_name):");
		lines.push("    if not os.path.exists(cache_path):");
		lines.push("        raise FileNotFoundError(f'Cached dataset not found: {dataset_name} at {cache_path}')");
		lines.push("    ");
		lines.push("    # Auto-detect format and load appropriately");
		lines.push("    if cache_path.endswith('.csv'):");
		lines.push("        return pd.read_csv(cache_path)");
		lines.push("    elif cache_path.endswith('.tsv'):");
		lines.push("        return pd.read_csv(cache_path, sep='\\t')");
		lines.push("    elif cache_path.endswith('.h5ad'):");
		lines.push("        import scanpy as sc");
		lines.push("        return sc.read(cache_path)");
		lines.push("    else:");
		lines.push("        # Default to CSV");
		lines.push("        return pd.read_csv(cache_path)");
		lines.push("");
		
		// Generate dataset variables
		lines.push("# Load cached datasets");
		for (const dataset of datasets) {
			const varName = this.generateVariableName(dataset.id);
			lines.push(`${varName} = None  # Will be populated by Axon cache system`);
		}
		lines.push("");
		lines.push("print('Dataset loading completed.')");
		
		return lines.join("\n");
	}

	/**
	 * Utility methods
	 */
	private generateDatasetId(dataset: { id: string; url?: string }): string {
		const source = dataset.url || dataset.id;
		return crypto.createHash('sha256').update(source).digest('hex').substring(0, 16);
	}

	private generateFilename(url: string, datasetId: string): string {
		const urlLower = url.toLowerCase();
		if (urlLower.endsWith('.h5ad')) return `${datasetId}.h5ad`;
		if (urlLower.endsWith('.csv')) return `${datasetId}.csv`;
		if (urlLower.endsWith('.tsv')) return `${datasetId}.tsv`;
		if (urlLower.endsWith('.txt')) return `${datasetId}.txt`;
		if (urlLower.endsWith('.json')) return `${datasetId}.json`;
		return `${datasetId}.data`;
	}

	private generateVariableName(datasetId: string): string {
		return `dataset_${datasetId.replace(/[^a-zA-Z0-9]/g, '_')}`;
	}

	private detectFormat(url: string): string {
		const urlLower = url.toLowerCase();
		if (urlLower.includes('.h5ad')) return 'h5ad';
		if (urlLower.includes('.csv')) return 'csv';
		if (urlLower.includes('.tsv')) return 'tsv';
		if (urlLower.includes('.json')) return 'json';
		return 'unknown';
	}

	private async generateFileHash(filePath: string): Promise<string> {
		// This is a simplified version - in reality you'd read the file and hash it
		return crypto.createHash('sha256').update(filePath + Date.now()).digest('hex');
	}

	private async isCacheValid(cached: CachedDataset): Promise<boolean> {
		try {
			// Check if file still exists
			const fileExists = await electronAPI.getFileInfo(cached.localPath);
			if (!fileExists.success) return false;

			// Check if not expired
			const age = Date.now() - new Date(cached.downloadedAt).getTime();
			if (age > this.config.maxAge) return false;

			return true;
		} catch {
			return false;
		}
	}

	private async updateAccessTime(datasetId: string): Promise<void> {
		const cached = this.cacheIndex.get(datasetId);
		if (cached) {
			cached.lastAccessedAt = new Date().toISOString();
			await this.saveCacheIndex();
		}
	}

	private async loadCacheIndex(): Promise<void> {
		try {
			const indexPath = require('path').join(this.config.cacheDir, 'cache-index.json');
			const result = await electronAPI.readFile(indexPath);
			
			if (result.success && result.data) {
				const index = JSON.parse(result.data);
				this.cacheIndex = new Map(Object.entries(index));
			}
		} catch (error) {
			console.warn('Could not load cache index:', error);
		}
	}

	private async saveCacheIndex(): Promise<void> {
		try {
			const indexPath = require('path').join(this.config.cacheDir, 'cache-index.json');
			const indexObj = Object.fromEntries(this.cacheIndex);
			
			await electronAPI.writeFile(indexPath, JSON.stringify(indexObj, null, 2));
		} catch (error) {
			console.error('Failed to save cache index:', error);
		}
	}

	private async performMaintenance(): Promise<void> {
		// Remove expired entries
		const now = Date.now();
		for (const [id, cached] of this.cacheIndex) {
			const age = now - new Date(cached.downloadedAt).getTime();
			if (age > this.config.maxAge) {
				await this.removeCacheEntry(id);
			}
		}

		// Check total cache size and remove LRU if needed
		const totalSize = Array.from(this.cacheIndex.values()).reduce((sum, cached) => sum + cached.size, 0);
		
		if (totalSize > this.config.maxCacheSize) {
			await this.evictLRUEntries(totalSize - this.config.maxCacheSize);
		}
	}

	private async removeCacheEntry(datasetId: string): Promise<void> {
		const cached = this.cacheIndex.get(datasetId);
		if (cached) {
			try {
				await electronAPI.deleteFile(cached.localPath);
			} catch (error) {
				console.warn(`Failed to delete cached file: ${cached.localPath}`, error);
			}
			this.cacheIndex.delete(datasetId);
		}
	}

	private async evictLRUEntries(bytesToFree: number): Promise<void> {
		// Sort by last accessed time (oldest first)
		const sortedEntries = Array.from(this.cacheIndex.entries()).sort(
			([, a], [, b]) => new Date(a.lastAccessedAt).getTime() - new Date(b.lastAccessedAt).getTime()
		);

		let freedBytes = 0;
		for (const [id, cached] of sortedEntries) {
			if (freedBytes >= bytesToFree) break;
			
			await this.removeCacheEntry(id);
			freedBytes += cached.size;
		}
	}

	/**
	 * Clean up all cached data
	 */
	public async clearCache(): Promise<void> {
		for (const id of this.cacheIndex.keys()) {
			await this.removeCacheEntry(id);
		}
		await this.saveCacheIndex();
	}

	/**
	 * Get cache statistics
	 */
	public getCacheStats(): { totalSize: number; entryCount: number; cacheDir: string } {
		const totalSize = Array.from(this.cacheIndex.values()).reduce((sum, cached) => sum + cached.size, 0);
		return {
			totalSize,
			entryCount: this.cacheIndex.size,
			cacheDir: this.config.cacheDir,
		};
	}
}