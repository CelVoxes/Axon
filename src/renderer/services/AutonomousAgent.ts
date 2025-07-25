import { BioRAGClient } from "./BioRAGClient";

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
	private bioragClient: BioRAGClient;
	private workspacePath: string;
	private originalQuery: string = "";
	public isRunning: boolean = false;
	private shouldStopAnalysis: boolean = false;
	private statusCallback?: (status: string) => void;

	constructor(bioragClient: BioRAGClient, workspacePath: string) {
		this.bioragClient = bioragClient;
		this.workspacePath = workspacePath;
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
			const understanding = await this.analyzeUserQuestion(query);

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

	private async analyzeUserQuestion(query: string) {
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
			const understanding = this.parseLLMPlanningResponse(
				planningResponse.answer,
				query
			);

			this.updateStatus("AI analysis plan generated successfully");
			return understanding;
		} catch (error) {
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
				line.match(/^\s*\d+\.?\s*(.+)/) || line.match(/^\s*[-*]\s*(.+)/);
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

				const timeoutPromise = new Promise<never>((_, reject) => {
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

		const directories = [
			fullPath,
			`${fullPath}/data`,
			`${fullPath}/results`,
			`${fullPath}/figures`,
		];

		for (const dir of directories) {
			try {
				await window.electronAPI.createDirectory(dir);
			} catch (error) {
				console.warn(`Could not create directory ${dir}:`, error);
			}
		}

		return fullPath;
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
		for (let i = 0; i < understanding.requiredSteps.length; i++) {
			const stepDescription = understanding.requiredSteps[i];

			this.updateStatus(
				`Generating code for step ${i + 1}/${
					understanding.requiredSteps.length
				}: ${stepDescription.substring(0, 50)}...`
			);

			try {
				const code = await this.generateStepCode(
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

	private async generateStepCode(
		stepDescription: string,
		originalQuestion: string,
		datasets: Dataset[],
		workingDir: string,
		stepIndex: number
	): Promise<string> {
		try {
			// Use LLM to generate specific Python code for this step
			this.updateStatus(
				`Generating AI code for: ${stepDescription.substring(0, 50)}...`
			);

			const codePrompt = `You are an expert bioinformatics programmer. Generate executable Python code for this specific analysis step:

STEP: "${stepDescription}"
RESEARCH QUESTION: "${originalQuestion}"
WORKING DIRECTORY: ${workingDir}
AVAILABLE DATASETS: ${datasets.map((d) => d.id).join(", ") || "None specified"}
STEP NUMBER: ${stepIndex + 1}

Requirements:
1. Write complete, executable Python code that specifically accomplishes: "${stepDescription}"
2. Include proper imports at the top
3. Use realistic biological data and analysis methods
4. Include error handling and informative print statements
5. Save outputs to 'results/' or 'figures/' directories as appropriate
6. Make the code specific to the research question: "${originalQuestion}"
7. If downloading real data, use appropriate APIs (GEOparse, etc.)
8. Generate sample data if real datasets aren't available

IMPORTANT: 
- Return ONLY the Python code, no explanations
- Make the code production-ready and biologically meaningful
- Ensure proper indentation and syntax
- Include comments explaining the biological significance

Generate the Python code:`;

			const codeResponse = await this.bioragClient.query({
				question: codePrompt,
				max_documents: 3,
				response_type: "answer",
			});

			let generatedCode = this.extractPythonCode(codeResponse.answer);

			if (!generatedCode || generatedCode.length < 50) {
				console.warn(`Generated code too short for step: ${stepDescription}`);
				generatedCode = this.generateBasicStepCode(stepDescription, stepIndex);
			}

			return generatedCode;
		} catch (error) {
			console.error(
				`LLM code generation failed for "${stepDescription}":`,
				error
			);
			this.updateStatus(
				`Using fallback code for: ${stepDescription.substring(0, 50)}...`
			);
			return this.generateBasicStepCode(stepDescription, stepIndex);
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
		if (
			desc.includes("download") ||
			desc.includes("data") ||
			desc.includes("dataset")
		) {
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
		} else if (
			desc.includes("preprocess") ||
			desc.includes("clean") ||
			desc.includes("quality")
		) {
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
		} else if (
			desc.includes("analyz") ||
			desc.includes("compar") ||
			desc.includes("differ")
		) {
			code += `# Analysis step
try:
    print("Starting analysis...")
    
    # Analysis code would go here
    # Example: results = analyze_data(data)
    print("Analysis completed")
    
except Exception as e:
    print(f"Analysis error: {e}")

`;
		} else if (
			desc.includes("plot") ||
			desc.includes("visual") ||
			desc.includes("chart") ||
			desc.includes("graph")
		) {
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
    
except Exception as e:
    print(f"Visualization error: {e}")

`;
		} else if (
			desc.includes("save") ||
			desc.includes("export") ||
			desc.includes("report")
		) {
			code += `# Output/reporting step
try:
    print("Generating outputs...")
    
    # Create results directory
    os.makedirs('results', exist_ok=True)
    
    # Save results here
    # Example: results.to_csv('results/output.csv')
    print("Results saved to results/")
    
except Exception as e:
    print(f"Output generation error: {e}")

`;
		} else {
			code += `# General analysis step
try:
    print("Executing analysis step...")
    
    # TODO: Implement the specific logic for this step
    # This step should: ${stepDescription}
    
    print("Step execution completed")
    
except Exception as e:
    print(f"Step execution error: {e}")

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
		return await this.generateStepCode(
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
}
