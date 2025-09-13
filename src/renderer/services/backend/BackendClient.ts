import axios from "axios";
import { SearchConfig, MAX_SEARCH_ATTEMPTS } from "../../config/SearchConfig";
import { IBackendClient, SearchProgress } from "../types";
import { ConfigManager } from "./ConfigManager";
import { readNdjsonStream, readDataStream } from "../../utils/StreamUtils";
import { Logger } from "../../utils/Logger";
import { GEODataset } from "../../types/DatasetTypes";
import { deduplicateDatasets } from "../../utils/SearchUtils";

// GEODataset now sourced from shared types

// moved to types.ts

const log = Logger.createLogger("backendClient");

export class BackendClient implements IBackendClient {
	private baseUrl: string;
	private onProgress?: (progress: SearchProgress) => void;
	private abortControllers: Set<AbortController> = new Set();
	private authToken: string | null = null;
	private axiosInstance: any;

	constructor(baseUrl?: string) {
		const cfg = ConfigManager.getInstance().getSection("backend");
		const isPackaged = (window as any)?.electronAPI?.isPackaged?.() || false;
		const defaultUrl = isPackaged
			? "http://axon.celvox.co:8002"
			: "http://localhost:8001";
		this.baseUrl = baseUrl || cfg.baseUrl || defaultUrl;
		if (isPackaged && /localhost|127\.0\.0\.1/.test(this.baseUrl)) {
			console.warn(
				"BackendClient: Overriding localhost baseUrl in packaged app; using production server"
			);
			this.baseUrl = "http://axon.celvox.co:8002";
		}
		console.log(
			"BackendClient: resolved baseUrl =",
			this.baseUrl,
			"isPackaged =",
			isPackaged
		);

		// Initialize axios instance with base URL and timeout
		this.axiosInstance = axios.create({
			baseURL: this.baseUrl,
			timeout: cfg.timeout || 30000,
			headers: {
				"Content-Type": "application/json",
			},
		});

		// Try to seed token from localStorage if present
		try {
			const stored = localStorage.getItem("axon.auth.token");
			if (stored) this.authToken = stored;
		} catch {}

		// Attach Authorization header if token is present
		this.axiosInstance.interceptors.request.use((config: any) => {
			// Always attempt to read latest token from storage if not set
			if (!this.authToken) {
				try {
					const stored = localStorage.getItem("axon.auth.token");
					if (stored) this.authToken = stored;
				} catch {}
			}
			if (this.authToken) {
				config.headers = {
					...(config.headers || {}),
					Authorization: `Bearer ${this.authToken}`,
				};
			}
			return config;
		});
	}

	setAuthToken(token: string | null) {
		this.authToken = token;
	}

	private buildHeaders(extra?: Record<string, string>): HeadersInit {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...(extra || {}),
		};
		if (this.authToken) headers["Authorization"] = `Bearer ${this.authToken}`;
		return headers;
	}

	setProgressCallback(callback: (progress: SearchProgress) => void) {
		this.onProgress = callback;
	}

	getBaseUrl(): string {
		return this.baseUrl;
	}

	async getLLMConfig(): Promise<{
		default_model: string;
		available_models: string[];
		service_tier?: string | null;
	} | null> {
		try {
			const res = await this.axiosInstance.get(`${this.baseUrl}/llm/config`);
			const data = res.data || {};
			return {
				default_model: String(data.default_model || ""),
				available_models: Array.isArray(data.available_models)
					? data.available_models.map((x: any) => String(x))
					: [],
				service_tier:
					typeof data.service_tier === "string" ? data.service_tier : null,
			};
		} catch (e) {
			log.warn(
				"BackendClient: Failed to fetch LLM config, using local defaults.",
				e
			);
			return null;
		}
	}

	// Direct API methods - no business logic
	async searchDatasets(query: {
		query: string;
		limit?: number;
		organism?: string;
	}): Promise<GEODataset[]> {
		const controller = new AbortController();
		this.abortControllers.add(controller);
		try {
			// Use CellxCensus instead of GEO for better single-cell data
			const response = await this.axiosInstance.post(
				`${this.baseUrl}/cellxcensus/search`,
				{
					query: query.query,
					limit: query.limit || 50,
					organism: query.organism || "Homo sapiens",
				},
				{
					signal: controller.signal,
				}
			);
			return response.data;
		} catch (error) {
			log.error("BackendClient: Error searching datasets:", error);
			throw error;
		} finally {
			this.abortControllers.delete(controller);
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

			const response = await this.axiosInstance.post(
				`${this.baseUrl}/search/llm`,
				{
					...requestPayload,
					max_attempts: MAX_SEARCH_ATTEMPTS,
				},
				{}
			);

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
			const deduped = deduplicateDatasets(aggregated);
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
				const deduped = deduplicateDatasets(aggregated);
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
					headers: this.buildHeaders(),
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
		const controller = new AbortController();
		this.abortControllers.add(controller);
		try {
			const response = await this.axiosInstance.post(
				`${this.baseUrl}/llm/simplify`,
				{
					query: query,
				},
				{ signal: controller.signal }
			);
			return response.data.simplified_query;
		} catch (error) {
			log.warn("BackendClient: Error simplifying query:", error);
			// Fallback to original query if simplification fails
			return query;
		} finally {
			this.abortControllers.delete(controller);
		}
	}

	async generateSearchTerms(
		query: string,
		attempt: number = 1,
		isFirstAttempt: boolean = true
	): Promise<string[]> {
		const controller = new AbortController();
		this.abortControllers.add(controller);
		try {
			const response = await this.axiosInstance.post(
				`${this.baseUrl}/llm/search-terms`,
				{
					query: query,
					attempt: attempt,
					is_first_attempt: isFirstAttempt,
				},
				{ signal: controller.signal }
			);
			return response.data.terms || [];
		} catch (error) {
			log.warn("BackendClient: Error generating search terms:", error);
			// Fallback to basic term extraction
			return this.extractBasicTerms(query);
		} finally {
			this.abortControllers.delete(controller);
		}
	}

	// Removed generateAlternativeSearchTerms; use generateSearchTerms(query, attempt, false)

	async searchByGene(
		gene: string,
		organism?: string,
		limit: number = 50
	): Promise<GEODataset[]> {
		const controller = new AbortController();
		this.abortControllers.add(controller);
		try {
			const url = organism
				? `${this.baseUrl}/cellxcensus/search/cell_type/${gene}?organism=${organism}&limit=${limit}`
				: `${this.baseUrl}/cellxcensus/search/cell_type/${gene}?limit=${limit}`;

			const response = await this.axiosInstance.get(url, {
				signal: controller.signal,
			});
			return response.data;
		} catch (error) {
			log.error("BackendClient: Error searching by gene:", error);
			throw error;
		} finally {
			this.abortControllers.delete(controller);
		}
	}

	async searchByDisease(
		disease: string,
		limit: number = 50
	): Promise<GEODataset[]> {
		const controller = new AbortController();
		this.abortControllers.add(controller);
		try {
			const response = await this.axiosInstance.get(
				`${this.baseUrl}/cellxcensus/search/disease/${disease}?limit=${limit}`,
				{ signal: controller.signal }
			);
			return response.data;
		} catch (error) {
			log.error("BackendClient: Error searching by disease:", error);
			throw error;
		} finally {
			this.abortControllers.delete(controller);
		}
	}

	async generateCode(request: {
		task_description: string;
		language?: string;
		context?: string;
		model?: string;
	}): Promise<string> {
		const controller = new AbortController();
		this.abortControllers.add(controller);
		try {
			const response = await this.axiosInstance.post(
				`${this.baseUrl}/llm/code`,
				{
					task_description: request.task_description,
					language: request.language || "python",
					context: request.context,
					model: request.model,
				},
				{ signal: controller.signal }
			);
			return response.data.code;
		} catch (error) {
			log.error("BackendClient: Error generating code:", error);
			throw error;
		} finally {
			this.abortControllers.delete(controller);
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
		const controller = new AbortController();
		this.abortControllers.add(controller);
		try {
			const response = await this.axiosInstance.post(
				`${this.baseUrl}/llm/analyze`,
				{
					query: query,
				},
				{ signal: controller.signal }
			);
			return response.data;
		} catch (error) {
			log.error("BackendClient: Error analyzing query:", error);
			throw error;
		} finally {
			this.abortControllers.delete(controller);
		}
	}

	/**
	 * Classify chat intent using backend LLM analyzer. Returns a simplified intent string.
	 */
	async classifyIntent(message: string): Promise<{
		intent: string; // "ADD_CELL" | "SEARCH_DATA" | "START_ANALYSIS"
		confidence?: number;
		reason?: string;
	}> {
		const controller = new AbortController();
		this.abortControllers.add(controller);
		try {
			const response = await this.axiosInstance.post(
				`${this.baseUrl}/llm/intent`,
				{ text: message },
				{ signal: controller.signal }
			);
			return response.data as {
				intent: string;
				confidence?: number;
				reason?: string;
			};
		} catch (error) {
			log.error("BackendClient: Error classifying intent:", error);
			throw error;
		} finally {
			this.abortControllers.delete(controller);
		}
	}

	async generatePlan(request: {
		question: string;
		context?: string;
		current_state?: any;
		available_data?: any[];
		task_type?: string;
	}): Promise<any> {
		const controller = new AbortController();
		this.abortControllers.add(controller);
		try {
			const response = await this.axiosInstance.post(
				`${this.baseUrl}/llm/plan`,
				{
					question: request.question,
					context: request.context || "",
					current_state: request.current_state || {},
					available_data: request.available_data || [],
					task_type: request.task_type || "general",
				},
				{ signal: controller.signal }
			);
			return response.data;
		} catch (error) {
			log.error("BackendClient: Error generating plan:", error);
			throw error;
		} finally {
			this.abortControllers.delete(controller);
		}
	}

	/**
	 * General Q&A (Ask mode) — no environment creation or editing.
	 */
	async askQuestion(params: {
		question: string;
		context?: string;
		sessionId?: string;
	}): Promise<string> {
		const controller = new AbortController();
		this.abortControllers.add(controller);
		try {
			const response = await fetch(`${this.baseUrl}/llm/ask`, {
				method: "POST",
				headers: this.buildHeaders(),
				body: JSON.stringify({
					question: params.question,
					context: params.context || "",
					session_id: params.sessionId,
					model: ConfigManager.getInstance().getDefaultModel(),
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
			// If backend includes a reasoning_summary, append it to the answer for non-streaming calls
			const base = String(data?.answer || "");
			const summary =
				typeof data?.reasoning_summary === "string" &&
				data.reasoning_summary.trim().length > 0
					? `\n\n🧠 Summary: ${data.reasoning_summary}`
					: "";
			return base + summary;
		} catch (error) {
			console.error("BackendClient: Error asking question:", error);
			throw error;
		} finally {
			try {
				this.abortControllers.delete(controller);
			} catch (_) {}
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

	/**
	 * Stream Ask (Q&A) with reasoning-aware events.
	 * onEvent receives objects: { type: 'status'|'answer'|'done', ... }
	 */
    async askQuestionStream(
        params: { question: string; context?: string; sessionId?: string; streamRaw?: boolean },
        onEvent: (evt: any) => void
    ): Promise<void> {
		const controller = new AbortController();
		this.abortControllers.add(controller);
		try {
            const response = await fetch(`${this.baseUrl}/llm/ask/stream`, {
                method: "POST",
                headers: this.buildHeaders(),
                body: JSON.stringify({
                    question: params.question,
                    context: params.context || "",
                    session_id: params.sessionId,
                    model: ConfigManager.getInstance().getDefaultModel(),
                    stream_raw: params.streamRaw === true,
                }),
                signal: controller.signal,
            });

			await readNdjsonStream(response, {
				onLine: (json: any) => onEvent(json),
			});
		} finally {
			this.abortControllers.delete(controller);
		}
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
		log.debug("BackendClient: generateSuggestions called with: %o", {
			...request,
			query: request.query.substring(0, 100) + "...",
		});
		log.info(
			"BackendClient: Making POST request to: %s",
			`${this.baseUrl}/llm/suggestions`
		);

		try {
			const requestBody = {
				data_types: request.dataTypes,
				user_question: request.query,
				available_datasets: request.selectedDatasets,
				current_context: request.contextInfo || "",
			};

			const response = await fetch(`${this.baseUrl}/llm/suggestions`, {
				method: "POST",
				headers: this.buildHeaders(),
				body: JSON.stringify(requestBody),
			});

			log.debug("BackendClient: Response status: %s", String(response.status));
			log.debug("BackendClient: Response ok: %s", String(response.ok));

			if (response.ok) {
				const result = await response.json();
				log.debug("BackendClient: Successful response: %o", result);
				return result;
			} else {
				const errorText = await response.text();
				log.error(
					`BackendClient: HTTP error ${response.status}: ${response.statusText}`
				);
				log.error("BackendClient: Error response body: %s", errorText);
				throw new Error(
					`HTTP ${response.status}: ${response.statusText} - ${errorText}`
				);
			}
		} catch (error) {
			log.error("BackendClient: Error generating suggestions:", error);
			log.error("BackendClient: Error details: %o", {
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
				headers: this.buildHeaders(),
				body: JSON.stringify(request),
			});

			if (response.ok) {
				return await response.json();
			} else {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}
		} catch (error) {
			log.error("BackendClient: Error validating code:", error);
			throw error;
		}
	}

	/**
	 * Stream code generation using LLM
	 */
    async generateCodeStream(
        request: any,
        onChunk: (chunk: string) => void,
        onReasoningDelta?: (delta: string) => void,
        onSummary?: (summary: string) => void
    ): Promise<any> {
        log.info("🚀 BackendClient.generateCodeStream: Starting stream request");
        log.debug("🚀 Streaming endpoint: %s", `${this.baseUrl}/llm/code/stream`);

        const controller = new AbortController();
        this.abortControllers.add(controller);
        try {
            const response = await fetch(`${this.baseUrl}/llm/code/stream`, {
                method: "POST",
                headers: this.buildHeaders(),
                body: JSON.stringify(request),
                signal: controller.signal,
            });

            let code = "";
            await readNdjsonStream(response, {
                onLine: (obj: any) => {
                    try {
                        if (typeof obj?.chunk === "string" && obj.chunk.length > 0) {
                            try {
                                log.info("FE stream: code chunk (%d chars)", obj.chunk.length);
                            } catch (_) {}
                            onChunk(obj.chunk);
                            code += obj.chunk;
                            return;
                        }
                        if (obj?.type === "reasoning" && typeof obj?.delta === "string") {
                            try {
                                log.info("FE stream: reasoning delta (%d chars): %s", obj.delta.length, obj.delta.slice(0, 80));
                            } catch (_) {}
                            if (onReasoningDelta) onReasoningDelta(obj.delta);
                            return;
                        }
                        if (obj?.type === "summary" && typeof obj?.text === "string") {
                            if (onSummary) onSummary(obj.text);
                            return;
                        }
                    } catch (_) {}
                },
                onError: (m) => log.warn("readNdjsonStream parse error:", m),
            });

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
		session_id?: string;
		language?: "python" | "r";
	}): Promise<any> {
		try {
			const response = await fetch(`${this.baseUrl}/llm/code`, {
				method: "POST",
				headers: this.buildHeaders(),
				body: JSON.stringify(request),
			});

			if (response.ok) {
				return await response.json();
			} else {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}
		} catch (error) {
			log.error("BackendClient: Error generating code fix:", error);
			throw error;
		}
	}

	/**
	 * Get per-session approximate token usage and budget status
	 */
	async getSessionStats(sessionId: string): Promise<{
		session_id: string;
		last_response_id?: string | null;
		approx_tokens: number;
		approx_chars: number;
		limit_tokens: number;
		near_limit: boolean;
	}> {
		try {
			const url = `${
				this.baseUrl
			}/llm/session/stats?session_id=${encodeURIComponent(sessionId)}`;
			const res = await fetch(url, { headers: this.buildHeaders() });
			if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
			return await res.json();
		} catch (e) {
			throw e;
		}
	}
}
