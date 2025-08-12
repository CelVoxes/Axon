import axios from "axios";
import { SearchConfig, MAX_SEARCH_ATTEMPTS } from "../config/SearchConfig";
import { IBackendClient } from "./types";
import { readNdjsonStream, readDataStream } from "../utils/StreamUtils";
import { Logger } from "../utils/Logger";
import { GEODataset } from "../types/DatasetTypes";

// GEODataset now sourced from shared types

export interface SearchProgress {
	message: string;
	step: string;
	progress: number; // 0-100
	datasetsFound?: number;
	currentTerm?: string;
}

const log = Logger.createLogger("backendClient");

export class BackendClient implements IBackendClient {
	private baseUrl: string;
	private onProgress?: (progress: SearchProgress) => void;
	private abortControllers: Set<AbortController> = new Set();

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
			// Use CellxCensus instead of GEO for better single-cell data
			const response = await axios.post(`${this.baseUrl}/cellxcensus/search`, {
				query: query.query,
				limit: query.limit || 50,
				organism: query.organism || "Homo sapiens",
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
			log.info(
				"🔍 BackendClient.searchDatasetsWithLLM called with:",
				JSON.stringify(query)
			);
			log.info("🔍 Making POST request to:", `${this.baseUrl}/search/llm`);

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

			log.debug("🔍 Final request payload:", JSON.stringify(requestPayload));

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

			log.debug("🔍 Response status:", String(response.status));

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
				log.info("🔍 LLM search found datasets:", llmResponse.datasets.length);
				log.debug("🔍 Search terms used:", llmResponse.search_terms);
				log.debug("🔍 Search steps:", llmResponse.search_steps);

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
				log.warn("🔍 No datasets in LLM response");

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
			log.error("BackendClient: Error searching datasets with LLM:", error);
			log.error("BackendClient: Error details:", {
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
			// Use backend LLM to derive strong search terms, then use CellxCensus
			const simplified = await this.simplifyQuery(query);
			const llmTerms = await this.generateSearchTerms(simplified, 1, true);
			const finalQuery =
				llmTerms && llmTerms.length > 0 ? llmTerms[0] : simplified;

			// Prefer CellxCensus streaming search to provide real-time progress and non-GEO results
			const originalLower = query.toLowerCase();
			const candidateTerms = new Set<string>([finalQuery]);
			if (
				originalLower.includes("b-all") ||
				originalLower.includes(" ball ") ||
				query.includes("ALL")
			) {
				candidateTerms.add("B cell");
			}
			if (finalQuery.toLowerCase().includes("leukemia")) {
				candidateTerms.add("B cell");
			}

			let aggregated: GEODataset[] = [];
			for (const term of candidateTerms) {
				const part = await this.searchDatasetsStream(
					{
						query: term,
						limit: options.limit,
						organism: options.organism ?? "Homo sapiens",
					},
					this.onProgress,
					undefined,
					(msg) => console.warn("Streaming search error:", msg)
				);
				aggregated.push(...part);
				if (aggregated.length >= (options.limit ?? 20)) break;
			}
			// Deduplicate by id
			const seen = new Set<string>();
			const deduped = aggregated.filter((d) => {
				if (seen.has(d.id)) return false;
				seen.add(d.id);
				return true;
			});
			return { datasets: deduped };
		} catch (error) {
			console.error(
				`BackendClient: Error discovering datasets for query: ${query}`,
				error
			);
			// Fallback to non-streaming CellxCensus search
			try {
				const simplified = await this.simplifyQuery(query);
				const llmTerms = await this.generateSearchTerms(simplified, 1, true);
				const finalQuery =
					llmTerms && llmTerms.length > 0 ? llmTerms[0] : simplified;
				const candidateTerms = new Set<string>([finalQuery]);
				if (query.toLowerCase().includes("b-all") || query.includes("ALL")) {
					candidateTerms.add("B cell");
				}
				if (finalQuery.toLowerCase().includes("leukemia")) {
					candidateTerms.add("B cell");
				}
				let aggregated: GEODataset[] = [];
				for (const term of candidateTerms) {
					const part = await this.searchDatasets({
						query: term,
						limit: options.limit,
						organism: options.organism ?? "Homo sapiens",
					});
					aggregated.push(...part);
					if (aggregated.length >= (options.limit ?? 20)) break;
				}
				const seen = new Set<string>();
				const deduped = aggregated.filter((d) => {
					if (seen.has(d.id)) return false;
					seen.add(d.id);
					return true;
				});
				return { datasets: deduped };
			} catch (fallbackError) {
				console.error(
					"BackendClient: Fallback CellxCensus search failed:",
					fallbackError
				);
				// As a last resort, optionally fall back to LLM GEO search to avoid total failure
				const datasets = await this.searchDatasetsWithLLM({
					query,
					limit: options.limit,
					organism: options.organism,
				});
				return { datasets };
			}
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
		const controller = new AbortController();
		this.abortControllers.add(controller);
		try {
			const response = await fetch(
				`${this.baseUrl}/cellxcensus/search/stream`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						query: query.query,
						limit: query.limit || 50,
						organism: query.organism,
					}),
					signal: controller.signal,
				}
			);

			let finalResults: GEODataset[] | null = null;
			await readNdjsonStream(response, {
				onProgress: (data: any) => {
					onProgress?.({
						message: data.message,
						step: data.step,
						progress: data.progress,
						datasetsFound: data.datasetsFound,
					});
				},
				onLine: (data: any) => {
					if (data.type === "results") {
						finalResults = data.datasets as GEODataset[];
						onResults?.(finalResults);
					}
					if (data.type === "error") {
						onError?.(data.message);
					}
				},
				onError: (msg: string) => onError?.(msg),
			});

			if (!finalResults) throw new Error("Stream ended without results");
			return finalResults;
		} catch (error) {
			console.error("BackendClient: Error in streaming search:", error);
			throw error;
		} finally {
			this.abortControllers.delete(controller);
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
				? `${this.baseUrl}/cellxcensus/search/cell_type/${gene}?organism=${organism}&limit=${limit}`
				: `${this.baseUrl}/cellxcensus/search/cell_type/${gene}?limit=${limit}`;

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
				`${this.baseUrl}/cellxcensus/search/disease/${disease}?limit=${limit}`
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
		model?: string;
	}): Promise<string> {
		try {
			const response = await axios.post(`${this.baseUrl}/llm/code`, {
				task_description: request.task_description,
				language: request.language || "python",
				context: request.context,
				model: request.model,
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

	/**
	 * General Q&A (Ask mode) — no environment creation or editing.
	 */
	async askQuestion(params: {
		question: string;
		context?: string;
	}): Promise<string> {
		try {
			const controller = new AbortController();
			this.abortControllers.add(controller);
			const response = await fetch(`${this.baseUrl}/llm/ask`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					question: params.question,
					context: params.context || "",
				}),
				signal: controller.signal,
			});
			if (!response.ok) {
				const text = await response.text();
				throw new Error(
					`HTTP ${response.status}: ${response.statusText} - ${text}`
				);
			}
			const data = await response.json();
			return String(data?.answer || "");
		} catch (error) {
			console.error("BackendClient: Error asking question:", error);
			throw error;
		} finally {
			// Clean up controller if still present
			try {
				for (const c of this.abortControllers) {
					// no-op; they are removed on specific calls normally
				}
			} finally {
				// Ensure to clear all after completing this request
				// Remove only one controller if exists
				const it = this.abortControllers.values();
				const first = it.next();
				if (!first.done) {
					this.abortControllers.delete(first.value as AbortController);
				}
			}
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
			query: request.query.substring(0, 100) + "...",
		});
		console.log(
			"BackendClient: Making POST request to:",
			`${this.baseUrl}/llm/suggestions`
		);

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
				console.error(
					`BackendClient: HTTP error ${response.status}: ${response.statusText}`
				);
				console.error("BackendClient: Error response body:", errorText);
				throw new Error(
					`HTTP ${response.status}: ${response.statusText} - ${errorText}`
				);
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
				},
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
		console.log("🚀 Streaming endpoint:", `${this.baseUrl}/llm/code/stream`);

		const controller = new AbortController();
		this.abortControllers.add(controller);
		try {
			const response = await fetch(`${this.baseUrl}/llm/code/stream`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(request),
				signal: controller.signal,
			});

			const code = await readDataStream(response, onChunk);
			if (code.length === 0) {
				log.warn("🚀 WARNING: No content received from stream!");
			}
			return { code, success: true };
		} catch (error) {
			log.error(
				"🚀 BackendClient: Error streaming code generation:",
				error as any
			);
			log.error("🚀 Error details:", {
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				request: request,
			});
			throw error;
		} finally {
			this.abortControllers.delete(controller);
		}
	}

	abortAllRequests(): void {
		try {
			this.abortControllers.forEach((c) => {
				try {
					c.abort();
				} catch (_) {}
			});
		} finally {
			this.abortControllers.clear();
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
