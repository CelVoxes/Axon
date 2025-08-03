import { GEODataset, SearchProgress, BackendClient } from "./BackendClient";
import { SearchConfig, MAX_SEARCH_ATTEMPTS } from "../config/SearchConfig";

export interface SearchOrchestrationRequest {
	query: string;
	organism?: string;
	limit?: number;
}

export interface SearchOrchestrationResult {
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
}

export class SearchOrchestrator {
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
		request: SearchOrchestrationRequest
	): Promise<SearchOrchestrationResult> {
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

			searchSteps.push(`Processing query: "${request.query}"`);

			// Step 1: Simplify the query using LLM (only if query is complex)
			const isComplexQuery =
				request.query.length > 50 ||
				(request.query.includes(" ") && request.query.split(" ").length > 5);

			let simplifiedQuery = request.query;
			if (isComplexQuery) {
				this.updateProgress({
					message: "Simplifying complex query...",
					step: "simplify",
					progress: 10,
				});

				try {
					simplifiedQuery = await this.backendClient.simplifyQuery(
						request.query
					);
					searchSteps.push(`Simplified query: "${simplifiedQuery}"`);
				} catch (error) {
					console.warn("Failed to simplify query, using original:", error);
					simplifiedQuery = request.query;
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
				const currentProgress = 30 + attempt * 35; // More spread out progress
				this.updateProgress({
					message: `Searching with strategy ${attempt + 1}/${maxAttempts}...`,
					step: `search_${attempt + 1}`,
					progress: currentProgress,
					currentTerm: usedSearchTerms[attempt] || simplifiedQuery,
				});

				try {
					// Update progress before starting search
					this.updateProgress({
						message: `Executing search strategy ${
							attempt + 1
						}/${maxAttempts}...`,
						step: `search_${attempt + 1}`,
						progress: currentProgress + 5,
						currentTerm: usedSearchTerms[attempt] || simplifiedQuery,
					});

					// Small delay to make progress visible
					await new Promise((resolve) => setTimeout(resolve, 200));

					// Real progress updates will come from the backend stream
					const datasets = await this.backendClient.searchDatasetsStream(
						{
							query: usedSearchTerms[attempt] || simplifiedQuery,
							limit: SearchConfig.getSearchLimit(request.limit),
							organism: request.organism,
						},
						(progress) => {
							// Forward progress updates from backend
							this.updateProgress({
								message: progress.message,
								step: progress.step,
								progress: progress.progress,
								datasetsFound: progress.datasetsFound,
								currentTerm: usedSearchTerms[attempt] || simplifiedQuery,
							});
						}
					);

					// Small delay to make progress visible
					await new Promise((resolve) => setTimeout(resolve, 300));

					// Update progress after search completes
					this.updateProgress({
						message: `Strategy ${attempt + 1} completed, found ${
							datasets.length
						} datasets`,
						step: `search_${attempt + 1}_complete`,
						progress: currentProgress + 25,
						currentTerm: usedSearchTerms[attempt] || simplifiedQuery,
						datasetsFound: datasets.length,
					});

					allDatasets.push(...datasets);
					searchSteps.push(
						`Strategy ${attempt + 1} found ${datasets.length} datasets`
					);

					// If we found enough datasets, we can stop
					if (allDatasets.length >= (request.limit || 50)) {
						break;
					}
				} catch (error) {
					console.warn(`Search strategy ${attempt + 1} failed:`, error);
					searchSteps.push(`Strategy ${attempt + 1} failed: ${error}`);
				}

				// Generate alternative terms for next attempt
				if (attempt < maxAttempts - 1) {
					try {
						const alternativeTerms =
							await this.backendClient.generateAlternativeSearchTerms(
								simplifiedQuery,
								attempt + 2
							);
						usedSearchTerms.push(...alternativeTerms);
					} catch (error) {
						console.warn("Failed to generate alternative terms:", error);
					}
				}
			}

			// Step 4: Deduplicate and limit results
			this.updateProgress({
				message: "Processing results...",
				step: "process",
				progress: 90,
			});

			const uniqueDatasets = this.deduplicateDatasets(allDatasets);
			const limitedDatasets = uniqueDatasets.slice(0, request.limit || 50);

			searchSteps.push(
				`Final results: ${limitedDatasets.length} unique datasets from ${allDatasets.length} total`
			);

			// Final progress update
			this.updateProgress({
				message: `Search complete! Found ${limitedDatasets.length} unique datasets`,
				step: "complete",
				progress: 100,
				datasetsFound: limitedDatasets.length,
			});

			return {
				datasets: limitedDatasets,
				query: request.query,
				suggestions: [
					"Try different keywords",
					"Use more specific terms",
					"Check spelling",
				],
				searchType: isComplexQuery
					? "simplified_search_with_fallback"
					: "direct_search_with_fallback",
				formattedQuery: isComplexQuery ? usedSearchTerms[0] : request.query,
				extractedGenes: [],
				extractedDiseases: [],
				extractedIds: [],
				searchTerms: usedSearchTerms,
				queryTransformation: isComplexQuery
					? `Original: "${request.query}" → Simplified: "${
							usedSearchTerms[0]
					  }" → Additional terms: ${usedSearchTerms.slice(1).join(", ")}`
					: `Original: "${request.query}" → Additional terms: ${usedSearchTerms
							.slice(1)
							.join(", ")}`,
				searchSteps: searchSteps,
			};
		} catch (error) {
			console.error("SearchOrchestrator: Error searching datasets:", error);
			this.updateProgress({
				message: `Search failed: ${error}`,
				step: "error",
				progress: 100,
			});
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
