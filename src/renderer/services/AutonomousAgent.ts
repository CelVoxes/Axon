import { BackendClient } from "./BackendClient";
import { AnalysisPlanner, Dataset, AnalysisPlan } from "./AnalysisPlanner";
import { DatasetManager } from "./DatasetManager";
import {
	CodeGenerationService,
	CodeGenerationRequest,
} from "./CodeGenerationService";
import { CodeValidationService } from "./CodeValidationService";
import { CellExecutionService } from "./CellExecutionService";
import { v4 as uuidv4 } from "uuid";

interface AnalysisStep {
	id: string;
	description: string;
	code: string;
	status: "pending" | "running" | "completed" | "failed" | "cancelled";
	output?: string;
	files?: string[];
	dataTypes?: string[]; // What data types this step works with
	tools?: string[]; // What tools/libraries this step uses
	prerequisites?: string[]; // What steps must be completed first
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
	private analysisPlanner: AnalysisPlanner;
	private datasetManager: DatasetManager;
	private codeGenerationService: CodeGenerationService;
	private codeValidationService: CodeValidationService;
	private cellExecutionService: CellExecutionService;
	private workspacePath: string;
	private originalQuery: string = "";
	public isRunning: boolean = false;
	private shouldStopAnalysis: boolean = false;
	private statusCallback?: (status: string) => void;
	private validationErrorCallback?: (
		errors: string[],
		warnings: string[]
	) => void;
	private codeGenerationCallback?: (code: string, step: string) => void;
	private selectedModel: string = "gpt-4o-mini";

	constructor(
		backendClient: BackendClient,
		workspacePath: string,
		selectedModel?: string
	) {
		this.backendClient = backendClient;
		this.analysisPlanner = new AnalysisPlanner(backendClient);
		this.datasetManager = new DatasetManager();
		this.codeGenerationService = new CodeGenerationService(
			backendClient,
			selectedModel || "gpt-4o-mini"
		);
		this.codeValidationService = new CodeValidationService(backendClient);
		this.cellExecutionService = new CellExecutionService(workspacePath);
		this.workspacePath = workspacePath;
		if (selectedModel) {
			this.selectedModel = selectedModel;
		}
	}

	setModel(model: string) {
		this.selectedModel = model;
		this.codeGenerationService.setModel(model);
	}

	setStatusCallback(callback: (status: string) => void) {
		this.statusCallback = callback;
		this.analysisPlanner.setStatusCallback(callback);
		this.datasetManager.setStatusCallback(callback);
	}

	setValidationErrorCallback(
		callback: (errors: string[], warnings: string[]) => void
	) {
		this.validationErrorCallback = callback;
	}

	setCodeGenerationCallback(callback: (code: string, step: string) => void) {
		this.codeGenerationCallback = callback;
	}

	private updateStatus(message: string) {
		if (this.statusCallback) {
			this.statusCallback(message);
		}
	}

	/**
	 * Install required packages based on analysis requirements
	 */
	private async installRequiredPackages(
		datasets: Dataset[],
		workingDir: string
	): Promise<void> {
		try {
			this.updateStatus("Analyzing required packages...");

			// Use DatasetManager to determine required tools
			const dataAnalysis =
				await this.datasetManager.analyzeDataTypesAndSelectTools(
					datasets,
					workingDir
				);

			// Get the list of required packages
			const requiredPackages = dataAnalysis.recommendedTools;

			if (requiredPackages.length === 0) {
				this.updateStatus("No additional packages required.");
				return;
			}

			this.updateStatus(
				`Installing ${requiredPackages.length} required packages...`
			);

			// Install packages using the new IPC method
			const result = await window.electronAPI.installPackages(
				workingDir,
				requiredPackages
			);

			if (result.success) {
				this.updateStatus(
					`Successfully installed: ${requiredPackages.join(", ")}`
				);
			} else {
				console.warn("Failed to install packages:", result.error);
				this.updateStatus("Warning: Some packages may not be available");
			}
		} catch (error) {
			console.error("Error installing packages:", error);
			this.updateStatus(
				"Warning: Package installation failed, proceeding anyway"
			);
		}
	}

	async executeAnalysisRequest(query: string): Promise<AnalysisResult> {
		this.originalQuery = query;
		this.isRunning = true;
		this.shouldStopAnalysis = false;

		try {
			// Use AnalysisPlanner to create the analysis plan
			const analysisPlan = await this.analysisPlanner.createAnalysisPlan(query);

			// Generate steps using the plan
			this.updateStatus("Planning analysis approach...");
			const steps = await this.generateQuestionSpecificSteps(
				analysisPlan.understanding,
				analysisPlan.datasets,
				analysisPlan.workingDirectory
			);

			this.updateStatus("Ready to execute analysis!");

			return {
				understanding: analysisPlan.understanding,
				datasets: analysisPlan.datasets,
				steps,
				workingDirectory: analysisPlan.workingDirectory,
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
			// Use AnalysisPlanner to create the analysis plan with existing data
			const analysisPlan =
				await this.analysisPlanner.createAnalysisPlanWithData(
					query,
					downloadedDatasets
				);

			// Generate data-driven analysis steps
			this.updateStatus("Generating analysis steps...");
			const steps = await this.generateDataDrivenAnalysisSteps(
				analysisPlan.understanding,
				downloadedDatasets,
				analysisPlan.workingDirectory
			);

			this.updateStatus("Analysis steps generated successfully!");

			return {
				understanding: analysisPlan.understanding,
				datasets: downloadedDatasets,
				steps,
				workingDirectory: analysisPlan.workingDirectory,
			};
		} finally {
			this.isRunning = false;
		}
	}

	private async generateQuestionSpecificSteps(
		understanding: any,
		datasets: Dataset[],
		workingDir: string
	): Promise<AnalysisStep[]> {
		// Install required packages based on analysis requirements
		await this.installRequiredPackages(datasets, workingDir);

		const steps: AnalysisStep[] = [];

		this.updateStatus(
			`Generating code for ${
				understanding.requiredSteps?.length || 0
			} analysis steps...`
		);

		// Generate code for each step based on the user's actual question
		for (let i = 0; i < (understanding.requiredSteps?.length || 0); i++) {
			const stepDescription =
				understanding.requiredSteps?.[i] || `Step ${i + 1}`;

			this.updateStatus(
				`Generating code for step ${i + 1}/${
					understanding.requiredSteps?.length || 0
				}: ${stepDescription?.substring(0, 50) || ""}...`
			);

			try {
				const request: CodeGenerationRequest = {
					stepDescription,
					originalQuestion: understanding.userQuestion,
					datasets,
					workingDir,
					stepIndex: i,
				};

				const result =
					await this.codeGenerationService.generateDataDrivenStepCode(request);

				steps.push({
					id: `step_${i + 1}`,
					description: stepDescription,
					code: result.code,
					status: "pending",
				});

				this.updateStatus(
					`Generated code for step ${i + 1}/${
						understanding.requiredSteps?.length || 0
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
						understanding.requiredSteps?.length || 0
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
		// Install required packages based on analysis requirements
		await this.installRequiredPackages(datasets, workingDir);

		// Use intelligent step generation based on data types
		const steps = await this.generateIntelligentAnalysisSteps(
			understanding.userQuestion,
			datasets,
			workingDir
		);

		// Store the analysis plan for future step generation
		const analysisPlan = {
			understanding,
			datasets,
			workingDir,
			requiredSteps: understanding.requiredSteps,
			userQuestion: understanding.userQuestion,
			dataTypes: steps[0]?.dataTypes || [],
			recommendedTools: steps[0]?.tools || [],
		};

		// Save the analysis plan for the pipeline to use later
		await window.electronAPI.writeFile(
			`${workingDir}/analysis_plan.json`,
			JSON.stringify(analysisPlan, null, 2)
		);

		this.updateStatus(
			"Ready to execute intelligent analysis with data-driven tool selection!"
		);
		return steps;
	}

	private async generateDataLoadingStep(
		datasets: Dataset[],
		workingDir: string
	): Promise<AnalysisStep> {
		// Use AI to generate the data loading code instead of template
		const stepDescription = `Download and load datasets with size checking for datasets: ${datasets
			.map((d) => d.id)
			.join(", ")}`;

		const request: CodeGenerationRequest = {
			stepDescription,
			originalQuestion: "Data loading and preprocessing",
			datasets,
			workingDir,
			stepIndex: 0,
		};

		const result = await this.codeGenerationService.generateDataDrivenStepCode(
			request
		);

		return {
			id: "data-loading",
			description: "Download and load datasets with size checking",
			code: result.code,
			status: "pending",
		};
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

			const request: CodeGenerationRequest = {
				stepDescription,
				originalQuestion,
				datasets,
				workingDir,
				stepIndex,
			};

			const result = await this.codeGenerationService.generateSingleStepCode(
				request
			);
			return result.code;
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

	async executeStep(
		step: AnalysisStep,
		datasets: Dataset[]
	): Promise<{
		status: "completed" | "failed" | "cancelled";
		output: string;
		shouldRetry: boolean;
		analysis?: any;
	}> {
		if (this.shouldStopAnalysis) {
			step.status = "cancelled";
			return {
				status: "cancelled",
				output: "Analysis was cancelled",
				shouldRetry: false,
			};
		}

		step.status = "running";

		try {
			// Use CellExecutionService to execute the step
			const result = await this.cellExecutionService.executeCell(
				step.id,
				step.code,
				(updates) => {
					// Update step with progress
					Object.assign(step, updates);
				}
			);

			step.status = result.status;
			step.output = result.output;

			return result;
		} catch (error) {
			step.status = "failed";
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			step.output = errorMessage;

			return {
				status: "failed",
				output: errorMessage,
				shouldRetry: false,
			};
		}
	}

	async generateDynamicCode(
		step: AnalysisStep,
		analysisResult: AnalysisResult
	): Promise<string> {
		// Use DatasetManager to analyze current data state and select appropriate tools
		const dataAnalysis =
			await this.datasetManager.analyzeDataTypesAndSelectTools(
				analysisResult.datasets,
				analysisResult.workingDirectory
			);

		// Update step with data type information
		step.dataTypes = dataAnalysis.dataTypes;
		step.tools = dataAnalysis.recommendedTools;

		// Regenerate code with current context and data-driven tool selection
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
	 * Create an analysis workspace for the given query
	 * This method delegates to AnalysisPlanner service
	 */
	async createAnalysisWorkspace(query: string): Promise<string> {
		return await this.analysisPlanner.createAnalysisWorkspace(
			query,
			this.workspacePath
		);
	}

	/**
	 * Generate intelligent analysis steps based on data types and user question
	 */
	private async generateIntelligentAnalysisSteps(
		userQuestion: string,
		datasets: Dataset[],
		workingDir: string
	): Promise<AnalysisStep[]> {
		this.updateStatus(
			"Generating intelligent analysis steps based on data types..."
		);

		try {
			// Use DatasetManager to analyze data types and get tool recommendations
			const dataAnalysis =
				await this.datasetManager.analyzeDataTypesAndSelectTools(
					datasets,
					workingDir
				);

			// Generate analysis plan based on data types and user question
			const analysisPlan =
				await this.datasetManager.generateDataTypeSpecificPlan(
					userQuestion,
					dataAnalysis,
					datasets
				);

			// Convert plan to analysis steps
			const steps: AnalysisStep[] = [];

			for (let i = 0; i < analysisPlan.steps.length; i++) {
				const planStep = analysisPlan.steps[i];

				// Generate code for this step using CodeGenerationService
				const request: CodeGenerationRequest = {
					stepDescription: planStep.description,
					originalQuestion: userQuestion,
					datasets,
					workingDir,
					stepIndex: i,
				};

				const result =
					await this.codeGenerationService.generateDataDrivenStepCode(request);

				steps.push({
					id: `step_${i + 1}`,
					description: planStep.description,
					code: result.code,
					status: "pending",
					dataTypes: dataAnalysis.dataTypes,
					tools: dataAnalysis.recommendedTools,
					prerequisites: planStep.prerequisites || [],
				});
			}

			return steps;
		} catch (error) {
			console.error("Error generating intelligent analysis steps:", error);
			// Fallback to basic steps
			return [await this.generateDataLoadingStep(datasets, workingDir)];
		}
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
		this.updateStatus("Generating data download notebook...");

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
		for (let i = 0; i < datasets.length; i++) {
			const dataset = datasets[i];
			this.updateStatus(
				`Generating download code for dataset ${i + 1}/${datasets.length}: ${
					dataset.id
				}`
			);

			// Use the same AI-driven code generation as in generateDataLoadingStep
			const code = await this.generateDataDrivenStepCode(
				`Download and preprocess dataset ${dataset.id} (${dataset.title})`,
				query,
				[dataset],
				workspaceDir,
				i
			);
			notebookCells.push({
				cell_type: "code",
				metadata: {},
				execution_count: null,
				outputs: [],
				source: [code],
			});
		}

		this.updateStatus("Saving notebook file...");

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

		this.updateStatus("Data download notebook created successfully!");
		return notebookPath;
	}

	/**
	 * Generate a unified Jupyter notebook that creates and executes cells dynamically.
	 */
	async generateUnifiedNotebook(
		query: string,
		datasets: Dataset[],
		analysisSteps: AnalysisStep[],
		workspaceDir: string
	): Promise<string> {
		this.updateStatus("Generating unified analysis notebook...");

		// Create initial notebook with just the intro
		const notebookCells: any[] = [];

		// Markdown intro
		notebookCells.push({
			cell_type: "markdown",
			metadata: {},
			source: [
				`# Complete Analysis: ${query}\n`,
				`This notebook will be built in real-time as cells are added and executed.\n\n`,
				`## Selected Datasets\n`,
				...datasets.map(
					(d, i) => `- **${d.id}**: ${d.title} (${d.organism})\n`
				),
				`\n## Analysis Steps\n`,
				...analysisSteps.map((step, i) => `${i + 1}. ${step.description}\n`),
				`\n---\n`,
				`Watch as cells are added and executed in real-time!\n`,
			],
		});

		// Create initial notebook structure
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

		// Save initial notebook file
		const notebookName = `analysis_${uuidv4().slice(0, 8)}.ipynb`;
		const notebookPath = `${workspaceDir}/${notebookName}`;
		await window.electronAPI.writeFile(
			notebookPath,
			JSON.stringify(notebook, null, 2)
		);

		// Open the notebook in the file editor
		this.updateStatus("Opening notebook for real-time updates...");
		await this.openNotebookInEditor(notebookPath);

		// Add cells and execute them in real-time
		await this.addAndExecuteCellsRealTime(
			notebookPath,
			query,
			datasets,
			analysisSteps,
			workspaceDir
		);

		this.updateStatus("Unified analysis notebook created successfully!");
		return notebookPath;
	}

	/**
	 * Open the notebook file in the editor
	 */
	private async openNotebookInEditor(notebookPath: string): Promise<void> {
		// Dispatch an event to open the notebook file in the workspace
		const openEvent = new CustomEvent("open-workspace-file", {
			detail: { filePath: notebookPath },
		});
		window.dispatchEvent(openEvent);

		// Wait a moment for the file to open
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	/**
	 * Add cells and execute them in real-time
	 */
	private async addAndExecuteCellsRealTime(
		notebookPath: string,
		query: string,
		datasets: Dataset[],
		analysisSteps: AnalysisStep[],
		workspaceDir: string
	): Promise<void> {
		// Step 1: Add package installation cells
		this.updateStatus("Adding package installation cells...");
		await this.addMarkdownCell(
			notebookPath,
			"## Step 1: Install Required Packages"
		);

		const packageInstallCode = await this.generatePackageInstallationCode(
			datasets,
			analysisSteps
		);
		await this.addCodeCell(notebookPath, packageInstallCode);

		// Execute package installation
		this.updateStatus("Installing required packages...");
		const packageResult = await window.electronAPI.executeJupyterCode(
			packageInstallCode,
			workspaceDir
		);
		await this.updateCellOutput(
			notebookPath,
			2,
			packageResult.output || "Packages installed successfully!"
		);

		// Step 2: Add data download cells
		this.updateStatus("Adding data download cells...");
		await this.addMarkdownCell(
			notebookPath,
			"## Step 2: Download and Preprocess Data"
		);

		for (let i = 0; i < datasets.length; i++) {
			const dataset = datasets[i];
			this.updateStatus(
				`Adding download cell for dataset ${i + 1}/${datasets.length}: ${
					dataset.id
				}`
			);

			await this.addMarkdownCell(
				notebookPath,
				`### Dataset ${i + 1}: ${dataset.id}`
			);

			const code = await this.generateDataDrivenStepCode(
				`Download and preprocess dataset ${dataset.id} (${dataset.title})`,
				query,
				[dataset],
				workspaceDir,
				i
			);
			await this.addCodeCell(notebookPath, code);

			// Execute the download cell
			this.updateStatus(`Downloading dataset ${dataset.id}...`);
			const downloadResult = await window.electronAPI.executeJupyterCode(
				code,
				workspaceDir
			);
			const cellIndex = 4 + i * 2; // Calculate cell index
			await this.updateCellOutput(
				notebookPath,
				cellIndex + 1,
				downloadResult.output || `Dataset ${dataset.id} processed successfully!`
			);
		}

		// Step 3: Add analysis cells
		this.updateStatus("Adding analysis cells...");
		await this.addMarkdownCell(notebookPath, "## Step 3: Analysis");

		for (let i = 0; i < analysisSteps.length; i++) {
			const step = analysisSteps[i];
			this.updateStatus(
				`Adding analysis cell for step ${i + 1}/${analysisSteps.length}: ${
					step.description
				}`
			);

			await this.addMarkdownCell(
				notebookPath,
				`### Analysis Step ${i + 1}: ${step.description}`
			);
			await this.addCodeCell(notebookPath, step.code);

			// Execute the analysis cell
			this.updateStatus(`Executing analysis step ${i + 1}...`);
			const analysisResult = await window.electronAPI.executeJupyterCode(
				step.code,
				workspaceDir
			);
			const cellIndex = 4 + datasets.length * 2 + i * 2; // Calculate cell index
			await this.updateCellOutput(
				notebookPath,
				cellIndex + 1,
				analysisResult.output ||
					`Analysis step ${i + 1} completed successfully!`
			);
		}

		this.updateStatus("All cells added and executed successfully!");
	}

	/**
	 * Add a markdown cell to the notebook
	 */
	private async addMarkdownCell(
		notebookPath: string,
		content: string
	): Promise<void> {
		const addCellEvent = new CustomEvent("add-notebook-cell", {
			detail: {
				filePath: notebookPath,
				cellType: "markdown",
				content: content,
			},
		});
		window.dispatchEvent(addCellEvent);
		await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for cell to be added
	}

	/**
	 * Add a code cell to the notebook
	 */
	private async addCodeCell(notebookPath: string, code: string): Promise<void> {
		const addCellEvent = new CustomEvent("add-notebook-cell", {
			detail: {
				filePath: notebookPath,
				cellType: "code",
				content: code,
			},
		});
		window.dispatchEvent(addCellEvent);
		await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for cell to be added
	}

	/**
	 * Update cell output in the notebook
	 */
	private async updateCellOutput(
		notebookPath: string,
		cellIndex: number,
		output: string
	): Promise<void> {
		const updateCellEvent = new CustomEvent("update-notebook-cell", {
			detail: {
				filePath: notebookPath,
				cellIndex: cellIndex,
				output: output,
			},
		});
		window.dispatchEvent(updateCellEvent);
		await new Promise((resolve) => setTimeout(resolve, 300)); // Wait for update
	}

	/**
	 * Generate package installation code based on datasets and analysis steps
	 */
	private async generatePackageInstallationCode(
		datasets: Dataset[],
		analysisSteps: AnalysisStep[]
	): Promise<string> {
		// Get required packages from dataset analysis
		const dataAnalysis =
			await this.datasetManager.analyzeDataTypesAndSelectTools(datasets, "");

		// Collect all required packages
		const requiredPackages = new Set<string>();

		// Add packages from data analysis
		dataAnalysis.recommendedTools.forEach((pkg) => requiredPackages.add(pkg));

		// Add common packages
		requiredPackages.add("pandas");
		requiredPackages.add("numpy");
		requiredPackages.add("matplotlib");
		requiredPackages.add("seaborn");

		const packages = Array.from(requiredPackages);

		return `# Install required packages
import subprocess
import sys

required_packages = ${JSON.stringify(packages)}

print("Installing required packages...")
for package in required_packages:
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", package])
        print(f"✓ Installed {package}")
    except subprocess.CalledProcessError:
        print(f"⚠ Failed to install {package}")

print("\\nAll packages installed!")`;
	}

	// Helper methods that delegate to services
	private async generateDataDrivenStepCode(
		stepDescription: string,
		originalQuestion: string,
		datasets: Dataset[],
		workingDir: string,
		stepIndex: number
	): Promise<string> {
		const request: CodeGenerationRequest = {
			stepDescription,
			originalQuestion,
			datasets,
			workingDir,
			stepIndex,
		};

		const result = await this.codeGenerationService.generateDataDrivenStepCode(
			request
		);
		return result.code;
	}

	private generateBasicStepCode(
		stepDescription: string,
		stepIndex: number
	): string {
		// Delegate to CodeGenerationService for fallback code
		return this.codeGenerationService.generateBasicStepCodePublic(
			stepDescription,
			stepIndex
		);
	}

	private generateDataAwareBasicStepCode(
		stepDescription: string,
		datasets: Dataset[],
		stepIndex: number
	): string {
		// Delegate to CodeGenerationService for data-aware fallback code
		return this.codeGenerationService.generateDataAwareBasicStepCodePublic(
			stepDescription,
			datasets,
			stepIndex
		);
	}
}
