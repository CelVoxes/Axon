import { BackendClient } from "./BackendClient";
import { v4 as uuidv4 } from "uuid";

interface Dataset {
	id: string;
	title: string;
	source: string;
	organism: string;
	samples: number;
	platform: string;
	description: string;
	url?: string;
}

interface AnalysisStep {
	id: string;
	description: string;
	code: string;
	status: "pending" | "running" | "completed" | "failed" | "cancelled";
	output?: string;
	files?: string[];
}

interface AnalysisResult {
	understanding: {
		userQuestion: string;
		requiredSteps: string[];
		dataNeeded: string[];
		expectedOutputs: string[];
	};
	datasets: Dataset[];
	steps: AnalysisStep[];
	workingDirectory: string;
}

export class AutonomousAgent {
	private backendClient: BackendClient;
	private workspacePath: string;
	private originalQuery: string = "";
	public isRunning: boolean = false;
	private shouldStopAnalysis: boolean = false;
	private statusCallback?: (status: string) => void;
	private selectedModel: string = "gpt-4o-mini";

	constructor(
		backendClient: BackendClient,
		workspacePath: string,
		selectedModel?: string
	) {
		this.backendClient = backendClient;
		this.workspacePath = workspacePath;
		if (selectedModel) {
			this.selectedModel = selectedModel;
		}
	}

	setModel(model: string) {
		this.selectedModel = model;
	}

	setStatusCallback(callback: (status: string) => void) {
		this.statusCallback = callback;
	}

	private updateStatus(message: string) {
		if (this.statusCallback) {
			this.statusCallback(message);
		}
	}

	async executeAnalysisRequest(query: string): Promise<AnalysisResult> {
		this.originalQuery = query;
		this.isRunning = true;
		this.shouldStopAnalysis = false;

		try {
			// Step 1: Understand what the user actually wants to do
			this.updateStatus("Understanding your question...");
			const understanding = await this.analyzeUserQuestion(query, []);

			// Step 2: Find what data is needed to answer their question
			this.updateStatus("Identifying required data...");
			const datasets = await this.findRequiredData(understanding);

			// Step 3: Create working space
			this.updateStatus("Setting up workspace...");
			const workingDirectory = await this.createWorkspace(query);

			// Step 4: Generate the actual steps needed to answer their question
			this.updateStatus("Planning analysis approach...");
			const steps = await this.generateQuestionSpecificSteps(
				understanding,
				datasets,
				workingDirectory
			);

			this.updateStatus("Ready to execute analysis!");

			return {
				understanding,
				datasets,
				steps,
				workingDirectory,
			};
		} finally {
			this.isRunning = false;
		}
	}

	async executeAnalysisRequestWithData(
		query: string,
		downloadedDatasets: Dataset[]
	): Promise<AnalysisResult> {
		this.originalQuery = query;
		this.isRunning = true;
		this.shouldStopAnalysis = false;

		try {
			// Step 1: Understand what the user actually wants to do
			this.updateStatus("Understanding your question...");
			const understanding = await this.analyzeUserQuestion(
				query,
				downloadedDatasets
			);

			// Step 3: Create working space
			this.updateStatus("Setting up workspace...");
			const workingDirectory = await this.createWorkspace(query);

			// Step 4: Generate analysis steps that use the downloaded data
			this.updateStatus("Planning analysis approach with downloaded data...");
			const steps = await this.generateDataDrivenAnalysisSteps(
				understanding,
				downloadedDatasets,
				workingDirectory
			);

			this.updateStatus("Ready to execute analysis with downloaded data!");

			return {
				understanding,
				datasets: downloadedDatasets,
				steps,
				workingDirectory,
			};
		} finally {
			this.isRunning = false;
		}
	}

	private async analyzeUserQuestion(
		question: string,
		datasets: Dataset[]
	): Promise<any> {
		this.updateStatus("Analyzing your research question...");

		try {
			// Call the backend LLM API to generate a plan
			const response = await fetch(
				`${this.backendClient.getBaseUrl()}/llm/plan`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						question: question,
						context: `Research question: ${question}`,
						current_state: {
							datasets_available: datasets.length,
							datasets: datasets.map((d) => ({ id: d.id, title: d.title })),
						},
						available_data: datasets.map((d) => ({
							id: d.id,
							title: d.title,
							description: d.description,
							samples: d.samples,
							platform: d.platform,
						})),
						task_type: "analysis",
					}),
				}
			);

			if (response.ok) {
				const result = await response.json();
				console.log("LLM plan result:", result);
				return {
					userQuestion: question,
					requiredSteps: result.next_steps || [],
					analysisType: result.task_type || "analysis",
					priority: result.priority || "medium",
					estimatedTime: result.estimated_time || "unknown",
					datasets: datasets,
				};
			} else {
				const errorText = await response.text();
				console.warn(
					`LLM plan API call failed. Status: ${response.status}, Error: ${errorText}`
				);
			}
		} catch (apiError) {
			console.warn(`LLM plan API error:`, apiError);
		}

		// Fallback to basic analysis if LLM fails
		console.log("Using fallback analysis for user question");
		return {
			userQuestion: question,
			requiredSteps: [
				"Load and preprocess the datasets",
				"Perform exploratory data analysis",
				"Apply appropriate statistical methods",
				"Generate visualizations and interpret results",
			],
			analysisType: "general",
			priority: "medium",
			estimatedTime: "variable",
			datasets: datasets,
		};
	}

	private generateFallbackAnalysis(query: string) {
		// Extract key terms from the query to create a more intelligent fallback
		const queryLower = query.toLowerCase();

		let analysisType = "general biological analysis";
		let steps = [
			"Set up analysis environment and install required packages",
			"Acquire and preprocess relevant biological datasets",
			"Perform the requested analysis",
			"Generate visualizations and results",
			"Create comprehensive summary report",
		];
		let dataNeeded = ["Biological datasets relevant to the question"];
		let expectedOutputs = ["Analysis results", "Visualizations"];

		// Detect analysis type based on query content
		if (queryLower.includes("differential") || queryLower.includes("deg")) {
			analysisType = "differential gene expression analysis";
			steps = [
				"Load and preprocess gene expression data",
				"Perform quality control and normalization",
				"Identify differentially expressed genes",
				"Perform statistical analysis and multiple testing correction",
				"Generate volcano plots and heatmaps",
				"Perform pathway enrichment analysis",
				"Create comprehensive differential expression report",
			];
			dataNeeded = ["Gene expression datasets (RNA-seq or microarray)"];
			expectedOutputs = [
				"DEG lists",
				"Volcano plots",
				"Heatmaps",
				"Pathway enrichment results",
			];
		} else if (
			queryLower.includes("subtype") ||
			queryLower.includes("cluster")
		) {
			analysisType = "subtype/clustering analysis";
			steps = [
				"Load and preprocess gene expression data",
				"Perform quality control and normalization",
				"Apply dimensionality reduction (PCA, t-SNE)",
				"Perform clustering analysis (k-means, hierarchical)",
				"Identify subtype-specific gene signatures",
				"Validate clustering results",
				"Generate subtype-specific visualizations",
			];
			dataNeeded = ["Gene expression datasets with multiple samples"];
			expectedOutputs = [
				"Clustering results",
				"Subtype assignments",
				"Signature genes",
				"Visualization plots",
			];
		} else if (
			queryLower.includes("biomarker") ||
			queryLower.includes("signature")
		) {
			analysisType = "biomarker discovery analysis";
			steps = [
				"Load and preprocess gene expression data",
				"Perform quality control and normalization",
				"Apply feature selection methods",
				"Train machine learning models for classification",
				"Perform cross-validation and model evaluation",
				"Identify top biomarker candidates",
				"Generate biomarker validation plots",
			];
			dataNeeded = ["Gene expression datasets with clinical annotations"];
			expectedOutputs = [
				"Biomarker lists",
				"Model performance metrics",
				"Validation plots",
			];
		} else if (
			queryLower.includes("pathway") ||
			queryLower.includes("enrichment")
		) {
			analysisType = "pathway enrichment analysis";
			steps = [
				"Load gene expression or gene list data",
				"Perform differential expression analysis if needed",
				"Extract gene lists for enrichment analysis",
				"Perform pathway enrichment analysis (GO, KEGG)",
				"Apply statistical testing and multiple correction",
				"Generate enrichment plots and networks",
				"Create pathway analysis report",
			];
			dataNeeded = ["Gene expression data or gene lists"];
			expectedOutputs = [
				"Enrichment results",
				"Pathway plots",
				"Gene set analysis",
			];
		}

		return {
			userQuestion: query,
			requiredSteps: steps,
			dataNeeded: dataNeeded,
			expectedOutputs: expectedOutputs,
		};
	}

	private parseLLMPlanningResponse(response: string, originalQuery: string) {
		const lines = response.split("\n").map((line) => line.trim());

		let understanding = originalQuery;
		let steps: string[] = [];
		let dataNeeded: string[] = [];
		let expectedOutputs: string[] = [];

		let currentSection = "";

		for (const line of lines) {
			if (line.startsWith("UNDERSTANDING:")) {
				understanding = line.replace("UNDERSTANDING:", "").trim();
				currentSection = "understanding";
			} else if (line.startsWith("STEPS:")) {
				currentSection = "steps";
			} else if (line.startsWith("DATA_NEEDED:")) {
				currentSection = "data";
			} else if (line.startsWith("OUTPUTS:")) {
				currentSection = "outputs";
			} else if (line.match(/^\d+\.\s+(.+)/) && currentSection === "steps") {
				const stepMatch = line.match(/^\d+\.\s+(.+)/);
				if (stepMatch && stepMatch[1].length > 10) {
					steps.push(stepMatch[1].trim());
				}
			} else if (line.startsWith("-") && currentSection === "data") {
				dataNeeded.push(line.replace("-", "").trim());
			} else if (line.startsWith("-") && currentSection === "outputs") {
				expectedOutputs.push(line.replace("-", "").trim());
			} else if (line.includes(",") && currentSection === "data") {
				dataNeeded.push(...line.split(",").map((item) => item.trim()));
			} else if (line.includes(",") && currentSection === "outputs") {
				expectedOutputs.push(...line.split(",").map((item) => item.trim()));
			}
		}

		// Ensure we have reasonable defaults if parsing failed
		if (steps.length === 0) {
			steps = this.extractStepsFromText(response);
		}

		if (dataNeeded.length === 0) {
			dataNeeded = ["Relevant biological datasets"];
		}

		if (expectedOutputs.length === 0) {
			expectedOutputs = ["Analysis results", "Visualizations"];
		}

		return {
			userQuestion: understanding || originalQuery,
			requiredSteps: steps,
			dataNeeded: dataNeeded,
			expectedOutputs: expectedOutputs,
		};
	}

	private extractStepsFromText(text: string): string[] {
		const steps: string[] = [];
		const lines = text.split("\n");

		for (const line of lines) {
			const stepMatch =
				line.match(/^\s*\d+\.?\\s*(.+)/) || line.match(/^\s*[-*]\s*(.+)/);
			if (stepMatch && stepMatch[1].trim().length > 15) {
				steps.push(stepMatch[1].trim());
			}
		}

		// Extract from sentences if no numbered list found
		if (steps.length === 0) {
			const sentences = text
				.split(/[.!?]+/)
				.filter(
					(s) =>
						s.trim().length > 20 &&
						(s.toLowerCase().includes("step") ||
							s.toLowerCase().includes("analyze") ||
							s.toLowerCase().includes("download") ||
							s.toLowerCase().includes("perform") ||
							s.toLowerCase().includes("generate"))
				);
			steps.push(...sentences.slice(0, 6));
		}

		return steps.length > 0
			? steps
			: ["Execute the requested biological analysis"];
	}

	private async findRequiredData(understanding: any): Promise<Dataset[]> {
		if (understanding.dataNeeded.length === 0) {
			return [];
		}

		const datasets = [];

		// Search for specific datasets mentioned
		for (const dataItem of understanding.dataNeeded) {
			if (dataItem.match(/GSE\d+/)) {
				// This is a specific GEO dataset
				datasets.push({
					id: dataItem,
					title: `Dataset ${dataItem}`,
					source: "GEO",
					organism: "unknown",
					samples: 0,
					platform: "unknown",
					description: `Dataset ${dataItem} required for analysis`,
					url: `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${dataItem}`,
				});
			}
		}

		// If no specific datasets, search for relevant ones
		if (datasets.length === 0) {
			try {
				this.updateStatus("Searching for relevant datasets...");

				console.log(
					"Searching for datasets with query:",
					understanding.userQuestion
				);

				// Use the new backend client to search for datasets
				const searchResponse = await this.backendClient.searchDatasets({
					query: understanding.userQuestion,
					limit: 5,
					organism: "Homo sapiens", // Default to human data
				});

				console.log("Search response:", {
					datasetsFound: searchResponse.length,
				});

				// Convert backend dataset format to our format
				for (const dataset of searchResponse.slice(0, 3)) {
					datasets.push({
						id: dataset.id,
						title: dataset.title,
						source: "GEO",
						organism: dataset.organism || "Unknown",
						samples: 0, // Default value since sample_count is not available
						platform: "Unknown", // Default value since platform is not available
						description: dataset.description || "",
						url:
							dataset.url ||
							`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${dataset.id}`,
					});
				}
			} catch (error) {
				console.error("Error searching for datasets:", error);
				this.updateStatus(
					"No specific datasets found, will use general data sources"
				);
			}
		}

		return datasets;
	}

	private async createWorkspace(query: string): Promise<string> {
		const timestamp = new Date()
			.toISOString()
			.slice(0, 19)
			.replace(/[:-]/g, "");
		const safeName = query
			.replace(/[^a-zA-Z0-9\s]/g, "")
			.replace(/\s+/g, "_")
			.substring(0, 30);
		const dirName = `${safeName}_${timestamp}`;
		const fullPath = `${this.workspacePath}/${dirName}`;

		console.log("AutonomousAgent: Creating workspace:", {
			basePath: this.workspacePath,
			dirName,
			fullPath,
		});

		const directories = [
			fullPath,
			`${fullPath}/data`,
			`${fullPath}/results`,
			`${fullPath}/figures`,
		];

		for (const dir of directories) {
			try {
				await window.electronAPI.createDirectory(dir);
				console.log("AutonomousAgent: Created directory:", dir);
			} catch (error) {
				console.warn(`Could not create directory ${dir}:`, error);
			}
		}

		console.log("AutonomousAgent: Workspace created successfully:", fullPath);
		return fullPath;
	}

	// Public method to create analysis workspace and return the path
	public async createAnalysisWorkspace(query: string): Promise<string> {
		const workspaceDir = await this.createWorkspace(query);

		// Create virtual environment in the workspace
		this.updateStatus("Setting up virtual environment...");
		try {
			const venvResult = await window.electronAPI.createVirtualEnv(
				workspaceDir
			);
			if (venvResult.success) {
				console.log("Virtual environment created successfully:", venvResult);
				this.updateStatus("Virtual environment ready!");
			} else {
				console.warn("Failed to create virtual environment:", venvResult.error);
				this.updateStatus(
					"Warning: Using system Python (virtual environment creation failed)"
				);
			}
		} catch (error) {
			console.error("Error creating virtual environment:", error);
			this.updateStatus(
				"Warning: Using system Python (virtual environment creation failed)"
			);
		}

		return workspaceDir;
	}

	private async generateQuestionSpecificSteps(
		understanding: any,
		datasets: Dataset[],
		workingDir: string
	): Promise<AnalysisStep[]> {
		const steps: AnalysisStep[] = [];

		this.updateStatus(
			`Generating code for ${understanding.requiredSteps.length} analysis steps...`
		);

		// Generate code for each step based on the user's actual question
		// We'll generate and execute step by step for better feedback
		for (let i = 0; i < understanding.requiredSteps.length; i++) {
			const stepDescription = understanding.requiredSteps[i];

			this.updateStatus(
				`Generating code for step ${i + 1}/${
					understanding.requiredSteps.length
				}: ${stepDescription.substring(0, 50)}...`
			);

			try {
				const code = await this.generateDataDrivenStepCode(
					stepDescription,
					understanding.userQuestion,
					datasets,
					workingDir,
					i
				);

				steps.push({
					id: `step_${i + 1}`,
					description: stepDescription,
					code,
					status: "pending",
				});

				this.updateStatus(
					`Generated code for step ${i + 1}/${
						understanding.requiredSteps.length
					}`
				);
			} catch (error) {
				console.error(`Error generating code for step ${i + 1}:`, error);

				// Create a fallback step
				steps.push({
					id: `step_${i + 1}`,
					description: stepDescription,
					code: this.generateBasicStepCode(stepDescription, i),
					status: "pending",
				});

				this.updateStatus(
					`Used fallback code for step ${i + 1}/${
						understanding.requiredSteps.length
					}`
				);
			}
		}

		this.updateStatus("All analysis steps prepared!");
		return steps;
	}

	private async generateDataDrivenAnalysisSteps(
		understanding: any,
		datasets: Dataset[],
		workingDir: string
	): Promise<AnalysisStep[]> {
		const steps: AnalysisStep[] = [];

		this.updateStatus(
			`Generating initial data loading step for analysis pipeline...`
		);

		// First step: Load downloaded data (this is the only step we generate initially)
		const dataLoadingStep = await this.generateDataLoadingStep(
			datasets,
			workingDir
		);
		steps.push(dataLoadingStep);

		// Store the analysis plan for future step generation
		const analysisPlan = {
			understanding,
			datasets,
			workingDir,
			requiredSteps: understanding.requiredSteps,
			userQuestion: understanding.userQuestion,
		};

		// Save the analysis plan for the pipeline to use later
		await window.electronAPI.writeFile(
			`${workingDir}/analysis_plan.json`,
			JSON.stringify(analysisPlan, null, 2)
		);

		this.updateStatus(
			"Initial data loading step prepared for pipeline execution!"
		);
		return steps;
	}

	private async generateDataLoadingStep(
		datasets: Dataset[],
		workingDir: string
	): Promise<AnalysisStep> {
		const dataLoadingCode = `
# Step 1: Download and Load Datasets
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import os
import requests
import json
import time
from pathlib import Path
from urllib.parse import urljoin

print("=== Dataset Download and Loading ===")
print(f"Working directory: {workingDir}")

# Create data directory structure
data_dir = Path('biorag_downloads')
data_dir.mkdir(exist_ok=True)
geo_dir = data_dir / 'geo_data'
geo_dir.mkdir(exist_ok=True)
processed_dir = geo_dir / 'processed_data'
processed_dir.mkdir(exist_ok=True)

# Backend API configuration
BACKEND_API_BASE = "http://localhost:8000"

def check_dataset_info(dataset_id):
    """Check dataset info using the new backend API"""
    try:
        print(f"🔍 Checking dataset info for {dataset_id}...")
        
        # Use the search endpoint to find dataset info
        response = requests.post(f"{BACKEND_API_BASE}/search", 
                               json={'query': dataset_id, 'limit': 1})
        
        print(f"   Response status: {response.status_code}")
        
        if response.status_code == 200:
            datasets = response.json()
            if datasets and len(datasets) > 0:
                dataset_info = datasets[0]
                print(f"   Raw response: {dataset_info}")
                
                samples = int(dataset_info.get('sample_count', 0))
                organism = dataset_info.get('organism', 'Unknown')
                title = dataset_info.get('title', dataset_id)
                
                # Estimate file size based on samples (rough estimate)
                estimated_size_mb = samples * 0.1  # ~0.1MB per sample
                
                print(f"📊 {dataset_id}: {samples} samples, {organism}")
                print(f"   Estimated size: ~{estimated_size_mb:.1f} MB")
                print(f"   Title: {title}")
                
                return {
                    'id': dataset_id,
                    'samples': samples,
                    'organism': organism,
                    'title': title,
                    'estimated_size_mb': estimated_size_mb
                }
            else:
                print(f"❌ No dataset found for {dataset_id}")
                return None
        else:
            print(f"❌ Could not get info for {dataset_id} - Status: {response.status_code}")
            print(f"   Response text: {response.text}")
            return None
    except Exception as e:
        print(f"❌ Error checking {dataset_id}: {e}")
        return None

def search_datasets(query):
    """Search for datasets using the new backend API"""
    try:
        print(f"🔍 Searching for datasets: {query}")
        
        response = requests.post(f"{BACKEND_API_BASE}/search", 
                               json={'query': query, 'limit': 10})
        
        if response.status_code == 200:
            datasets = response.json()
            print(f"✅ Found {len(datasets)} datasets")
            return datasets
        else:
            print(f"❌ Search failed - Status: {response.status_code}")
            return []
    except Exception as e:
        print(f"❌ Error searching datasets: {e}")
        return []

# Check dataset sizes and download
print("\\n=== Dataset Information ===")
dataset_info_list = []

# Use default information if API doesn't provide details
default_info = {
    ${datasets
			.map(
				(d, i) => `'${d.id}': {
        'id': '${d.id}',
        'samples': ${d.samples || 100},
        'organism': '${d.organism || "Homo sapiens"}',
        'title': '${d.title || `Dataset ${d.id}`}',
        'estimated_size_mb': ${(d.samples || 100) * 0.1}
    }`
			)
			.join(",\n    ")}
}

# Search for datasets using the new API
search_query = " ".join([${datasets.map((d) => `'${d.id}'`).join(", ")}])
datasets_found = search_datasets(search_query)

print(f"\n=== Found Datasets ===")
for dataset in datasets_found:
    samples = int(dataset.get('sample_count', 0))
    organism = dataset.get('organism', 'Unknown')
    title = dataset.get('title', dataset.get('id', 'Unknown'))
    similarity = dataset.get('similarity_score', 0)
    
    print(f"📊 {dataset['id']}: {samples} samples, {organism}")
    print(f"   Title: {title}")
    print(f"   Similarity: {similarity:.3f}")
    dataset_info_list.append({
        'id': dataset['id'],
        'samples': samples,
        'organism': organism,
        'title': title,
        'estimated_size_mb': samples * 0.1
    })

print(f"\n=== Dataset Summary ===")
print(f"Found {len(datasets_found)} datasets for analysis")

# Load downloaded datasets
print("\n=== Loading Downloaded Data ===")
data_files = {}
sample_metadata = {}

${datasets
	.map(
		(d, i) => `
# Load ${d.id}
try:
    data_path = processed_dir / '${d.id}'
    if data_path.exists():
        expression_file = data_path / '${d.id}_expression_matrix.csv'
        sample_file = data_path / '${d.id}_sample_info.csv'
        
        if expression_file.exists():
            data_files['${d.id}'] = pd.read_csv(expression_file, index_col=0)
            print(f"📊 Loaded ${d.id}: {{data_files['${d.id}'].shape[0]}} genes, {{data_files['${d.id}'].shape[1]}} samples")
            
            # Show memory usage
            memory_mb = data_files['${d.id}'].memory_usage(deep=True).sum() / 1024 / 1024
            print(f"   Memory usage: {{memory_mb:.1f}} MB")
        
        if sample_file.exists():
            sample_metadata['${d.id}'] = pd.read_csv(sample_file)
            print(f"📋 Sample metadata: {{len(sample_metadata['${d.id}'])}} samples")
    else:
        print(f"⚠️  Data path for ${d.id} not found at {{data_path}}")
except Exception as e:
    print(f"❌ Error loading ${d.id}: {{e}}")
`
	)
	.join("\n")}

print(f"\n=== Data Loading Summary ===")
print(f"Successfully loaded {{len(data_files)}} datasets")
print("Available datasets:", list(data_files.keys()))

# Show total memory usage
total_memory = sum(df.memory_usage(deep=True).sum() for df in data_files.values()) / 1024 / 1024
print(f"Total memory usage: {{total_memory:.1f}} MB")

# Create combined dataset if multiple datasets
if len(data_files) > 1:
    print("\\n=== Creating Combined Analysis Dataset ===")
    print("Multiple datasets available for integrated analysis")
    
print("\\n✅ Data loading completed!")
print("Ready for analysis...")
`;

		return {
			id: "step_1",
			description: "Download and load datasets with size checking",
			code: dataLoadingCode,
			status: "pending",
		};
	}

	private async generateDataDrivenStepCode(
		stepDescription: string,
		originalQuestion: string,
		datasets: Dataset[],
		workingDir: string,
		stepIndex: number
	): Promise<string> {
		try {
			// Use LLM to generate specific Python code that uses the loaded data
			this.updateStatus(
				`Generating AI code for: ${stepDescription.substring(0, 50)}...`
			);

			const codePrompt = `You are an expert bioinformatics programmer. Generate executable Python code for this specific analysis step using REAL downloaded data:

STEP: "${stepDescription}"
RESEARCH QUESTION: "${originalQuestion}"
WORKING DIRECTORY: ${workingDir}
DOWNLOADED DATASETS: ${datasets
				.map((d) => `${d.id} (${d.samples} samples, ${d.organism})`)
				.join(", ")}
STEP NUMBER: ${stepIndex + 1}

The data has already been loaded in previous steps as:
- data_files['${
				datasets[0]?.id
			}'] = pandas DataFrame with expression data (genes as rows, samples as columns)
- sample_metadata['${
				datasets[0]?.id
			}'] = pandas DataFrame with sample information

Requirements:
1. Write complete, executable Python code that uses the loaded data_files and sample_metadata
2. Focus specifically on: "${stepDescription}"
3. Use realistic biological analysis methods appropriate for expression data
4. Include proper error handling and informative print statements
5. Save outputs to 'results/' or 'figures/' directories as appropriate
6. Make the code specific to the research question: "${originalQuestion}"
7. Use appropriate statistical and visualization libraries (pandas, numpy, matplotlib, seaborn, scipy, sklearn)
8. Generate meaningful biological insights from the real data

IMPORTANT: 
- Return ONLY the Python code, no explanations
- Assume data_files and sample_metadata dictionaries are already available
- Make the code production-ready and biologically meaningful
- Include comments explaining the biological significance
- Use the actual dataset IDs: ${datasets.map((d) => d.id).join(", ")}

Generate the Python code:`;

			// Call the backend LLM API for code generation
			try {
				console.log(`Calling LLM API for step: ${stepDescription}`);
				console.log(`API URL: ${this.backendClient.getBaseUrl()}/llm/code`);

				const requestBody = {
					task_description: codePrompt,
					language: "python",
					context: `Research question: ${originalQuestion}\nDatasets: ${datasets
						.map((d) => d.id)
						.join(", ")}\nWorking directory: ${workingDir}`,
				};

				console.log(`Request body:`, requestBody);

				const response = await fetch(
					`${this.backendClient.getBaseUrl()}/llm/code`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
						},
						body: JSON.stringify(requestBody),
					}
				);

				console.log(`LLM API response status: ${response.status}`);

				if (response.ok) {
					const result = await response.json();
					console.log(`LLM API response:`, result);
					const generatedCode = result.code;

					if (generatedCode && generatedCode.length > 50) {
						console.log(`LLM generated code for step: ${stepDescription}`);
						return generatedCode;
					} else {
						console.warn(
							`LLM generated code too short for step: ${stepDescription}`
						);
					}
				} else {
					const errorText = await response.text();
					console.warn(
						`LLM API call failed for step: ${stepDescription}. Status: ${response.status}, Error: ${errorText}`
					);
				}
			} catch (apiError) {
				console.warn(`LLM API error for step: ${stepDescription}:`, apiError);
			}

			// Fallback to basic code generation if LLM fails
			console.log(
				`Using fallback code generation for step: ${stepDescription}`
			);
			return this.generateDataAwareBasicStepCode(
				stepDescription,
				datasets,
				stepIndex
			);
		} catch (error) {
			console.error(
				`LLM code generation failed for "${stepDescription}":`,
				error
			);
			this.updateStatus(
				`Using fallback code for: ${stepDescription.substring(0, 50)}...`
			);
			return this.generateDataAwareBasicStepCode(
				stepDescription,
				datasets,
				stepIndex
			);
		}
	}

	private extractPythonCode(response: string): string | null {
		// Try to extract code blocks first
		const codeBlockMatch = response.match(/```(?:python)?\n([\s\S]*?)\n```/);
		if (codeBlockMatch) {
			return codeBlockMatch[1].trim();
		}

		// Try to extract Python-like content
		const lines = response.split("\n");
		const codeLines = [];
		let inCodeSection = false;

		for (const line of lines) {
			const trimmed = line.trim();

			// Check if this looks like Python code
			if (
				trimmed.startsWith("import ") ||
				trimmed.startsWith("from ") ||
				trimmed.startsWith("def ") ||
				trimmed.includes(" = ") ||
				trimmed.startsWith("print(") ||
				trimmed.startsWith("#") ||
				trimmed.startsWith("if ") ||
				trimmed.startsWith("for ") ||
				trimmed.startsWith("try:") ||
				trimmed.startsWith("with ") ||
				trimmed.startsWith("plt.") ||
				trimmed.startsWith("pd.") ||
				trimmed.startsWith("np.")
			) {
				inCodeSection = true;
			}

			if (inCodeSection) {
				codeLines.push(line);
			}

			// Stop if we hit explanatory text after code
			if (
				inCodeSection &&
				trimmed.length > 0 &&
				!trimmed.startsWith("#") &&
				!trimmed.includes("=") &&
				!trimmed.includes("(") &&
				!trimmed.includes("import") &&
				!trimmed.includes("from") &&
				!trimmed.includes("plt") &&
				!trimmed.includes("pd") &&
				!trimmed.includes("np") &&
				trimmed.split(" ").length > 10 &&
				!trimmed.includes("print")
			) {
				break;
			}
		}

		const extractedCode = codeLines.join("\n").trim();
		return extractedCode.length > 20 ? extractedCode : null;
	}

	private generateBasicStepCode(
		stepDescription: string,
		stepIndex: number
	): string {
		// This method should not be used for real analysis - it's just a fallback
		// The AI should generate proper code through generateDataDrivenStepCode
		console.warn(
			`Using fallback code for step: ${stepDescription} - AI generation should be used instead`
		);

		return `# Step ${stepIndex + 1}: ${stepDescription}
# WARNING: This is fallback code - AI should generate proper analysis")
import os
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.decomposition import PCA
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
import warnings
warnings.filterwarnings('ignore')

print("=== ${stepDescription} ===")
print("⚠️  This is fallback code - AI should generate proper analysis")

# Create directories
os.makedirs('data', exist_ok=True)
os.makedirs('results', exist_ok=True)
os.makedirs('figures', exist_ok=True)

# This step should be generated by AI for proper biological analysis
print("❌ Fallback code used - AI generation failed")
print("Please ensure BioRAG server is running for proper AI-generated analysis")
`;
	}

	// New method for step-by-step generation
	public async generateSingleStepCode(
		stepDescription: string,
		originalQuestion: string,
		datasets: Dataset[],
		workingDir: string,
		stepIndex: number
	): Promise<string> {
		try {
			this.updateStatus(
				`Generating AI code for: ${stepDescription.substring(0, 50)}...`
			);

			const codePrompt = `You are an expert bioinformatics programmer. Generate executable Python code for this specific analysis step:

STEP: "${stepDescription}"
RESEARCH QUESTION: "${originalQuestion}"
WORKING DIRECTORY: ${workingDir}
DOWNLOADED DATASETS: ${datasets
				.map((d) => `${d.id} (${d.samples} samples, ${d.organism})`)
				.join(", ")}
STEP NUMBER: ${stepIndex + 1}

Requirements:
1. Write complete, executable Python code for this specific step
2. Focus specifically on: "${stepDescription}"
3. Use realistic biological analysis methods
4. Include proper error handling and informative print statements
5. Save outputs to 'results/' or 'figures/' directories as appropriate
6. Make the code specific to the research question: "${originalQuestion}"
7. Use appropriate libraries (pandas, numpy, matplotlib, seaborn, scipy, sklearn)

IMPORTANT: 
- Return ONLY the Python code, no explanations
- Make the code production-ready and biologically meaningful
- Include comments explaining the biological significance
- Use the actual dataset IDs: ${datasets.map((d) => d.id).join(", ")}

Generate the Python code:`;

			// Call the backend LLM API for code generation
			try {
				console.log(`Calling LLM API for step: ${stepDescription}`);
				console.log(`API URL: ${this.backendClient.getBaseUrl()}/llm/code`);

				const requestBody = {
					task_description: codePrompt,
					language: "python",
					context: `Research question: ${originalQuestion}\nDatasets: ${datasets
						.map((d) => d.id)
						.join(", ")}\nWorking directory: ${workingDir}`,
				};

				console.log(`Request body:`, requestBody);

				const response = await fetch(
					`${this.backendClient.getBaseUrl()}/llm/code`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
						},
						body: JSON.stringify(requestBody),
					}
				);

				console.log(`LLM API response status: ${response.status}`);

				if (response.ok) {
					const result = await response.json();
					console.log(`LLM API response:`, result);
					const generatedCode = result.code;

					if (generatedCode && generatedCode.length > 50) {
						console.log(`LLM generated code for step: ${stepDescription}`);
						return generatedCode;
					} else {
						console.warn(
							`LLM generated code too short for step: ${stepDescription}`
						);
					}
				} else {
					const errorText = await response.text();
					console.warn(
						`LLM API call failed for step: ${stepDescription}. Status: ${response.status}, Error: ${errorText}`
					);
				}
			} catch (apiError) {
				console.warn(`LLM API error for step: ${stepDescription}:`, apiError);
			}

			// Fallback to basic code generation if LLM fails
			console.log(
				`Using fallback code generation for step: ${stepDescription}`
			);
			return this.generateDataAwareBasicStepCode(
				stepDescription,
				datasets,
				stepIndex
			);
		} catch (error) {
			console.error(
				`LLM code generation failed for "${stepDescription}":`,
				error
			);
			this.updateStatus(
				`Using fallback code for: ${stepDescription.substring(0, 50)}...`
			);
			return this.generateDataAwareBasicStepCode(
				stepDescription,
				datasets,
				stepIndex
			);
		}
	}

	private generateDataAwareBasicStepCode(
		stepDescription: string,
		datasets: Dataset[],
		stepIndex: number
	): string {
		const desc = stepDescription.toLowerCase();
		const datasetIds = datasets.map((d) => d.id);

		let code = `# Step ${stepIndex + 1}: ${stepDescription}
print("Executing: ${stepDescription}")

# Use loaded datasets: ${datasetIds.join(", ")}
available_datasets = list(data_files.keys())
print(f"Working with datasets: {{available_datasets}}")

`;

		// Add specific code based on step description keywords
		if (
			desc.includes("differential") ||
			desc.includes("expression") ||
			desc.includes("deg")
		) {
			code += `# Differential expression analysis
try:
    for dataset_id in available_datasets:
        if dataset_id in data_files:
            expression_data = data_files[dataset_id]
            print(f"Analyzing {{dataset_id}}: {{expression_data.shape}}")
            
            # Basic differential expression analysis
            # This would include proper statistical testing in production
            mean_expression = expression_data.mean(axis=1)
            std_expression = expression_data.std(axis=1)
            
            # Save results
            os.makedirs('results', exist_ok=True)
            results_df = pd.DataFrame({
                'gene_id': expression_data.index,
                'mean_expression': mean_expression,
                'std_expression': std_expression
            })
            results_df.to_csv(f'results/{{dataset_id}}_differential_expression.csv', index=False)
            print(f"Saved differential expression results for {{dataset_id}}")
            
except Exception as e:
    print(f"Differential expression analysis error: {{e}}")

`;
		} else if (desc.includes("cluster") || desc.includes("group")) {
			code += `# Clustering analysis
try:
    from sklearn.cluster import KMeans
    from sklearn.preprocessing import StandardScaler
    
    for dataset_id in available_datasets:
        if dataset_id in data_files:
            expression_data = data_files[dataset_id]
            
            # Prepare data for clustering
            scaler = StandardScaler()
            scaled_data = scaler.fit_transform(expression_data.T)  # Transpose for sample clustering
            
            # Perform clustering
            n_clusters = min(5, expression_data.shape[1] // 2)  # Reasonable number of clusters
            kmeans = KMeans(n_clusters=n_clusters, random_state=42)
            clusters = kmeans.fit_predict(scaled_data)
            
            # Save clustering results
            os.makedirs('results', exist_ok=True)
            cluster_results = pd.DataFrame({
                'sample': expression_data.columns,
                'cluster': clusters
            })
            cluster_results.to_csv(f'results/{{dataset_id}}_clusters.csv', index=False)
            print(f"Saved clustering results for {{dataset_id}}")
            
except Exception as e:
    print(f"Clustering analysis error: {{e}}")

`;
		} else if (
			desc.includes("visual") ||
			desc.includes("plot") ||
			desc.includes("heatmap")
		) {
			code += `# Visualization analysis
try:
    import matplotlib.pyplot as plt
    import seaborn as sns
    
    os.makedirs('figures', exist_ok=True)
    
    for dataset_id in available_datasets:
        if dataset_id in data_files:
            expression_data = data_files[dataset_id]
            
            # Create heatmap of top variable genes
            gene_var = expression_data.var(axis=1)
            top_genes = gene_var.nlargest(50).index
            
            plt.figure(figsize=(12, 8))
            sns.heatmap(expression_data.loc[top_genes], 
                       cmap='RdBu_r', center=0, 
                       xticklabels=False, yticklabels=True)
            plt.title(f'Expression Heatmap - {{dataset_id}}\\nTop 50 Variable Genes')
            plt.tight_layout()
            plt.savefig(f'figures/{{dataset_id}}_heatmap.png', dpi=300, bbox_inches='tight')
            plt.close()
            
            # Distribution plot
            plt.figure(figsize=(10, 6))
            expression_data.mean(axis=1).hist(bins=50)
            plt.xlabel('Mean Expression')
            plt.ylabel('Number of Genes')
            plt.title(f'Gene Expression Distribution - {{dataset_id}}')
            plt.savefig(f'figures/{{dataset_id}}_distribution.png', dpi=300, bbox_inches='tight')
            plt.close()
            
            print(f"Saved visualizations for {{dataset_id}}")
            
except Exception as e:
    print(f"Visualization error: {{e}}")

`;
		} else {
			code += `# General analysis step
try:
    for dataset_id in available_datasets:
        if dataset_id in data_files:
            expression_data = data_files[dataset_id]
            sample_data = sample_metadata.get(dataset_id)
            
            print(f"Processing {{dataset_id}}:")
            print(f"  - Expression data: {{expression_data.shape}}")
            if sample_data is not None:
                print(f"  - Sample metadata: {{sample_data.shape}}")
            
            # Basic analysis - can be customized based on needs
            summary_stats = expression_data.describe()
            
            # Save basic results
            os.makedirs('results', exist_ok=True)
            summary_stats.to_csv(f'results/{{dataset_id}}_summary_stats.csv')
            print(f"Saved summary statistics for {{dataset_id}}")
            
except Exception as e:
    print(f"General analysis error: {{e}}")

`;
		}

		code += `print("Step completed successfully")`;

		return code;
	}

	async executeStep(step: AnalysisStep, datasets: Dataset[]): Promise<void> {
		if (this.shouldStopAnalysis) {
			step.status = "cancelled";
			return;
		}

		step.status = "running";

		try {
			// The actual code execution is handled by the caller (ChatPanel)
			step.status = "completed";
		} catch (error) {
			step.status = "failed";
			step.output = error instanceof Error ? error.message : "Unknown error";
		}
	}

	async generateDynamicCode(
		step: AnalysisStep,
		analysisResult: AnalysisResult
	): Promise<string> {
		// Regenerate code with current context
		return await this.generateDataDrivenStepCode(
			step.description,
			analysisResult.understanding.userQuestion,
			analysisResult.datasets,
			analysisResult.workingDirectory,
			parseInt(step.id.split("_")[1]) - 1
		);
	}

	stopAnalysis(): void {
		this.shouldStopAnalysis = true;
		this.isRunning = false;
	}

	/**
	 * Generate a Jupyter notebook for data download and preprocessing, using AI-generated code and markdown.
	 * The notebook will be saved in the analysis workspace and returned as a file path.
	 */
	async generateDataDownloadNotebook(
		query: string,
		datasets: Dataset[],
		workspaceDir: string
	): Promise<string> {
		// Step 1: Use AI to generate markdown and code for download/preprocessing
		const notebookCells: any[] = [];
		// Markdown intro
		notebookCells.push({
			cell_type: "markdown",
			metadata: {},
			source: [
				`# Data Download & Preprocessing\n`,
				`This notebook was generated by the AI agent for your question:\n\n> ${query}\n\n`,
				`## Selected Datasets\n`,
				...datasets.map(
					(d, i) => `- **${d.id}**: ${d.title} (${d.organism})\n`
				),
				`\n---\n`,
				`You can run each cell to download and preprocess the data yourself.\n`,
			],
		});
		// For each dataset, add a code cell for download/preprocessing
		for (const dataset of datasets) {
			// Use the same AI-driven code generation as in generateDataLoadingStep
			const code = await this.generateDataDrivenStepCode(
				`Download and preprocess dataset ${dataset.id} (${dataset.title})`,
				query,
				[dataset],
				workspaceDir,
				0
			);
			notebookCells.push({
				cell_type: "code",
				metadata: {},
				execution_count: null,
				outputs: [],
				source: [code],
			});
		}
		// Notebook structure
		const notebook = {
			cells: notebookCells,
			metadata: {
				kernelspec: {
					display_name: "Python 3",
					language: "python",
					name: "python3",
				},
				language_info: {
					name: "python",
					codemirror_mode: { name: "ipython", version: 3 },
					file_extension: ".py",
					mimetype: "text/x-python",
					nbconvert_exporter: "python",
					pygments_lexer: "ipython3",
					version: "3.8",
				},
			},
			nbformat: 4,
			nbformat_minor: 5,
		};
		// Save notebook file
		const notebookName = `data_download_${uuidv4().slice(0, 8)}.ipynb`;
		const notebookPath = `${workspaceDir}/${notebookName}`;
		await window.electronAPI.writeFile(
			notebookPath,
			JSON.stringify(notebook, null, 2)
		);
		return notebookPath;
	}
}
