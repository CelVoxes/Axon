import axios from "axios";
import { SearchConfig, MAX_SEARCH_ATTEMPTS } from "../config/SearchConfig";
import { IBackendClient } from "./types";

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

export class BackendClient implements IBackendClient {
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

	async searchDatasetsWithLLM(query: {
		query: string;
		limit?: number;
		organism?: string;
	}): Promise<GEODataset[]> {
		try {
			console.log(
				"🔍 BackendClient.searchDatasetsWithLLM called with:",
				JSON.stringify(query)
			);
			console.log("🔍 Making POST request to:", `${this.baseUrl}/search/llm`);

			// Simulate progress updates for UI feedback
			if (this.onProgress) {
				this.onProgress({
					message: "Generating search terms with AI...",
					step: "llm_processing",
					progress: 20,
				});
			}

			const requestPayload: any = {
				query: query.query,
				limit: query.limit || 50,
			};

			// Only include organism if it's defined
			if (query.organism !== undefined && query.organism !== null) {
				requestPayload.organism = query.organism;
			}

			console.log("🔍 Final request payload:", JSON.stringify(requestPayload));

			if (this.onProgress) {
				this.onProgress({
					message: "Searching databases with AI-generated terms...",
					step: "searching",
					progress: 60,
				});
			}

			const response = await axios.post(`${this.baseUrl}/search/llm`, {
				...requestPayload,
				max_attempts: 2, // Add max_attempts for LLM search
			});

			console.log("🔍 Response status:", response.status);

			if (this.onProgress) {
				this.onProgress({
					message: "Processing search results...",
					step: "processing",
					progress: 90,
				});
			}

			// LLM search returns {datasets: [...], search_terms: [...], search_steps: [...]}
			const llmResponse = response.data;
			if (llmResponse && llmResponse.datasets) {
				console.log(
					"🔍 LLM search found datasets:",
					llmResponse.datasets.length
				);
				console.log("🔍 Search terms used:", llmResponse.search_terms);
				console.log("🔍 Search steps:", llmResponse.search_steps);

				if (this.onProgress) {
					this.onProgress({
						message: `Found ${llmResponse.datasets.length} datasets`,
						step: "completed",
						progress: 100,
						datasetsFound: llmResponse.datasets.length,
					});
				}

				return llmResponse.datasets;
			} else {
				console.log("🔍 No datasets in LLM response");

				if (this.onProgress) {
					this.onProgress({
						message: "No datasets found matching the search criteria",
						step: "completed",
						progress: 100,
						datasetsFound: 0,
					});
				}

				return [];
			}
		} catch (error) {
			console.error("BackendClient: Error searching datasets with LLM:", error);
			console.error("BackendClient: Error details:", {
				url: `${this.baseUrl}/search/llm`,
				query: query,
				error: error,
			});

			if (this.onProgress) {
				this.onProgress({
					message: "Search failed - please try again",
					step: "error",
					progress: 100,
					datasetsFound: 0,
				});
			}

			throw error;
		}
	}

	async discoverDatasets(
		query: string,
		options: { limit?: number; organism?: string }
	): Promise<{ datasets: GEODataset[] }> {
		try {
			const datasets = await this.searchDatasetsWithLLM({
				query: query,
				limit: options.limit,
				organism: options.organism,
			});
			return { datasets };
		} catch (error) {
			console.error(
				`BackendClient: Error discovering datasets for query: ${query}`,
				error
			);
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

	// Note: Code validation is now handled by CodeQualityService

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

	// ===== LLM API Methods =====

	/**
	 * Generate suggestions using LLM
	 */
	async generateSuggestions(request: {
		dataTypes: string[];
		query: string;
		selectedDatasets: any[];
		contextInfo?: string;
	}): Promise<any> {
		console.log("BackendClient: generateSuggestions called with:", {
			...request,
			query: request.query.substring(0, 100) + "..."
		});
		console.log("BackendClient: Making POST request to:", `${this.baseUrl}/llm/suggestions`);

		try {
			const requestBody = {
				data_types: request.dataTypes,
				user_question: request.query,
				available_datasets: request.selectedDatasets,
				current_context: request.contextInfo || "",
			};

			console.log("BackendClient: Request body:", requestBody);

			const response = await fetch(`${this.baseUrl}/llm/suggestions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(requestBody),
			});

			console.log("BackendClient: Response status:", response.status);
			console.log("BackendClient: Response ok:", response.ok);

			if (response.ok) {
				const result = await response.json();
				console.log("BackendClient: Successful response:", result);
				return result;
			} else {
				const errorText = await response.text();
				console.error(`BackendClient: HTTP error ${response.status}: ${response.statusText}`);
				console.error("BackendClient: Error response body:", errorText);
				throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
			}
		} catch (error) {
			console.error("BackendClient: Error generating suggestions:", error);
			console.error("BackendClient: Error details:", {
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				url: `${this.baseUrl}/llm/suggestions`,
				requestBody: {
					data_types: request.dataTypes,
					user_question: request.query?.substring(0, 100) + "...",
					available_datasets: request.selectedDatasets?.length,
				}
			});
			throw error;
		}
	}

	/**
	 * Validate code using LLM
	 */
	async validateCode(request: {
		code: string;
		language?: string;
		context?: string;
	}): Promise<any> {
		try {
			const response = await fetch(`${this.baseUrl}/llm/validate-code`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(request),
			});

			if (response.ok) {
				return await response.json();
			} else {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}
		} catch (error) {
			console.error("BackendClient: Error validating code:", error);
			throw error;
		}
	}

	/**
	 * Stream code generation using LLM
	 */
	async generateCodeStream(
		request: any,
		onChunk: (chunk: string) => void
	): Promise<any> {
		console.log("🚀 BackendClient.generateCodeStream: Starting stream request");
		console.log("🚀 Request payload:", JSON.stringify(request, null, 2));
		console.log("🚀 Streaming endpoint:", `${this.baseUrl}/llm/code/stream`);

		try {
			const response = await fetch(`${this.baseUrl}/llm/code/stream`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(request),
			});

			console.log("🚀 Response status:", response.status);
			console.log("🚀 Response headers:", response.headers);

			if (!response.ok) {
				const errorText = await response.text();
				console.error("🚀 HTTP Error response body:", errorText);
				throw new Error(
					`HTTP ${response.status}: ${response.statusText} - ${errorText}`
				);
			}

			const reader = response.body?.getReader();
			if (!reader) {
				console.error("🚀 No readable response body");
				throw new Error("Response body is not readable");
			}

			console.log("🚀 Starting to read stream...");
			const decoder = new TextDecoder();
			let result = "";
			let chunkCount = 0;

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					console.log("🚀 Stream reading completed");
					break;
				}

				chunkCount++;
				const rawChunk = decoder.decode(value);

				const lines = rawChunk.split("\n");

				for (const line of lines) {
					if (line.trim() === "") continue; // Skip empty lines

					if (line.startsWith("data: ")) {
						try {
							const jsonStr = line.slice(6);

							const data = JSON.parse(jsonStr);

							if (data.chunk) {
								onChunk(data.chunk);
								result += data.chunk;
							} else if (data.content) {
								// Handle alternative response format
								onChunk(data.content);
								result += data.content;
							} else {
							}
						} catch (e) {
							// Don't ignore - this might be the issue
						}
					} else {
					}
				}
			}

			if (result.length === 0) {
				console.warn("🚀 WARNING: No content received from stream!");
			}

			return { code: result, success: true };
		} catch (error) {
			console.error(
				"🚀 BackendClient: Error streaming code generation:",
				error
			);
			console.error("🚀 Error details:", {
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				request: request,
			});
			throw error;
		}
	}

	/**
	 * Generate LLM fix for code
	 */
	async generateCodeFix(request: {
		prompt: string;
		model: string;
		max_tokens?: number;
		temperature?: number;
	}): Promise<any> {
		try {
			const response = await fetch(`${this.baseUrl}/llm/code`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(request),
			});

			if (response.ok) {
				return await response.json();
			} else {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}
		} catch (error) {
			console.error("BackendClient: Error generating code fix:", error);
			throw error;
		}
	}
}
