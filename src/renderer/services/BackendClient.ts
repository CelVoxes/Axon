import axios from "axios";

export interface GEODataset {
	id: string;
	title: string;
	description?: string;
	organism?: string;
	url?: string;
}

export interface SearchProgress {
	message: string;
	step: string;
	progress: number; // 0-100
	datasetsFound?: number;
	currentTerm?: string;
}

export class BackendClient {
	private baseUrl: string;
	private onProgress?: (progress: SearchProgress) => void;

	constructor(baseUrl: string = "http://localhost:8000") {
		this.baseUrl = baseUrl;
	}

	setProgressCallback(callback: (progress: SearchProgress) => void) {
		this.onProgress = callback;
	}

	getBaseUrl(): string {
		return this.baseUrl;
	}

	private updateProgress(progress: SearchProgress) {
		if (this.onProgress) {
			this.onProgress(progress);
		}
	}

	async searchDatasets(query: {
		query: string;
		limit?: number;
		organism?: string;
	}): Promise<GEODataset[]> {
		try {
			const response = await axios.post(`${this.baseUrl}/search`, {
				query: query.query,
				limit: query.limit || 10,
				organism: query.organism,
			});
			return response.data;
		} catch (error) {
			console.error("Error searching datasets:", error);
			throw error;
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
			const maxAttempts = 3;
			let allDatasets: GEODataset[] = [];

			// Initial progress update
			this.updateProgress({
				message: "Starting dataset search...",
				step: "init",
				progress: 0,
			});

			searchSteps.push(`Processing query: "${query}"`);

			// Step 1: Simplify the query using LLM
			this.updateProgress({
				message: "Simplifying your query with AI...",
				step: "simplify",
				progress: 10,
			});

			searchSteps.push("Simplifying query with LLM...");
			const simplifiedQuery = await this.simplifyQuery(query);
			searchSteps.push(`Simplified query: "${simplifiedQuery}"`);

			this.updateProgress({
				message: `Query simplified to: "${simplifiedQuery}"`,
				step: "simplified",
				progress: 20,
			});

			// Step 2: Search with the simplified query
			this.updateProgress({
				message: "Searching databases with simplified query...",
				step: "search",
				progress: 30,
				currentTerm: simplifiedQuery,
			});

			searchSteps.push("Searching with simplified query...");
			let searchResponse = await this.searchDatasets({
				query: simplifiedQuery,
				limit: options?.limit || 10,
				organism: options?.organism,
			});

			searchSteps.push(
				`Found ${searchResponse.length} datasets for "${simplifiedQuery}"`
			);
			allDatasets.push(...searchResponse);
			usedSearchTerms.push(simplifiedQuery);

			this.updateProgress({
				message: `Found ${searchResponse.length} datasets for "${simplifiedQuery}"`,
				step: "initial_results",
				progress: 50,
				datasetsFound: searchResponse.length,
			});

			// Step 3: If we don't have enough results, try alternative search terms
			if (searchResponse.length < (options?.limit || 10) && maxAttempts > 1) {
				this.updateProgress({
					message: "Need more results, generating alternative search terms...",
					step: "fallback",
					progress: 60,
				});

				searchSteps.push(
					"Not enough results, trying alternative search terms..."
				);

				for (let attempt = 2; attempt <= maxAttempts; attempt++) {
					searchSteps.push(
						`Attempt ${attempt}: Generating alternative search terms...`
					);

					// Generate alternative search terms using LLM
					const alternativeTerms = await this.generateAlternativeSearchTerms(
						query,
						attempt
					);
					searchSteps.push(`Generated terms: ${alternativeTerms.join(", ")}`);

					// Try each alternative term
					for (const term of alternativeTerms) {
						if (allDatasets.length >= (options?.limit || 10)) {
							break; // We have enough results
						}

						searchSteps.push(`Searching for: "${term}"`);

						// Update progress for individual term search
						this.updateProgress({
							message: `Searching for: "${term}"`,
							step: "search",
							progress: 60 + (attempt - 2) * 10,
							currentTerm: term,
						});

						try {
							const termResults = await this.searchDatasets({
								query: term,
								limit: Math.ceil(
									(options?.limit || 10) / alternativeTerms.length
								),
								organism: options?.organism,
							});

							if (termResults.length > 0) {
								searchSteps.push(
									`Found ${termResults.length} datasets for "${term}"`
								);

								// Update progress with results
								this.updateProgress({
									message: `Found ${termResults.length} datasets for "${term}"`,
									step: "search_results",
									progress: 60 + (attempt - 2) * 10 + 5,
									currentTerm: term,
									datasetsFound: termResults.length,
								});

								allDatasets.push(...termResults);
								usedSearchTerms.push(term);
							} else {
								searchSteps.push(`No datasets found for "${term}"`);

								// Update progress for no results
								this.updateProgress({
									message: `No datasets found for "${term}"`,
									step: "search_no_results",
									progress: 60 + (attempt - 2) * 10 + 5,
									currentTerm: term,
									datasetsFound: 0,
								});
							}
						} catch (error) {
							searchSteps.push(`Search failed for "${term}"`);

							// Update progress for search error
							this.updateProgress({
								message: `Search failed for "${term}"`,
								step: "search_error",
								progress: 60 + (attempt - 2) * 10 + 5,
								currentTerm: term,
								datasetsFound: 0,
							});
						}
					}

					// If we found some results, we can be more selective about continuing
					if (
						allDatasets.length > 0 &&
						allDatasets.length >= Math.ceil((options?.limit || 10) / 2)
					) {
						searchSteps.push("Found sufficient results, stopping search");
						break;
					}
				}
			}

			// Remove duplicates and limit results
			this.updateProgress({
				message: "Removing duplicates and finalizing results...",
				step: "deduplicate",
				progress: 95,
			});

			const uniqueDatasets = allDatasets.filter(
				(dataset, index, self) =>
					index === self.findIndex((d) => d.id === dataset.id)
			);

			const limitedDatasets = uniqueDatasets.slice(0, options?.limit || 10);
			searchSteps.push(
				`Final result: ${limitedDatasets.length} unique datasets`
			);

			this.updateProgress({
				message: `Search complete! Found ${limitedDatasets.length} unique datasets`,
				step: "complete",
				progress: 100,
				datasetsFound: limitedDatasets.length,
			});

			return {
				datasets: limitedDatasets,
				query: query,
				suggestions: [
					"Try different keywords",
					"Use more specific terms",
					"Check spelling",
				],
				searchType: "simplified_search_with_fallback",
				formattedQuery: simplifiedQuery,
				extractedGenes: [],
				extractedDiseases: [],
				extractedIds: [],
				searchTerms: usedSearchTerms,
				queryTransformation: `Original: "${query}" → Simplified: "${simplifiedQuery}" → Additional terms: ${usedSearchTerms
					.slice(1)
					.join(", ")}`,
				searchSteps: searchSteps,
			};
		} catch (error) {
			console.error("Error searching datasets:", error);
			this.updateProgress({
				message: `Search failed: ${error}`,
				step: "error",
				progress: 100,
			});
			throw error;
		}
	}

	async simplifyQuery(query: string): Promise<string> {
		try {
			const response = await axios.post(`${this.baseUrl}/llm/simplify`, {
				query: query,
			});
			return response.data.simplified_query;
		} catch (error) {
			console.error("Error simplifying query:", error);
			// Fallback to original query if simplification fails
			return query;
		}
	}

	async generateAlternativeSearchTerms(
		query: string,
		attempt: number
	): Promise<string[]> {
		try {
			// Use the LLM search endpoint to generate alternative terms
			const response = await axios.post(`${this.baseUrl}/search/llm`, {
				query: query,
				limit: 5,
				max_attempts: 1,
			});

			// Extract search terms from the response
			const searchTerms = response.data.search_terms || [];

			// If no terms were generated, fallback to basic extraction
			if (searchTerms.length === 0) {
				return this.extractBasicTerms(query);
			}

			// Prioritize disease-specific terms over generic technical terms
			const prioritizedTerms = this.prioritizeSearchTerms(searchTerms, query);
			return prioritizedTerms.slice(0, 3); // Limit to 3 alternative terms
		} catch (error) {
			console.error("Error generating alternative search terms:", error);
			// Fallback to basic term extraction
			return this.extractBasicTerms(query);
		}
	}

	private prioritizeSearchTerms(
		terms: string[],
		originalQuery: string
	): string[] {
		// Extract disease-like patterns from original query
		const diseasePatterns = [
			/\b[A-Z][A-Z-]+\b/g, // ALL, B-ALL, AML, etc.
			/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, // Breast Cancer, etc.
			/\bcancer\b/gi,
			/\bleukemia\b/gi,
			/\blymphoma\b/gi,
			/\bdiabetes\b/gi,
			/\bheart\b/gi,
			/\blung\b/gi,
			/\bbrain\b/gi,
			/\bliver\b/gi,
			/\bkidney\b/gi,
		];

		const originalDiseases = new Set<string>();
		diseasePatterns.forEach((pattern) => {
			const matches = originalQuery.match(pattern);
			if (matches) {
				matches.forEach((match) => originalDiseases.add(match.toLowerCase()));
			}
		});

		// Separate terms into disease-specific and generic
		const diseaseSpecific: string[] = [];
		const generic: string[] = [];

		terms.forEach((term) => {
			const termLower = term.toLowerCase();
			const hasDisease = Array.from(originalDiseases).some(
				(disease) => termLower.includes(disease) || disease.includes(termLower)
			);

			if (hasDisease) {
				diseaseSpecific.push(term);
			} else {
				generic.push(term);
			}
		});

		// Return disease-specific terms first, then generic terms
		return [...diseaseSpecific, ...generic];
	}

	private extractBasicTerms(query: string): string[] {
		// Simple fallback method to extract basic terms
		const terms: string[] = [];

		// Extract GEO IDs if present
		const geoIds = query.match(/GSE\d+/g) || [];
		terms.push(...geoIds);

		// Extract disease-like terms (patterns that look like disease names)
		const diseasePatterns = [
			/\b[A-Z][A-Z-]+\b/g, // ALL, B-ALL, AML, etc.
			/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, // Breast Cancer, etc.
			/\bcancer\b/gi,
			/\bleukemia\b/gi,
			/\blymphoma\b/gi,
			/\bdiabetes\b/gi,
			/\bheart\b/gi,
			/\blung\b/gi,
			/\bbrain\b/gi,
			/\bliver\b/gi,
			/\bkidney\b/gi,
		];

		const diseaseTerms: string[] = [];
		diseasePatterns.forEach((pattern) => {
			const matches = query.match(pattern);
			if (matches) {
				diseaseTerms.push(...matches);
			}
		});

		// Extract technical/biological terms
		const technicalPatterns = [
			/\btranscriptional\b/gi,
			/\bexpression\b/gi,
			/\bsubtypes\b/gi,
			/\bclustering\b/gi,
			/\bbiomarkers\b/gi,
			/\bgenes\b/gi,
			/\bRNA\b/gi,
			/\bDNA\b/gi,
			/\bprotein\b/gi,
			/\bsequencing\b/gi,
			/\bmicroarray\b/gi,
			/\banalysis\b/gi,
			/\bdata\b/gi,
		];

		const techTerms: string[] = [];
		technicalPatterns.forEach((pattern) => {
			const matches = query.match(pattern);
			if (matches) {
				techTerms.push(...matches);
			}
		});

		// Extract meaningful words (4+ characters, not common words)
		const commonWords = new Set([
			"can",
			"you",
			"find",
			"me",
			"the",
			"different",
			"of",
			"in",
			"on",
			"at",
			"to",
			"for",
			"with",
			"by",
			"from",
			"this",
			"that",
			"these",
			"those",
			"what",
			"when",
			"where",
			"why",
			"how",
			"which",
			"who",
			"whose",
			"whom",
			"please",
			"show",
			"get",
			"want",
			"need",
			"would",
			"could",
			"should",
			"will",
			"may",
			"might",
			"must",
			"shall",
		]);

		const words = query
			.replace(/[^\w\s]/g, " ")
			.split(/\s+/)
			.filter(
				(word) => word.length >= 4 && !commonWords.has(word.toLowerCase())
			);

		// Prioritize disease terms, then technical terms, then other words
		const result = [...geoIds, ...diseaseTerms, ...techTerms, ...words];

		// Remove duplicates while preserving order
		const seen = new Set<string>();
		const uniqueResult: string[] = [];
		for (const term of result) {
			if (!seen.has(term.toLowerCase())) {
				uniqueResult.push(term);
				seen.add(term.toLowerCase());
			}
		}

		return uniqueResult.slice(0, 5);
	}
}
