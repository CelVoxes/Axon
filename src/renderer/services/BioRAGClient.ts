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
