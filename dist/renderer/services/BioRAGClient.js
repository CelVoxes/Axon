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
    // Dataset Management Methods
    async searchDatasets(params) {
        try {
            const client = await this.getClient();
            const response = await client.get("/datasets/search", { params });
            return response.data;
        }
        catch (error) {
            console.error("Dataset search failed:", error);
            throw new Error("Failed to search for datasets");
        }
    }
    async getDatasetInfo(datasetId) {
        try {
            const client = await this.getClient();
            const response = await client.get(`/datasets/${datasetId}`);
            return response.data;
        }
        catch (error) {
            console.error("Get dataset info failed:", error);
            throw new Error("Failed to get dataset information");
        }
    }
    async downloadDataset(datasetId, force_redownload = false, workspace_dir) {
        try {
            const client = await this.getClient();
            const response = await client.post(`/datasets/${datasetId}/download`, {
                force_redownload,
                workspace_dir,
            });
            return response.data;
        }
        catch (error) {
            console.error("Dataset download failed:", error);
            throw new Error("Failed to start dataset download");
        }
    }
    async getDownloadStatus(datasetId) {
        try {
            const client = await this.getClient();
            const response = await client.get(`/datasets/${datasetId}/download/status`);
            return response.data;
        }
        catch (error) {
            console.error("Get download status failed:", error);
            throw new Error("Failed to get download status");
        }
    }
    async analyzeDataset(datasetId, prompt) {
        try {
            const client = await this.getClient();
            const response = await client.post(`/datasets/${datasetId}/analyze`, {
                dataset_id: datasetId,
                prompt: prompt,
            });
            return response.data;
        }
        catch (error) {
            console.error("Dataset analysis failed:", error);
            throw new Error("Failed to start dataset analysis");
        }
    }
    async getAnalysisResults(analysisId) {
        try {
            const client = await this.getClient();
            const response = await client.get(`/datasets/analysis/${analysisId}`);
            return response.data;
        }
        catch (error) {
            console.error("Get analysis results failed:", error);
            throw new Error("Failed to get analysis results");
        }
    }
    async getAnalysisStatus(analysisId) {
        try {
            const client = await this.getClient();
            const response = await client.get(`/datasets/analysis/${analysisId}/status`);
            return response.data;
        }
        catch (error) {
            console.error("Get analysis status failed:", error);
            throw new Error("Failed to get analysis status");
        }
    }
    async setWorkspace(workspace_dir) {
        try {
            const client = await this.getClient();
            const response = await client.post("/datasets/set-workspace", null, {
                params: { workspace_dir },
            });
            return response.data;
        }
        catch (error) {
            console.error("Set workspace failed:", error);
            throw new Error("Failed to set workspace directory");
        }
    }
    // Enhanced search with dataset discovery
    async findDatasetsForQuery(query, options) {
        try {
            const client = await this.getClient();
            // First get the regular BioRAG response
            const bioragResponse = await this.query({
                question: `Find datasets relevant to: ${query}. Include specific GEO dataset IDs that would be useful for this analysis.`,
                max_documents: 5,
                response_type: "answer",
            });
            // Extract dataset IDs from the response
            const geoIds = bioragResponse.answer.match(/GSE\d+/g) || [];
            const datasets = [];
            // Search for datasets if requested
            if (options?.includeDatasets && geoIds.length > 0) {
                for (const geoId of geoIds.slice(0, options.maxDatasets || 10)) {
                    try {
                        const datasetInfo = await this.getDatasetInfo(geoId);
                        datasets.push(datasetInfo);
                    }
                    catch (error) {
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
        }
        catch (error) {
            console.error("Find datasets for query failed:", error);
            throw new Error("Failed to find relevant datasets");
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
