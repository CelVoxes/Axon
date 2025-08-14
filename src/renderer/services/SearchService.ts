import { BackendClient } from "./BackendClient";
import { SearchProgress } from "./types";
import { GEODataset } from "../types/DatasetTypes";
import {
	deduplicateDatasets,
	prioritizeSearchTerms,
} from "../utils/SearchUtils";
import { MAX_SEARCH_ATTEMPTS } from "../config/SearchConfig";

export class SearchService {
	private backendClient: BackendClient;
	private onProgress?: (progress: SearchProgress) => void;

	constructor(backendClient: BackendClient) {
		this.backendClient = backendClient;
	}

	setProgressCallback(callback: (progress: SearchProgress) => void) {
		this.onProgress = callback;
	}

	private updateProgress(progress: SearchProgress) {
		if (this.onProgress) {
			this.onProgress(progress);
		}
	}

	async discoverDatasets(
		query: string,
		options?: { organism?: string; limit?: number }
	): Promise<{
		datasets: GEODataset[];
		query: string;
		suggestions: string[];
		searchType: string;
		formattedQuery?: string;
		extractedGenes?: string[];
		extractedDiseases?: string[];
		extractedIds?: string[];
		searchTerms?: string[];
		queryTransformation?: string;
		searchSteps?: string[];
	}> {
		try {
			const searchSteps: string[] = [];
			const usedSearchTerms: string[] = [];
			const maxAttempts = MAX_SEARCH_ATTEMPTS;
			let allDatasets: GEODataset[] = [];

			// Initial progress update
			this.updateProgress({
				message: "Starting dataset search...",
				step: "init",
				progress: 0,
			});

			searchSteps.push(`Processing query: "${query}"`);

			// Step 1: Simplify the query using LLM (only if query is complex)
			const isComplexQuery =
				query.length > 50 ||
				(query.includes(" ") && query.split(" ").length > 5);

			let simplifiedQuery = query;
			if (isComplexQuery) {
				this.updateProgress({
					message: "Simplifying complex query...",
					step: "simplify",
					progress: 10,
				});

				try {
					simplifiedQuery = await this.backendClient.simplifyQuery(query);
					searchSteps.push(`Simplified query: "${simplifiedQuery}"`);
				} catch (error) {
					console.warn("Failed to simplify query, using original:", error);
					simplifiedQuery = query;
				}
			}

			// Step 2: Generate search terms
			this.updateProgress({
				message: "Generating search terms...",
				step: "terms",
				progress: 20,
			});

			const searchTerms = await this.backendClient.generateSearchTerms(
				simplifiedQuery,
				1,
				true
			);
			usedSearchTerms.push(...searchTerms);
			searchSteps.push(`Generated terms: ${searchTerms.join(", ")}`);

			// Step 3: Execute searches with different strategies
			const processedTerms = new Set<string>();
			for (let attempt = 0; attempt < maxAttempts; attempt++) {
				const progress = 20 + (attempt * 60) / maxAttempts;
				this.updateProgress({
					message: `Search attempt ${attempt + 1}/${maxAttempts}...`,
					step: "search",
					progress: Math.round(progress),
				});

				const currentTerms =
					attempt === 0
						? searchTerms.slice(0, 1)
						: (
								await this.backendClient.generateSearchTerms(
									simplifiedQuery,
									attempt + 1,
									false
								)
						  ).slice(0, 1);

				for (const term of currentTerms) {
					// Avoid sending duplicate requests for the same term across attempts
					if (processedTerms.has(term)) {
						continue;
					}
					processedTerms.add(term);
					this.updateProgress({
						message: `Searching for: ${term}`,
						step: "search",
						progress: Math.round(progress),
						currentTerm: term,
					});

					try {
						// Prefer streaming endpoint for better progress updates
						const datasets = await this.backendClient.searchDatasetsStream(
							{
								query: term,
								limit: options?.limit || 20,
								organism: options?.organism,
							},
							this.onProgress
						);

						allDatasets.push(...datasets);
						usedSearchTerms.push(term);
					} catch (error) {
						console.warn(`Failed to search for term "${term}":`, error);
					}
				}

				// Check if we have enough results
				if (allDatasets.length >= (options?.limit || 10)) {
					break;
				}
			}

			// Step 4: Deduplicate and prioritize results
			this.updateProgress({
				message: "Processing results...",
				step: "process",
				progress: 90,
			});

			const uniqueDatasets = deduplicateDatasets(allDatasets);
			const prioritizedTerms = prioritizeSearchTerms(usedSearchTerms, query);

			this.updateProgress({
				message: `Found ${uniqueDatasets.length} datasets`,
				step: "complete",
				progress: 100,
				datasetsFound: uniqueDatasets.length,
			});

			return {
				datasets: uniqueDatasets,
				query: query,
				suggestions: prioritizedTerms,
				searchType: "orchestrated",
				formattedQuery: simplifiedQuery,
				searchTerms: usedSearchTerms,
				queryTransformation:
					simplifiedQuery !== query ? "simplified" : "original",
				searchSteps: searchSteps,
			};
		} catch (error) {
			console.error("BackendClient: Error in discoverDatasets:", error);
			throw error;
		}
	}

	// Removed local deduplicate/prioritize in favor of shared utils
}
