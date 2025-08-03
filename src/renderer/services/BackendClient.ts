import axios from "axios";
import { SearchOrchestrator } from "./SearchOrchestrator";

export interface GEODataset {
	id: string;
	title: string;
	description?: string;
	organism?: string;
	url?: string;
	sample_count?: string;
	platform?: string;
	similarity_score?: number;
	source?: string;
	publication_date?: string;
	samples?: number;
	type?: string;
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
	private searchOrchestrator: SearchOrchestrator;
	private onProgress?: (progress: SearchProgress) => void;

	constructor(baseUrl: string = "http://localhost:8000") {
		this.baseUrl = baseUrl;
		this.searchOrchestrator = new SearchOrchestrator(this);
	}

	setProgressCallback(callback: (progress: SearchProgress) => void) {
		this.onProgress = callback;
		this.searchOrchestrator.setProgressCallback(callback);
	}

	getBaseUrl(): string {
		return this.baseUrl;
	}

	// Direct API methods - no business logic
	async searchDatasets(query: {
		query: string;
		limit?: number;
		organism?: string;
	}): Promise<GEODataset[]> {
		try {
			const response = await axios.post(`${this.baseUrl}/search`, {
				query: query.query,
				limit: query.limit || 50,
				organism: query.organism,
			});
			return response.data;
		} catch (error) {
			console.error("BackendClient: Error searching datasets:", error);
			throw error;
		}
	}

	// Streaming search with real-time progress updates
	async searchDatasetsStream(
		query: {
			query: string;
			limit?: number;
			organism?: string;
		},
		onProgress?: (progress: SearchProgress) => void,
		onResults?: (datasets: GEODataset[]) => void,
		onError?: (error: string) => void
	): Promise<GEODataset[]> {
		try {
			const response = await fetch(`${this.baseUrl}/search/stream`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					query: query.query,
					limit: query.limit || 50,
					organism: query.organism,
				}),
			});

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error("No response body");
			}

			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						try {
							const data = JSON.parse(line.slice(6));

							switch (data.type) {
								case "progress":
									if (onProgress) {
										onProgress({
											message: data.message,
											step: data.step,
											progress: data.progress,
											datasetsFound: data.datasetsFound,
										});
									}
									break;

								case "results":
									if (onResults) {
										onResults(data.datasets);
									}
									return data.datasets;

								case "error":
									if (onError) {
										onError(data.message);
									}
									throw new Error(data.message);
							}
						} catch (error) {
							console.error("Error parsing SSE data:", error);
						}
					}
				}
			}

			throw new Error("Stream ended without results");
		} catch (error) {
			console.error("BackendClient: Error in streaming search:", error);
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
			console.error("BackendClient: Error simplifying query:", error);
			// Fallback to original query if simplification fails
			return query;
		}
	}

	async generateSearchTerms(
		query: string,
		attempt: number = 1,
		isFirstAttempt: boolean = true
	): Promise<string[]> {
		try {
			const response = await axios.post(`${this.baseUrl}/llm/search-terms`, {
				query: query,
				attempt: attempt,
				is_first_attempt: isFirstAttempt,
			});
			return response.data.terms || [];
		} catch (error) {
			console.error("BackendClient: Error generating search terms:", error);
			// Fallback to basic term extraction
			return this.extractBasicTerms(query);
		}
	}

	async generateAlternativeSearchTerms(
		query: string,
		attempt: number
	): Promise<string[]> {
		try {
			const response = await axios.post(`${this.baseUrl}/llm/search-terms`, {
				query: query,
				attempt: attempt,
				is_first_attempt: false,
			});
			return response.data.terms || [];
		} catch (error) {
			console.error(
				"BackendClient: Error generating alternative search terms:",
				error
			);
			return [];
		}
	}

	async searchByGene(
		gene: string,
		organism?: string,
		limit: number = 50
	): Promise<GEODataset[]> {
		try {
			const url = organism
				? `${this.baseUrl}/search/gene/${gene}?organism=${organism}&limit=${limit}`
				: `${this.baseUrl}/search/gene/${gene}?limit=${limit}`;

			const response = await axios.get(url);
			return response.data;
		} catch (error) {
			console.error("BackendClient: Error searching by gene:", error);
			throw error;
		}
	}

	async searchByDisease(
		disease: string,
		limit: number = 50
	): Promise<GEODataset[]> {
		try {
			const response = await axios.get(
				`${this.baseUrl}/search/disease/${disease}?limit=${limit}`
			);
			return response.data;
		} catch (error) {
			console.error("BackendClient: Error searching by disease:", error);
			throw error;
		}
	}

	async generateCode(request: {
		task_description: string;
		language?: string;
		context?: string;
	}): Promise<string> {
		try {
			const response = await axios.post(`${this.baseUrl}/llm/code`, {
				task_description: request.task_description,
				language: request.language || "python",
				context: request.context,
			});
			return response.data.code;
		} catch (error) {
			console.error("BackendClient: Error generating code:", error);
			throw error;
		}
	}

	async validateCode(code: string): Promise<{
		is_valid: boolean;
		linted_code: string;
		errors: string[];
		warnings: string[];
	}> {
		try {
			const response = await axios.post(`${this.baseUrl}/llm/validate-code`, {
				code: code,
			});
			return response.data;
		} catch (error) {
			console.error("BackendClient: Error validating code:", error);
			throw error;
		}
	}

	async analyzeQuery(query: string): Promise<{
		intent: string;
		entities: string[];
		data_types: string[];
		analysis_type: string;
		complexity: string;
	}> {
		try {
			const response = await axios.post(`${this.baseUrl}/llm/analyze`, {
				query: query,
			});
			return response.data;
		} catch (error) {
			console.error("BackendClient: Error analyzing query:", error);
			throw error;
		}
	}

	async generatePlan(request: {
		question: string;
		context?: string;
		current_state?: any;
		available_data?: any[];
		task_type?: string;
	}): Promise<any> {
		try {
			const response = await axios.post(`${this.baseUrl}/llm/plan`, {
				question: request.question,
				context: request.context || "",
				current_state: request.current_state || {},
				available_data: request.available_data || [],
				task_type: request.task_type || "general",
			});
			return response.data;
		} catch (error) {
			console.error("BackendClient: Error generating plan:", error);
			throw error;
		}
	}

	// Business logic methods
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
		const result = await this.searchOrchestrator.discoverDatasets({
			query,
			organism: options?.organism,
			limit: options?.limit,
		});
		return result;
	}

	// Utility method for basic term extraction (fallback)
	private extractBasicTerms(query: string): string[] {
		// Simple fallback: extract key terms from query
		const terms = query
			.toLowerCase()
			.split(/\s+/)
			.filter(
				(term) =>
					term.length > 2 &&
					![
						"the",
						"and",
						"or",
						"for",
						"with",
						"in",
						"on",
						"at",
						"to",
						"of",
						"a",
						"an",
					].includes(term)
			)
			.slice(0, 3);

		return terms.length > 0 ? terms : [query];
	}
}
