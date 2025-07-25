"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BioRAGClient = void 0;
const axios_1 = __importDefault(require("axios"));
class BioRAGClient {
    constructor(baseURL, timeout = 30000) {
        this.client = null;
        // If no baseURL provided, we'll get it dynamically from the main process
        this.baseURL = baseURL || "";
        this.timeout = timeout;
    }
    async getBaseURL() {
        if (this.baseURL) {
            return this.baseURL;
        }
        // Get the dynamic BioRAG URL from the main process
        try {
            const dynamicURL = await window.electronAPI.getBioragUrl();
            this.baseURL = dynamicURL;
            return this.baseURL;
        }
        catch (error) {
            console.warn("Could not get dynamic BioRAG URL, falling back to default");
            this.baseURL = "http://localhost:8000";
            return this.baseURL;
        }
    }
    async getClient() {
        if (this.client) {
            return this.client;
        }
        const baseURL = await this.getBaseURL();
        this.client = axios_1.default.create({
            baseURL,
            timeout: this.timeout,
            headers: {
                "Content-Type": "application/json",
            },
        });
        return this.client;
    }
    async query(queryData) {
        try {
            const client = await this.getClient();
            const response = await client.post("/query", queryData);
            return response.data;
        }
        catch (error) {
            console.error("BioRAG query failed:", error);
            if (axios_1.default.isAxiosError(error)) {
                throw new Error(`BioRAG query failed: ${error.message}`);
            }
            throw error;
        }
    }
    async searchGene(gene, organism) {
        try {
            const client = await this.getClient();
            const response = await client.post("/search/gene", {
                gene,
                organism,
                question: `Tell me about the ${gene} gene`,
                response_type: "answer",
            });
            return response.data;
        }
        catch (error) {
            console.error("Gene search error:", error);
            throw new Error("Failed to search for gene information");
        }
    }
    async searchDisease(disease) {
        try {
            const client = await this.getClient();
            const response = await client.post("/search/disease", {
                disease,
                question: `Tell me about ${disease}`,
                response_type: "answer",
            });
            return response.data;
        }
        catch (error) {
            console.error("Disease search error:", error);
            throw new Error("Failed to search for disease information");
        }
    }
    async compareGenes(genes, aspect) {
        try {
            const client = await this.getClient();
            const response = await client.post("/compare", {
                entities: genes,
                entity_type: "gene",
                comparison_aspect: aspect || "function",
            });
            return response.data;
        }
        catch (error) {
            console.error("Gene comparison error:", error);
            throw new Error("Failed to compare genes");
        }
    }
    async explorePathway(pathway, focus) {
        try {
            const client = await this.getClient();
            const response = await client.post("/explore/pathway", {
                pathway,
                focus,
            });
            return response.data;
        }
        catch (error) {
            console.error("Pathway exploration error:", error);
            throw new Error("Failed to explore pathway");
        }
    }
    async getResearchRecommendations(researchArea, currentKnowledge) {
        try {
            const client = await this.getClient();
            const response = await client.post("/research/recommendations", {
                research_area: researchArea,
                current_knowledge: currentKnowledge,
            });
            return response.data;
        }
        catch (error) {
            console.error("Research recommendations error:", error);
            throw new Error("Failed to get research recommendations");
        }
    }
    async getExperimentalDesign(researchQuestion, organism) {
        try {
            const client = await this.getClient();
            const response = await client.post("/research/experimental-design", {
                research_question: researchQuestion,
                organism,
            });
            return response.data;
        }
        catch (error) {
            console.error("Experimental design error:", error);
            throw new Error("Failed to get experimental design suggestions");
        }
    }
    // Note: searchDocuments method removed due to API endpoint issues
    // Use the query() method instead for document searches
    async getStats() {
        try {
            const client = await this.getClient();
            const response = await client.get("/stats");
            return response.data;
        }
        catch (error) {
            console.error("Stats error:", error);
            throw new Error("Failed to get system stats");
        }
    }
    async healthCheck() {
        try {
            const client = await this.getClient();
            const response = await client.get("/health");
            return response.data.status === "healthy";
        }
        catch (error) {
            return false;
        }
    }
    getBaseURLSync() {
        return this.baseURL || "http://localhost:8000";
    }
}
exports.BioRAGClient = BioRAGClient;
