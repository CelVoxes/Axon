import { BackendClient, GEODataset, SearchProgress } from "./BackendClient";
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
			for (let attempt = 0; attempt < maxAttempts; attempt++) {
				const progress = 20 + (attempt * 60) / maxAttempts;
				this.updateProgress({
					message: `Search attempt ${attempt + 1}/${maxAttempts}...`,
					step: "search",
					progress: Math.round(progress),
				});

				const currentTerms =
					attempt === 0
						? searchTerms
						: await this.backendClient.generateAlternativeSearchTerms(
								simplifiedQuery,
								attempt + 1
						  );

				for (const term of currentTerms) {
					this.updateProgress({
						message: `Searching for: ${term}`,
						step: "search",
						progress: Math.round(progress),
						currentTerm: term,
					});

					try {
						const datasets = await this.backendClient.searchDatasets({
							query: term,
							limit: options?.limit || 20,
							organism: options?.organism,
						});

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

			const uniqueDatasets = this.deduplicateDatasets(allDatasets);
			const prioritizedTerms = this.prioritizeSearchTerms(
				usedSearchTerms,
				query
			);

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

    private deduplicateDatasets(datasets: GEODataset[]): GEODataset[] {
		const seen = new Set<string>();
		return datasets.filter((dataset) => {
			if (seen.has(dataset.id)) {
				return false;
			}
			seen.add(dataset.id);
			return true;
		});
	}

	private prioritizeSearchTerms(
		terms: string[],
		originalQuery: string
	): string[] {
		// Simple prioritization: prefer terms that appear in the original query
		const originalLower = originalQuery.toLowerCase();
		return terms.sort((a, b) => {
			const aInOriginal = originalLower.includes(a.toLowerCase());
			const bInOriginal = originalLower.includes(b.toLowerCase());

			if (aInOriginal && !bInOriginal) return -1;
			if (!aInOriginal && bInOriginal) return 1;

			// If both or neither are in original, prefer shorter terms (more specific)
			return a.length - b.length;
		});
	}
}