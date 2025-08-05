// Search Limits
export const DEFAULT_SEARCH_LIMIT = 5;
export const MAX_SEARCH_LIMIT = 20;
export const MIN_SEARCH_LIMIT = 5;

// Batch Processing
export const DEFAULT_BATCH_SIZE = 1;
export const MAX_BATCH_SIZE = 2;

// API Rate Limiting
export const DEFAULT_REQUEST_INTERVAL = 0.1; // seconds
export const MIN_REQUEST_INTERVAL = 0.01; // seconds

// Search Multipliers
export const RETMAX_MULTIPLIER = 1; // retmax = limit * this

// Progress Update Intervals
export const PROGRESS_UPDATE_INTERVAL = 0.1; // seconds

// Search Strategy
export const MAX_SEARCH_ATTEMPTS = 2;
export const DEFAULT_ORGANISM = "Homo sapiens";

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
