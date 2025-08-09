// Search Limits
export const DEFAULT_SEARCH_LIMIT = 2;
export const MAX_SEARCH_LIMIT = 20;
export const MIN_SEARCH_LIMIT = 2;

// Batch Processing
export const DEFAULT_BATCH_SIZE = 1;
export const MAX_BATCH_SIZE = 2;

// API Rate Limiting
export const DEFAULT_REQUEST_INTERVAL = 0.05; // seconds
export const MIN_REQUEST_INTERVAL = 0.01; // seconds

// Search Multipliers
export const RETMAX_MULTIPLIER = 1; // retmax = limit * this

// Progress Update Intervals
export const PROGRESS_UPDATE_INTERVAL = 0.1; // seconds

// Search Strategy
export const MAX_SEARCH_ATTEMPTS = 2;
export const DEFAULT_ORGANISM = "Homo sapiens";

// Chat parsing keyword sets (centralized to avoid hardcoding in components)
export const SEARCH_KEYWORDS: string[] = [
	"search for datasets",
	"find datasets",
	"look for datasets",
	"search geo",
	"find geo datasets",
	"search sra",
	"find sra datasets",
	"search for data",
	"find data",
	"search biological databases",
	"find biological data",
];

export const ANALYSIS_KEYWORDS: string[] = [
	// General actions
	"analyze",
	"analysis",
	"assess",
	"evaluate",
	"examine",
	"investigate",
	"perform",
	"conduct",
	"run",
	"execute",
	"create",
	"generate",
	"plot",
	"visualize",
	// Methods and tasks
	"statistical",
	"differential",
	"differential expression",
	"clustering",
	"quality control",
	"exploratory",
	"visualization",
	"heatmap",
	"umap",
	"pca",
	"markers",
	"subtypes",
	"pathway",
	"enrichment",
	"correlation",
	"transcriptional",
	"gene expression",
	"single cell",
	"scrnaseq",
];

export const AMBIGUOUS_KEYWORDS: string[] = [
	"find",
	"search",
	"data",
	"dataset",
];

export const DATA_HINT_WORDS: string[] = [
	"cancer",
	"gene",
	"expression",
	"rna",
	"protein",
	"disease",
	"cell",
];

// Suggestion requests keywords
export const SUGGESTION_KEYWORDS: string[] = [
	"suggest",
	"help",
	"what can i",
	"recommend",
	"ideas",
	"options",
];

export class SearchConfig {
	/**
	 * Get the search limit, ensuring it's within bounds.
	 */
	static getSearchLimit(limit?: number): number {
		if (limit === undefined || limit === null) {
			return DEFAULT_SEARCH_LIMIT;
		}
		return Math.max(MIN_SEARCH_LIMIT, Math.min(limit, MAX_SEARCH_LIMIT));
	}

	/**
	 * Get the batch size, ensuring it's within bounds.
	 */
	static getBatchSize(batchSize?: number): number {
		if (batchSize === undefined || batchSize === null) {
			return DEFAULT_BATCH_SIZE;
		}
		return Math.max(1, Math.min(batchSize, MAX_BATCH_SIZE));
	}

	/**
	 * Calculate retmax based on limit.
	 */
	static getRetmax(limit: number): number {
		return limit * RETMAX_MULTIPLIER;
	}

	/**
	 * Get the request interval for rate limiting.
	 */
	static getRequestInterval(): number {
		return DEFAULT_REQUEST_INTERVAL;
	}
}
