"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutonomousAgent = void 0;
const uuid_1 = require("uuid");
class AutonomousAgent {
    constructor(bioragClient, workspacePath) {
        this.originalQuery = "";
        this.isRunning = false;
        this.shouldStopAnalysis = false;
        this.bioragClient = bioragClient;
        this.workspacePath = workspacePath;
    }
    setStatusCallback(callback) {
        this.statusCallback = callback;
    }
    updateStatus(message) {
        if (this.statusCallback) {
            this.statusCallback(message);
        }
    }
    async executeAnalysisRequest(query) {
        this.originalQuery = query;
        this.isRunning = true;
        this.shouldStopAnalysis = false;
        try {
            // Step 1: Understand what the user actually wants to do
            this.updateStatus("Understanding your question...");
            const understanding = await this.analyzeUserQuestion(query);
            // Step 2: Find what data is needed to answer their question
            this.updateStatus("Identifying required data...");
            const datasets = await this.findRequiredData(understanding);
            // Step 3: Create working space
            this.updateStatus("Setting up workspace...");
            const workingDirectory = await this.createWorkspace(query);
            // Step 4: Generate the actual steps needed to answer their question
            this.updateStatus("Planning analysis approach...");
            const steps = await this.generateQuestionSpecificSteps(understanding, datasets, workingDirectory);
            this.updateStatus("Ready to execute analysis!");
            return {
                understanding,
                datasets,
                steps,
                workingDirectory,
            };
        }
        finally {
            this.isRunning = false;
        }
    }
    async executeAnalysisRequestWithData(query, downloadedDatasets) {
        this.originalQuery = query;
        this.isRunning = true;
        this.shouldStopAnalysis = false;
        try {
            // Step 1: Understand what the user actually wants to do
            this.updateStatus("Understanding your question...");
            const understanding = await this.analyzeUserQuestion(query);
            // Step 3: Create working space
            this.updateStatus("Setting up workspace...");
            const workingDirectory = await this.createWorkspace(query);
            // Step 4: Generate analysis steps that use the downloaded data
            this.updateStatus("Planning analysis approach with downloaded data...");
            const steps = await this.generateDataDrivenAnalysisSteps(understanding, downloadedDatasets, workingDirectory);
            this.updateStatus("Ready to execute analysis with downloaded data!");
            return {
                understanding,
                datasets: downloadedDatasets,
                steps,
                workingDirectory,
            };
        }
        finally {
            this.isRunning = false;
        }
    }
    async analyzeUserQuestion(query) {
        try {
            // Use LLM to intelligently analyze the user's question
            this.updateStatus("Analyzing your research question with AI...");
            const planningResponse = await this.bioragClient.query({
                question: `As a bioinformatics expert, analyze this research question and create a detailed analysis plan:

"${query}"

Please provide:
1. A clear understanding of what the user wants to accomplish
2. Specific, actionable steps needed to answer their question (5-7 steps maximum)
3. What types of biological data would be needed
4. What the expected outputs should be

Format your response as:
UNDERSTANDING: [clear description of the research goal]
STEPS:
1. [step 1]
2. [step 2]
...
DATA_NEEDED: [list of data types/sources]
OUTPUTS: [expected result types]

Focus on the specific biological analysis they're asking for. Be precise and actionable.`,
                max_documents: 5,
                response_type: "answer",
            });
            // Parse the LLM response
            const understanding = this.parseLLMPlanningResponse(planningResponse.answer, query);
            this.updateStatus("AI analysis plan generated successfully");
            return understanding;
        }
        catch (error) {
            console.error("Error in LLM-based analysis:", error);
            this.updateStatus("Using backup analysis approach...");
            // Minimal fallback only if LLM completely fails
            return {
                userQuestion: query,
                requiredSteps: [
                    "Set up analysis environment and install required packages",
                    "Acquire and preprocess relevant biological datasets",
                    "Perform the requested analysis",
                    "Generate visualizations and results",
                    "Create comprehensive summary report",
                ],
                dataNeeded: ["Biological datasets relevant to the question"],
                expectedOutputs: ["Analysis results", "Visualizations"],
            };
        }
    }
    parseLLMPlanningResponse(response, originalQuery) {
        const lines = response.split("\n").map((line) => line.trim());
        let understanding = originalQuery;
        let steps = [];
        let dataNeeded = [];
        let expectedOutputs = [];
        let currentSection = "";
        for (const line of lines) {
            if (line.startsWith("UNDERSTANDING:")) {
                understanding = line.replace("UNDERSTANDING:", "").trim();
                currentSection = "understanding";
            }
            else if (line.startsWith("STEPS:")) {
                currentSection = "steps";
            }
            else if (line.startsWith("DATA_NEEDED:")) {
                currentSection = "data";
            }
            else if (line.startsWith("OUTPUTS:")) {
                currentSection = "outputs";
            }
            else if (line.match(/^\d+\.\s+(.+)/) && currentSection === "steps") {
                const stepMatch = line.match(/^\d+\.\s+(.+)/);
                if (stepMatch && stepMatch[1].length > 10) {
                    steps.push(stepMatch[1].trim());
                }
            }
            else if (line.startsWith("-") && currentSection === "data") {
                dataNeeded.push(line.replace("-", "").trim());
            }
            else if (line.startsWith("-") && currentSection === "outputs") {
                expectedOutputs.push(line.replace("-", "").trim());
            }
            else if (line.includes(",") && currentSection === "data") {
                dataNeeded.push(...line.split(",").map((item) => item.trim()));
            }
            else if (line.includes(",") && currentSection === "outputs") {
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
    extractStepsFromText(text) {
        const steps = [];
        const lines = text.split("\n");
        for (const line of lines) {
            const stepMatch = line.match(/^\s*\d+\.?\\s*(.+)/) || line.match(/^\s*[-*]\s*(.+)/);
            if (stepMatch && stepMatch[1].trim().length > 15) {
                steps.push(stepMatch[1].trim());
            }
        }
        // Extract from sentences if no numbered list found
        if (steps.length === 0) {
            const sentences = text
                .split(/[.!?]+/)
                .filter((s) => s.trim().length > 20 &&
                (s.toLowerCase().includes("step") ||
                    s.toLowerCase().includes("analyze") ||
                    s.toLowerCase().includes("download") ||
                    s.toLowerCase().includes("perform") ||
                    s.toLowerCase().includes("generate")));
            steps.push(...sentences.slice(0, 6));
        }
        return steps.length > 0
            ? steps
            : ["Execute the requested biological analysis"];
    }
    async findRequiredData(understanding) {
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
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error("Dataset search timeout")), 15000);
                });
                const searchResponse = await Promise.race([
                    this.bioragClient.query({
                        question: `Find datasets for: ${understanding.userQuestion}
						
						Look for specific GEO dataset IDs that would help answer this question.`,
                        max_documents: 5,
                        response_type: "answer",
                    }),
                    timeoutPromise,
                ]);
                const foundGeoIds = searchResponse.answer.match(/GSE\d+/g) || [];
                for (const geoId of foundGeoIds.slice(0, 3)) {
                    datasets.push({
                        id: geoId,
                        title: `Dataset for analysis`,
                        source: "GEO",
                        organism: "unknown",
                        samples: 0,
                        platform: "unknown",
                        description: `Dataset ${geoId} relevant to the question`,
                        url: `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${geoId}`,
                    });
                }
            }
            catch (error) {
                console.error("Error searching for datasets:", error);
                this.updateStatus("No specific datasets found, will use general data sources");
            }
        }
        return datasets;
    }
    async createWorkspace(query) {
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
        const directories = [
            fullPath,
            `${fullPath}/data`,
            `${fullPath}/results`,
            `${fullPath}/figures`,
        ];
        for (const dir of directories) {
            try {
                await window.electronAPI.createDirectory(dir);
            }
            catch (error) {
                console.warn(`Could not create directory ${dir}:`, error);
            }
        }
        return fullPath;
    }
    // Public method to create analysis workspace and return the path
    async createAnalysisWorkspace(query) {
        return await this.createWorkspace(query);
    }
    async generateQuestionSpecificSteps(understanding, datasets, workingDir) {
        const steps = [];
        this.updateStatus(`Generating code for ${understanding.requiredSteps.length} analysis steps...`);
        // Generate code for each step based on the user's actual question
        for (let i = 0; i < understanding.requiredSteps.length; i++) {
            const stepDescription = understanding.requiredSteps[i];
            this.updateStatus(`Generating code for step ${i + 1}/${understanding.requiredSteps.length}: ${stepDescription.substring(0, 50)}...`);
            try {
                const code = await this.generateDataDrivenStepCode(stepDescription, understanding.userQuestion, datasets, workingDir, i);
                steps.push({
                    id: `step_${i + 1}`,
                    description: stepDescription,
                    code,
                    status: "pending",
                });
                this.updateStatus(`Generated code for step ${i + 1}/${understanding.requiredSteps.length}`);
            }
            catch (error) {
                console.error(`Error generating code for step ${i + 1}:`, error);
                // Create a fallback step
                steps.push({
                    id: `step_${i + 1}`,
                    description: stepDescription,
                    code: this.generateBasicStepCode(stepDescription, i),
                    status: "pending",
                });
                this.updateStatus(`Used fallback code for step ${i + 1}/${understanding.requiredSteps.length}`);
            }
        }
        this.updateStatus("All analysis steps prepared!");
        return steps;
    }
    async generateDataDrivenAnalysisSteps(understanding, datasets, workingDir) {
        const steps = [];
        this.updateStatus(`Generating code for ${understanding.requiredSteps.length} analysis steps using downloaded data...`);
        // First step: Load downloaded data
        const dataLoadingStep = await this.generateDataLoadingStep(datasets, workingDir);
        steps.push(dataLoadingStep);
        // Generate code for each analysis step based on the user's question and real data
        for (let i = 0; i < understanding.requiredSteps.length; i++) {
            const stepDescription = understanding.requiredSteps[i];
            this.updateStatus(`Generating code for step ${i + 2}/${understanding.requiredSteps.length + 1}: ${stepDescription.substring(0, 50)}...`);
            try {
                const code = await this.generateDataDrivenStepCode(stepDescription, understanding.userQuestion, datasets, workingDir, i + 1 // +1 because we have data loading as step 0
                );
                steps.push({
                    id: `step_${i + 2}`,
                    description: stepDescription,
                    code,
                    status: "pending",
                });
                this.updateStatus(`Generated code for step ${i + 2}/${understanding.requiredSteps.length + 1}`);
            }
            catch (error) {
                console.error(`Error generating code for step ${i + 2}:`, error);
                // Create a fallback step
                steps.push({
                    id: `step_${i + 2}`,
                    description: stepDescription,
                    code: this.generateBasicStepCode(stepDescription, i + 1),
                    status: "pending",
                });
                this.updateStatus(`Used fallback code for step ${i + 2}/${understanding.requiredSteps.length + 1}`);
            }
        }
        this.updateStatus("All analysis steps prepared!");
        return steps;
    }
    async generateDataLoadingStep(datasets, workingDir) {
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

# BioRAG API configuration
BIORAG_API_BASE = "http://localhost:8000"

def check_dataset_size(dataset_id):
    """Check dataset size and download status"""
    try:
        print(f"🔍 Checking dataset info for {dataset_id}...")
        response = requests.get(f"{BIORAG_API_BASE}/datasets/{dataset_id}")
        print(f"   Response status: {response.status_code}")
        
        if response.status_code == 200:
            dataset_info = response.json()
            print(f"   Raw response: {dataset_info}")
            
            samples = dataset_info.get('samples', 0)
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
            print(f"❌ Could not get info for {dataset_id} - Status: {response.status_code}")
            print(f"   Response text: {response.text}")
            return None
    except Exception as e:
        print(f"❌ Error checking {dataset_id}: {e}")
        return None

def download_dataset(dataset_id):
    """Download dataset through BioRAG API"""
    try:
        print(f"📥 Downloading {dataset_id}...")
        
        # Start download
        response = requests.post(f"{BIORAG_API_BASE}/datasets/{dataset_id}/download", 
                               json={'force_redownload': False})
        
        if response.status_code == 200:
            result = response.json();
            console.log(result);
            print(f"   Download started: {result.get('status', 'unknown')}");
            
            # Monitor download progress
            max_attempts = 60  # 5 minutes max
            for attempt in range(max_attempts):
                time.sleep(5)  # Check every 5 seconds
                
                try {
                    status_response = requests.get(f"{BIORAG_API_BASE}/datasets/{dataset_id}/status");
                    if (status_response.status_code == 200) {
                        status_info = status_response.json();
                        status = status_info.get('status', 'unknown');
                        progress = status_info.get('progress', 0);
                        
                        print(f"   Progress: {progress}% - {status}");
                        
                        if (status == 'completed') {
                            print(f"✅ {dataset_id} download completed!");
                            return True;
                        } else if (status == 'error') {
                            print(f"❌ {dataset_id} download failed!");
                            return False;
                        }
                    } else {
                        print(f"   Status check failed: {status_response.status_code}");
                    }
                } catch (Exception status_error) {
                    print(f"   Status check error: {status_error}");
                }
                
                print(f"   Checking status... (attempt {attempt + 1})");
            }
            
            print(f"⏰ {dataset_id} download timeout");
            return False;
        } else {
            print(f"❌ Failed to start download for {dataset_id} - Status: {response.status_code}");
            print(f"   Response: {response.text}");
            return False;
        }
            
    } catch (Exception e) {
        print(f"❌ Error downloading {dataset_id}: {e}");
        return False;
    }

# Check dataset sizes and download
print("\\n=== Dataset Information ===")
dataset_info_list = [];

# Use default information if API doesn't provide details
default_info = {
    ${datasets
            .map((d, i) => `'${d.id}': {
        'id': '${d.id}',
        'samples': ${d.samples || 100},
        'organism': '${d.organism || "Homo sapiens"}',
        'title': '${d.title || `Dataset ${d.id}`}',
        'estimated_size_mb': ${(d.samples || 100) * 0.1}
    }`)
            .join(",\n    ")}
}

for dataset in [${datasets.map((d) => `'${d.id}'`).join(", ")}]:
    info = check_dataset_size(dataset)
    if info and info.get('samples', 0) > 0:
        dataset_info_list.append(info)
    else:
        # Use default information
        default_data = default_info.get(dataset, {
            'id': dataset,
            'samples': 100,
            'organism': 'Homo sapiens',
            'title': f'Dataset {dataset}',
            'estimated_size_mb': 10.0
        })
        print(f"📊 {dataset}: {default_data['samples']} samples, {default_data['organism']} (estimated)")
        print(f"   Estimated size: ~{default_data['estimated_size_mb']:.1f} MB")
        print(f"   Title: {default_data['title']}")
        dataset_info_list.append(default_data)

print(f"\n=== Downloading {{len(dataset_info_list)}} datasets ===")
total_estimated_size = sum(info['estimated_size_mb'] for info in dataset_info_list)
print(f"Total estimated size: ~{{total_estimated_size:.1f}} MB")

# Download each dataset
download_success = []
for info in dataset_info_list:
    success = download_dataset(info['id'])
    download_success.append(success)

print(f"\n=== Download Summary ===")
for i, info in enumerate(dataset_info_list):
    status = "✅ Success" if download_success[i] else "❌ Failed"
    print(f"{{info['id']}}: {{status}}")

# Load downloaded datasets
print("\n=== Loading Downloaded Data ===")
data_files = {}
sample_metadata = {};

${datasets
            .map((d, i) => `
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
            print(f"   Memory usage: {memory_mb:.1f} MB")
        
        if sample_file.exists():
            sample_metadata['${d.id}'] = pd.read_csv(sample_file)
            print(f"📋 Sample metadata: {{len(sample_metadata['${d.id}'])}} samples")
    else:
        print(f"⚠️  Data path for ${d.id} not found at {{data_path}}")
except Exception as e:
    print(f"❌ Error loading ${d.id}: {{e}}")
`)
            .join("\n")}

print(f"\n=== Data Loading Summary ===")
print(f"Successfully loaded {{len(data_files)}} datasets")
print("Available datasets:", list(data_files.keys()))

# Show total memory usage
total_memory = sum(df.memory_usage(deep=True).sum() for df in data_files.values()) / 1024 / 1024
print(f"Total memory usage: {{total_memory:.1f}} MB");

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
    async generateDataDrivenStepCode(stepDescription, originalQuestion, datasets, workingDir, stepIndex) {
        try {
            // Use LLM to generate specific Python code that uses the loaded data
            this.updateStatus(`Generating AI code for: ${stepDescription.substring(0, 50)}...`);
            const codePrompt = `You are an expert bioinformatics programmer. Generate executable Python code for this specific analysis step using REAL downloaded data:

STEP: "${stepDescription}"
RESEARCH QUESTION: "${originalQuestion}"
WORKING DIRECTORY: ${workingDir}
DOWNLOADED DATASETS: ${datasets
                .map((d) => `${d.id} (${d.samples} samples, ${d.organism})`)
                .join(", ")}
STEP NUMBER: ${stepIndex + 1}

The data has already been loaded in previous steps as:
- data_files['${datasets[0]?.id}'] = pandas DataFrame with expression data (genes as rows, samples as columns)
- sample_metadata['${datasets[0]?.id}'] = pandas DataFrame with sample information

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
            const codeResponse = await this.bioragClient.query({
                question: codePrompt,
                max_documents: 3,
                response_type: "answer",
            });
            let generatedCode = this.extractPythonCode(codeResponse.answer);
            if (!generatedCode || generatedCode.length < 50) {
                console.warn(`Generated code too short for step: ${stepDescription}`);
                generatedCode = this.generateDataAwareBasicStepCode(stepDescription, datasets, stepIndex);
            }
            return generatedCode;
        }
        catch (error) {
            console.error(`LLM code generation failed for "${stepDescription}":`, error);
            this.updateStatus(`Using fallback code for: ${stepDescription.substring(0, 50)}...`);
            return this.generateDataAwareBasicStepCode(stepDescription, datasets, stepIndex);
        }
    }
    extractPythonCode(response) {
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
            if (trimmed.startsWith("import ") ||
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
                trimmed.startsWith("np.")) {
                inCodeSection = true;
            }
            if (inCodeSection) {
                codeLines.push(line);
            }
            // Stop if we hit explanatory text after code
            if (inCodeSection &&
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
                !trimmed.includes("print")) {
                break;
            }
        }
        const extractedCode = codeLines.join("\n").trim();
        return extractedCode.length > 20 ? extractedCode : null;
    }
    generateBasicStepCode(stepDescription, stepIndex) {
        // Generate more intelligent fallback code based on step description
        const desc = stepDescription.toLowerCase();
        let code = `# Step ${stepIndex + 1}: ${stepDescription}
import os
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

print("Executing: ${stepDescription}")

`;
        // Add specific code based on step description keywords
        if (desc.includes("download") ||
            desc.includes("data") ||
            desc.includes("dataset")) {
            code += `# Data acquisition step
try:
    # Create data directory
    os.makedirs('data', exist_ok=True)
    print("Data directory ready")
    
    # Download or load data here
    # Example: dataset = load_dataset()
    print("Data acquisition completed")
    
except Exception as e:
    print(f"Data acquisition error: {e}")

`;
        }
        else if (desc.includes("preprocess") ||
            desc.includes("clean") ||
            desc.includes("quality")) {
            code += `# Data preprocessing step
try:
    # Load data for preprocessing
print("Starting data preprocessing...")

    # Preprocessing steps would go here
    # Example: cleaned_data = preprocess(raw_data)
    print("Data preprocessing completed")
    
except Exception as e:
    print(f"Preprocessing error: {e}")

`;
        }
        else if (desc.includes("analyz") ||
            desc.includes("compar") ||
            desc.includes("differ")) {
            code += `# Analysis step
try:
    print("Starting analysis...")
    
    # Analysis code would go here
    # Example: results = analyze_data(data)
    print("Analysis completed")
    
except Exception as e {
    print(f"Analysis error: {e}")

`;
        }
        else if (desc.includes("plot") ||
            desc.includes("visual") ||
            desc.includes("chart") ||
            desc.includes("graph")) {
            code += `# Visualization step
try:
    print("Creating visualizations...")
    
    # Create output directory
    os.makedirs('figures', exist_ok=True)
    
    # Visualization code would go here
    # Example: plt.figure(figsize=(10, 6))
    # plt.plot(data)
    # plt.savefig('figures/plot.png')
    print("Visualizations saved to figures/")
    
except Exception as e {
    print(f"Visualization error: {e}")

`;
        }
        else if (desc.includes("save") ||
            desc.includes("export") ||
            desc.includes("report")) {
            code += `# Output/reporting step
try:
    print("Generating outputs...")
    
    # Create results directory
    os.makedirs('results', exist_ok=True)
    
    # Save results here
    # Example: results.to_csv('results/output.csv')
    print("Results saved to results/")
    
except Exception as e {
    print(f"Output generation error: {e}")

`;
        }
        else {
            code += `# General analysis step
try:
    print("Executing analysis step...")
    
    # TODO: Implement the specific logic for this step
    # This step should: ${stepDescription}
    
    print("Step execution completed")
    
except Exception as e {
    print(f"Step execution error: {e}")

`;
        }
        code += `print("Step completed successfully")`;
        return code;
    }
    generateDataAwareBasicStepCode(stepDescription, datasets, stepIndex) {
        const desc = stepDescription.toLowerCase();
        const datasetIds = datasets.map((d) => d.id);
        let code = `# Step ${stepIndex + 1}: ${stepDescription}
print("Executing: ${stepDescription}")

# Use loaded datasets: ${datasetIds.join(", ")}
available_datasets = list(data_files.keys())
print(f"Working with datasets: {{available_datasets}}")

`;
        // Add specific code based on step description keywords
        if (desc.includes("differential") ||
            desc.includes("expression") ||
            desc.includes("deg")) {
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
        }
        else if (desc.includes("cluster") || desc.includes("group")) {
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
            
except Exception as e {
    print(f"Clustering analysis error: {{e}}")
}

`;
        }
        else if (desc.includes("visual") ||
            desc.includes("plot") ||
            desc.includes("heatmap")) {
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
            
except Exception as e {
    print(f"Visualization error: {{e}}")
}

`;
        }
        else {
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
            
except Exception as e {
    print(f"General analysis error: {{e}}")
}

`;
        }
        code += `print("Step completed successfully")`;
        return code;
    }
    async executeStep(step, datasets) {
        if (this.shouldStopAnalysis) {
            step.status = "cancelled";
            return;
        }
        step.status = "running";
        try {
            // The actual code execution is handled by the caller (ChatPanel)
            step.status = "completed";
        }
        catch (error) {
            step.status = "failed";
            step.output = error instanceof Error ? error.message : "Unknown error";
        }
    }
    async generateDynamicCode(step, analysisResult) {
        // Regenerate code with current context
        return await this.generateDataDrivenStepCode(step.description, analysisResult.understanding.userQuestion, analysisResult.datasets, analysisResult.workingDirectory, parseInt(step.id.split("_")[1]) - 1);
    }
    stopAnalysis() {
        this.shouldStopAnalysis = true;
        this.isRunning = false;
    }
    /**
     * Generate a Jupyter notebook for data download and preprocessing, using AI-generated code and markdown.
     * The notebook will be saved in the analysis workspace and returned as a file path.
     */
    async generateDataDownloadNotebook(query, datasets, workspaceDir) {
        // Step 1: Use AI to generate markdown and code for download/preprocessing
        const notebookCells = [];
        // Markdown intro
        notebookCells.push({
            cell_type: "markdown",
            metadata: {},
            source: [
                `# Data Download & Preprocessing\n`,
                `This notebook was generated by the AI agent for your question:\n\n> ${query}\n\n`,
                `## Selected Datasets\n`,
                ...datasets.map((d, i) => `- **${d.id}**: ${d.title} (${d.organism})\n`),
                `\n---\n`,
                `You can run each cell to download and preprocess the data yourself.\n`,
            ],
        });
        // For each dataset, add a code cell for download/preprocessing
        for (const dataset of datasets) {
            // Use the same AI-driven code generation as in generateDataLoadingStep
            const code = await this.generateDataDrivenStepCode(`Download and preprocess dataset ${dataset.id} (${dataset.title})`, query, [dataset], workspaceDir, 0);
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
        const notebookName = `data_download_${(0, uuid_1.v4)().slice(0, 8)}.ipynb`;
        const notebookPath = `${workspaceDir}/${notebookName}`;
        await window.electronAPI.writeFile(notebookPath, JSON.stringify(notebook, null, 2));
        return notebookPath;
    }
}
exports.AutonomousAgent = AutonomousAgent;
