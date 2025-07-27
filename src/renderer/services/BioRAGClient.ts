import axios, { AxiosInstance } from "axios";

export interface BioRAGQuery {
	question: string;
	max_documents?: number;
	retrieve_from_sources?: boolean;
	response_type?: "answer" | "summary" | "insights";
	system_prompt?: string;
}

export interface BioRAGResponse {
	question: string;
	answer: string;
	response_type: string;
	retrieval: {
		query: string;
		processed_query: string;
		entities: any;
		context_type: string;
		search_strategy: string;
		documents_found: number;
		documents: any[];
	};
	generation: {
		model: string;
		usage: any;
		context_used: number;
	};
	timing: {
		retrieval_time_ms: number;
		generation_time_ms: number;
		total_time_ms: number;
	};
}

export interface DatasetInfo {
	id: string;
	title: string;
	description: string;
	organism: string;
	samples: number;
	type: string;
	platform: string;
	publication_date: string;
	downloaded: boolean;
	processed: boolean;
	download_status?: string;
	file_paths?: {
		expression_matrix?: string;
		sample_info?: string;
		analysis_info?: string;
	};
}

export interface DatasetSearchParams {
	query: string;
	organism?: string;
	min_samples?: number;
	data_type?: string;
	limit?: number;
}

export interface DownloadStatus {
	dataset_id: string;
	status: "not_started" | "downloading" | "processing" | "completed" | "error";
	progress: number;
	error_message?: string;
	timestamp: string;
}

export class BioRAGClient {
	private client: AxiosInstance | null = null;
	private baseURL: string;
	private timeout: number;

	constructor(baseURL?: string, timeout: number = 30000) {
		// If no baseURL provided, we'll get it dynamically from the main process
		this.baseURL = baseURL || "";
		this.timeout = timeout;
	}

	private async getBaseURL(): Promise<string> {
		if (this.baseURL) {
			return this.baseURL;
		}

		// Get the dynamic BioRAG URL from the main process
		try {
			const dynamicURL = await (window as any).electronAPI.getBioragUrl();
			this.baseURL = dynamicURL;
			return this.baseURL;
		} catch (error) {
			console.warn("Could not get dynamic BioRAG URL, falling back to default");
			this.baseURL = "http://localhost:8000";
			return this.baseURL;
		}
	}

	private async getClient(): Promise<AxiosInstance> {
		if (this.client) {
			return this.client;
		}

		const baseURL = await this.getBaseURL();
		this.client = axios.create({
			baseURL,
			timeout: this.timeout,
			headers: {
				"Content-Type": "application/json",
			},
		});

		return this.client;
	}

	async query(queryData: BioRAGQuery): Promise<BioRAGResponse> {
		try {
			const client = await this.getClient();
			const response = await client.post("/query", queryData);
			return response.data;
		} catch (error) {
			console.error("BioRAG query failed:", error);
			if (axios.isAxiosError(error)) {
				throw new Error(`BioRAG query failed: ${error.message}`);
			}
			throw error;
		}
	}

	// Dataset Management Methods
	async searchDatasets(params: DatasetSearchParams): Promise<DatasetInfo[]> {
		try {
			const client = await this.getClient();
			const response = await client.get("/datasets/search", { params });
			return response.data;
		} catch (error) {
			console.error("Dataset search failed:", error);
			throw new Error("Failed to search for datasets");
		}
	}

	async getDatasetInfo(datasetId: string): Promise<DatasetInfo> {
		try {
			const client = await this.getClient();
			const response = await client.get(`/datasets/${datasetId}`);
			return response.data;
		} catch (error) {
			console.error("Get dataset info failed:", error);
			throw new Error("Failed to get dataset information");
		}
	}

	async downloadDataset(
		datasetId: string,
		force_redownload: boolean = false,
		workspace_dir?: string
	): Promise<{ status: string; dataset_id: string; workspace_dir?: string }> {
		try {
			const client = await this.getClient();
			const response = await client.post(`/datasets/${datasetId}/download`, {
				force_redownload,
				workspace_dir,
			});
			return response.data;
		} catch (error) {
			console.error("Dataset download failed:", error);
			throw new Error("Failed to start dataset download");
		}
	}

	async getDownloadStatus(datasetId: string): Promise<DownloadStatus> {
		try {
			const client = await this.getClient();
			const response = await client.get(
				`/datasets/${datasetId}/download/status`
			);
			return response.data;
		} catch (error) {
			console.error("Get download status failed:", error);
			throw new Error("Failed to get download status");
		}
	}

	async analyzeDataset(
		datasetId: string,
		prompt: string
	): Promise<{ analysis_id: string; status: string; dataset_id: string }> {
		try {
			const client = await this.getClient();
			const response = await client.post(`/datasets/${datasetId}/analyze`, {
				dataset_id: datasetId,
				prompt: prompt,
			});
			return response.data;
		} catch (error) {
			console.error("Dataset analysis failed:", error);
			throw new Error("Failed to start dataset analysis");
		}
	}

	async getAnalysisResults(analysisId: string): Promise<any> {
		try {
			const client = await this.getClient();
			const response = await client.get(`/datasets/analysis/${analysisId}`);
			return response.data;
		} catch (error) {
			console.error("Get analysis results failed:", error);
			throw new Error("Failed to get analysis results");
		}
	}

	async getAnalysisStatus(analysisId: string): Promise<any> {
		try {
			const client = await this.getClient();
			const response = await client.get(
				`/datasets/analysis/${analysisId}/status`
			);
			return response.data;
		} catch (error) {
			console.error("Get analysis status failed:", error);
			throw new Error("Failed to get analysis status");
		}
	}

	async setWorkspace(
		workspace_dir: string
	): Promise<{ status: string; workspace_dir: string }> {
		try {
			const client = await this.getClient();
			const response = await client.post("/datasets/set-workspace", null, {
				params: { workspace_dir },
			});
			return response.data;
		} catch (error) {
			console.error("Set workspace failed:", error);
			throw new Error("Failed to set workspace directory");
		}
	}

	// Enhanced search with dataset discovery
	async findDatasetsForQuery(
		query: string,
		options?: {
			includeDatasets?: boolean;
			maxDatasets?: number;
			organism?: string;
		}
	): Promise<{
		answer: string;
		datasets: DatasetInfo[];
		suggestions: string[];
	}> {
		try {
			const client = await this.getClient();

			// Check if query contains specific GEO dataset IDs
			const geoIds = query.match(/GSE\d+/g) || [];

			if (geoIds.length > 0) {
				// User mentioned specific datasets - fetch them directly
				const datasets: DatasetInfo[] = [];
				for (const geoId of geoIds.slice(0, options?.maxDatasets || 10)) {
					try {
						const datasetInfo = await this.getDatasetById(geoId);
						datasets.push(datasetInfo);
					} catch (error) {
						console.warn(`Failed to get info for ${geoId}:`, error);
					}
				}

				const answer = `Found ${
					datasets.length
				} specific dataset(s) mentioned in your query: ${geoIds.join(
					", "
				)}. These datasets are ready for analysis.`;

				return {
					answer,
					datasets,
					suggestions: [
						"Download and analyze differential expression",
						"Compare expression profiles between conditions",
						"Identify pathway enrichment",
						"Perform clustering analysis",
						"Generate expression heatmaps",
					],
				};
			}

			// No specific IDs mentioned - search for relevant datasets
			const bioragResponse = await this.query({
				question: `Find datasets relevant to: ${query}. Include specific GEO dataset IDs that would be useful for this analysis.`,
				max_documents: 5,
				response_type: "answer",
			});

			// Extract dataset IDs from the response
			const extractedGeoIds = bioragResponse.answer.match(/GSE\d+/g) || [];
			const datasets: DatasetInfo[] = [];

			// Search for datasets if requested
			if (options?.includeDatasets && extractedGeoIds.length > 0) {
				for (const geoId of extractedGeoIds.slice(
					0,
					options.maxDatasets || 10
				)) {
					try {
						const datasetInfo = await this.getDatasetInfo(geoId);
						datasets.push(datasetInfo);
					} catch (error) {
						// Continue if one dataset fails
						console.warn(`Failed to get info for ${geoId}:`, error);
					}
				}
			}

			// Generate analysis suggestions
			const suggestions = [
				"Download and analyze differential expression",
				"Compare expression profiles between conditions",
				"Identify pathway enrichment",
				"Perform clustering analysis",
				"Generate expression heatmaps",
			];

			return {
				answer: bioragResponse.answer,
				datasets,
				suggestions,
			};
		} catch (error) {
			console.error("Find datasets for query failed:", error);
			throw new Error("Failed to find relevant datasets");
		}
	}

	async searchGene(gene: string, organism?: string): Promise<BioRAGResponse> {
		try {
			const client = await this.getClient();
			const response = await client.post("/search/gene", {
				gene,
				organism,
				question: `Tell me about the ${gene} gene`,
				response_type: "answer",
			});
			return response.data;
		} catch (error) {
			console.error("Gene search error:", error);
			throw new Error("Failed to search for gene information");
		}
	}

	// Direct dataset access by ID
	async getDatasetById(datasetId: string): Promise<DatasetInfo> {
		try {
			const client = await this.getClient();
			const response = await client.get(`/datasets/${datasetId}`);
			return response.data;
		} catch (error) {
			console.error("Dataset info error:", error);
			throw new Error(`Failed to get dataset info for ${datasetId}`);
		}
	}

	// Get multiple datasets by IDs
	async getDatasetsByIds(datasetIds: string[]): Promise<DatasetInfo[]> {
		try {
			const datasets: DatasetInfo[] = [];
			for (const id of datasetIds) {
				try {
					const dataset = await this.getDatasetById(id);
					datasets.push(dataset);
				} catch (error) {
					console.warn(`Failed to get dataset ${id}:`, error);
					// Continue with other datasets
				}
			}
			return datasets;
		} catch (error) {
			console.error("Get datasets by IDs error:", error);
			throw new Error("Failed to get datasets by IDs");
		}
	}

	async searchDisease(disease: string): Promise<BioRAGResponse> {
		try {
			const client = await this.getClient();
			const response = await client.post("/search/disease", {
				disease,
				question: `Tell me about ${disease}`,
				response_type: "answer",
			});
			return response.data;
		} catch (error) {
			console.error("Disease search error:", error);
			throw new Error("Failed to search for disease information");
		}
	}

	async compareGenes(
		genes: string[],
		aspect?: string
	): Promise<BioRAGResponse> {
		try {
			const client = await this.getClient();
			const response = await client.post("/compare", {
				entities: genes,
				entity_type: "gene",
				comparison_aspect: aspect || "function",
			});
			return response.data;
		} catch (error) {
			console.error("Gene comparison error:", error);
			throw new Error("Failed to compare genes");
		}
	}

	async explorePathway(
		pathway: string,
		focus?: string
	): Promise<BioRAGResponse> {
		try {
			const client = await this.getClient();
			const response = await client.post("/explore/pathway", {
				pathway,
				focus,
			});
			return response.data;
		} catch (error) {
			console.error("Pathway exploration error:", error);
			throw new Error("Failed to explore pathway");
		}
	}

	async getResearchRecommendations(
		researchArea: string,
		currentKnowledge?: string
	): Promise<BioRAGResponse> {
		try {
			const client = await this.getClient();
			const response = await client.post("/research/recommendations", {
				research_area: researchArea,
				current_knowledge: currentKnowledge,
			});
			return response.data;
		} catch (error) {
			console.error("Research recommendations error:", error);
			throw new Error("Failed to get research recommendations");
		}
	}

	async getExperimentalDesign(
		researchQuestion: string,
		organism?: string
	): Promise<BioRAGResponse> {
		try {
			const client = await this.getClient();
			const response = await client.post("/research/experimental-design", {
				research_question: researchQuestion,
				organism,
			});
			return response.data;
		} catch (error) {
			console.error("Experimental design error:", error);
			throw new Error("Failed to get experimental design suggestions");
		}
	}

	// Note: searchDocuments method removed due to API endpoint issues
	// Use the query() method instead for document searches

	async getStats(): Promise<any> {
		try {
			const client = await this.getClient();
			const response = await client.get("/stats");
			return response.data;
		} catch (error) {
			console.error("Stats error:", error);
			throw new Error("Failed to get system stats");
		}
	}

	async healthCheck(): Promise<boolean> {
		try {
			const client = await this.getClient();
			const response = await client.get("/health");
			return response.data.status === "healthy";
		} catch (error) {
			return false;
		}
	}

	getBaseURLSync(): string {
		return this.baseURL || "http://localhost:8000";
	}
}
