import { BackendClient } from "./BackendClient";
import { AnalysisPlanner, Dataset, AnalysisPlan } from "./AnalysisPlanner";
import { DatasetManager } from "./DatasetManager";
import {
	CodeGenerationService,
	CodeGenerationRequest,
} from "./CodeGenerationService";
import { CodeValidationService } from "./CodeValidationService";
import { CellExecutionService } from "./CellExecutionService";
import { StatusManager } from "./StatusManager";
import { NotebookService } from "./NotebookService";
import { AnalysisSuggestionsService, DataTypeSuggestions } from "./AnalysisSuggestionsService";
import { AsyncUtils } from "../utils/AsyncUtils";
import { EventManager } from "../utils/EventManager";

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

export interface WorkflowStep {
	id: string;
	name: string;
	status: "pending" | "running" | "completed" | "failed";
	description: string;
	progress: number;
	result?: any;
	error?: string;
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
	private statusManager: StatusManager;
	private notebookService: NotebookService;
	private suggestionsService: AnalysisSuggestionsService;
	private workspacePath: string;
	private originalQuery: string = "";
	public isRunning: boolean = false;
	private shouldStopAnalysis: boolean = false;
	private validationErrorCallback?: (
		errors: string[],
		warnings: string[]
	) => void;
	private codeGenerationCallback?: (code: string, step: string) => void;
	private llmFixCallback?: (
		originalCode: string,
		fixedCode: string,
		problem: string
	) => void;
	private selectedModel: string = "gpt-4o-mini";
	private installedPackages: Set<string> = new Set();

	constructor(
		backendClient: BackendClient,
		workspacePath: string,
		selectedModel?: string,
		kernelName?: string
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
		this.statusManager = StatusManager.getInstance();
		this.suggestionsService = new AnalysisSuggestionsService(backendClient);
		this.notebookService = new NotebookService({
			workspacePath,
			codeGenerationService: this.codeGenerationService,
			kernelName: kernelName,
		});
		this.workspacePath = workspacePath;
		if (selectedModel) {
			this.selectedModel = selectedModel;
		}
	}

	private async updateKernelNameFromWorkspace(): Promise<void> {
		try {
			const workspaceMetadata = await AnalysisPlanner.getWorkspaceMetadata(this.workspacePath);
			if (workspaceMetadata?.kernelName) {
				console.log(`Retrieved kernel name from workspace: ${workspaceMetadata.kernelName}`);
				// Update the NotebookService with the correct kernel name
				this.notebookService = new NotebookService({
					workspacePath: this.workspacePath,
					codeGenerationService: this.codeGenerationService,
					kernelName: workspaceMetadata.kernelName,
				});
			} else {
				console.warn("No kernel name found in workspace metadata");
			}
		} catch (error) {
			console.warn("Failed to get kernel name from workspace:", error);
		}
	}

	setModel(model: string) {
		this.selectedModel = model;
		this.codeGenerationService.setModel(model);
		// Update NotebookService with the new code generation service
		this.notebookService.setCodeGenerationService(this.codeGenerationService);
	}

	setStatusCallback(callback: (status: string) => void) {
		// Convert string callback to StatusUpdate callback
		this.statusManager.setStatusCallback((statusUpdate) => {
			callback(statusUpdate.message);
		});
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
		// Also pass the callback to the CodeGenerationService so NotebookService can use it
		this.codeGenerationService.setCodeGenerationCallback(callback);
	}

	setStreamingCodeCallback(callback: (chunk: string, step: string) => void) {
		console.log("AutonomousAgent: Setting streaming callback");
		// Pass the streaming callback to the CodeGenerationService
		this.codeGenerationService.setStreamingCodeCallback(callback);
	}

	setLLMFixCallback(
		callback: (originalCode: string, fixedCode: string, problem: string) => void
	) {
		this.llmFixCallback = callback;
	}

	private updateStatus(message: string) {
		this.statusManager.updateStatus(message);
	}

	/**
	 * Ensure virtual environment and kernel are ready for code execution
	 */
	private async ensureEnvironmentReady(workspaceDir: string): Promise<void> {
		try {
			this.updateStatus("🔍 Checking virtual environment...");
			
			// Check if virtual environment exists
			const venvPath = `${workspaceDir}/venv`;
			const venvExists = await window.electronAPI.directoryExists(venvPath);
			
			if (!venvExists) {
				throw new Error("Virtual environment not found");
			}
			
			this.updateStatus("🔍 Verifying installed packages...");
			
			// Verify core packages are installed by attempting imports
			const testCode = `
import sys
print(f"Python path: {sys.path}")
try:
    import pandas
    print("✅ pandas available")
except ImportError:
    print("❌ pandas not available")

try:
    import numpy
    print("✅ numpy available") 
except ImportError:
    print("❌ numpy not available")

try:
    import matplotlib
    print("✅ matplotlib available")
except ImportError:
    print("❌ matplotlib not available")
    
try:
    import seaborn
    print("✅ seaborn available")
except ImportError:
    print("❌ seaborn not available")
`;

			const testResult = await window.electronAPI.executeJupyterCode(testCode, workspaceDir);
			
			if (testResult.success) {
				console.log("📦 Package verification result:", testResult.output);
				this.updateStatus("✅ All core packages verified");
			} else {
				console.warn("⚠️ Package verification failed:", testResult.error);
				this.updateStatus("⚠️ Package verification failed, but continuing...");
			}
			
		} catch (error) {
			console.error("❌ Environment verification failed:", error);
			this.updateStatus("⚠️ Environment verification failed, but continuing...");
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
			// Validate working directory exists
			const workingDirExists = await window.electronAPI.directoryExists(workingDir);
			if (!workingDirExists) {
				throw new Error(`Working directory does not exist: ${workingDir}`);
			}

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
			console.log("🔧 Starting package installation...", requiredPackages);
			const result = await window.electronAPI.installPackages(
				workingDir,
				requiredPackages
			);
			console.log("✅ Package installation completed:", result);
			
			// Store the successfully installed packages for code generation
			if (result.success) {
				this.installedPackages = new Set(requiredPackages);
				console.log("📦 Installed packages stored:", Array.from(this.installedPackages));
			}

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

		console.log("AutonomousAgent: workspacePath =", this.workspacePath);

		try {
			// Use AnalysisPlanner to create the analysis plan with existing data
			const analysisPlan =
				await this.analysisPlanner.createAnalysisPlanWithData(
					query,
					downloadedDatasets,
					this.workspacePath
				);

			// Update the workspace path to use the analysis-specific directory
			this.workspacePath = analysisPlan.workingDirectory;
			this.cellExecutionService.updateWorkspacePath(this.workspacePath);
			this.notebookService.updateWorkspacePath(this.workspacePath);
			
			// Get kernel name from the actual workspace metadata
			await this.updateKernelNameFromWorkspace();

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

		console.log("Understanding required steps:", understanding.requiredSteps);
		console.log("Understanding user question:", understanding.userQuestion);

		this.updateStatus(
			`Generating code for ${
				understanding.requiredSteps?.length || 0
			} analysis steps...`
		);

		// Generate code for each step based on the user's actual question
		for (let i = 0; i < (understanding.requiredSteps?.length || 0); i++) {
			const stepDescription =
				understanding.requiredSteps?.[i] || `Step ${i + 1}`;

			console.log(`Generating step ${i + 1}: "${stepDescription}"`);

			this.updateStatus(
				`Generating code for step ${i + 1}/${
					understanding.requiredSteps?.length || 0
				}: ${stepDescription?.substring(0, 50) || ""}...`
			);

			// Just create the step description - NO CODE GENERATION YET
			steps.push({
				id: `step_${i + 1}`,
				description: stepDescription,
				code: "", // Empty - code will be generated later
				status: "pending",
			});

			this.updateStatus(
				`Created step ${i + 1}/${
					understanding.requiredSteps?.length || 0
				}: ${stepDescription}`
			);
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
		const stepDescription = `Download and load datasets with size checking for datasets: ${datasets
			.map((d) => d.id)
			.join(", ")}`;

		// Just create the step description - NO CODE GENERATION YET
		return {
			id: "data-loading",
			description: "Download and load datasets with size checking",
			code: "", // Empty - code will be generated later
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

			// Trigger the code generation callback if available
			if (this.codeGenerationCallback) {
				this.codeGenerationCallback(result.code, stepDescription);
			}

			return result.code;
		} catch (error) {
			console.error(
				`LLM code generation failed for "${stepDescription}":`,
				error
			);
			this.updateStatus(
				`Using fallback code for: ${stepDescription.substring(0, 50)}...`
			);
			return this.codeGenerationService.generateDataAwareBasicStepCodePublic(
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
		const request: CodeGenerationRequest = {
			stepDescription: step.description,
			originalQuestion: analysisResult.understanding.userQuestion,
			datasets: analysisResult.datasets,
			workingDir: analysisResult.workingDirectory,
			stepIndex: parseInt(step.id.split("_")[1]) - 1,
		};

		const result = await this.codeGenerationService.generateDataDrivenStepCode(
			request
		);

		// Trigger the code generation callback if available
		if (this.codeGenerationCallback) {
			this.codeGenerationCallback(result.code, step.description);
		}

		return result.code;
	}

	stopAnalysis(): void {
		this.shouldStopAnalysis = true;
		this.isRunning = false;
	}

	/**
	 * Create an analysis workspace using AnalysisPlanner
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

				// Just create the step description - NO CODE GENERATION YET
				steps.push({
					id: `step_${i + 1}`,
					description: planStep.description,
					code: "", // Empty - code will be generated later
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
	 * Generate a data download notebook using NotebookService
	 */
	async generateDataDownloadNotebook(
		query: string,
		datasets: Dataset[],
		workspaceDir: string
	): Promise<string> {
		return await this.notebookService.generateDataDownloadNotebook(
			query,
			datasets,
			workspaceDir
		);
	}

	/**
	 * Generate a unified analysis notebook using NotebookService
	 * This method creates the notebook structure WITHOUT starting code generation
	 */
	async generateUnifiedNotebook(
		query: string,
		datasets: Dataset[],
		analysisSteps: AnalysisStep[],
		workspaceDir: string
	): Promise<string> {
		// Create notebook file first
		const notebookPath = await this.notebookService.createEmptyNotebook(
			query,
			datasets,
			workspaceDir
		);
		
		// Open notebook in editor
		await this.openNotebookInEditor(notebookPath);
		
		// Return path without starting code generation
		return notebookPath;
	}

	/**
	 * Start code generation for an existing notebook
	 */
	async startNotebookCodeGeneration(
		notebookPath: string,
		query: string,
		datasets: Dataset[],
		analysisSteps: AnalysisStep[],
		workspaceDir: string
	): Promise<void> {
		console.log("🚀 STARTING CODE GENERATION - packages should be installed by now");
		
		// Wait for notebook to be ready
		await this.waitForNotebookReady(notebookPath);
		
		// Now start adding cells with code generation
		await this.addAndExecuteCellsRealTime(
			notebookPath,
			query,
			datasets,
			analysisSteps,
			workspaceDir
		);
	}

	/**
	 * Open the notebook file in the editor
	 */
	public async openNotebookInEditor(notebookPath: string): Promise<void> {
		// Wait for the file to exist before trying to open it
		let attempts = 0;
		const maxAttempts = 10;

		while (attempts < maxAttempts) {
			try {
				// Check if file exists by trying to read it
				await window.electronAPI.readFile(notebookPath);
				break; // File exists, proceed to open
			} catch (error) {
				attempts++;
				if (attempts >= maxAttempts) {
					console.error(
						`Notebook file not found after ${maxAttempts} attempts: ${notebookPath}`
					);
					throw new Error(`Notebook file not found: ${notebookPath}`);
				}
				// Wait 500ms before next attempt
				await AsyncUtils.sleep(500);
			}
		}

		// Dispatch an event to open the notebook file in the workspace
		EventManager.dispatchEvent("open-workspace-file", { filePath: notebookPath });

		// Wait for the notebook to be ready using a promise-based approach
		await this.waitForNotebookReady(notebookPath);
	}

	/**
	 * Wait for the notebook to be ready to receive events
	 */
	private async waitForNotebookReady(notebookPath: string): Promise<void> {
		return new Promise((resolve) => {
			const timeout = setTimeout(() => {
				console.warn(`Timeout waiting for notebook ready: ${notebookPath}`);
				resolve(); // Resolve anyway to prevent hanging
			}, 5000); // 5 second timeout

			const handleNotebookReady = (event: CustomEvent) => {
				const { filePath } = event.detail;
				if (filePath === notebookPath) {
					console.log(`Notebook ready event received for: ${notebookPath}`);
					clearTimeout(timeout);
					window.removeEventListener(
						"notebook-ready",
						handleNotebookReady as EventListener
					);
					resolve();
				}
			};

			window.addEventListener(
				"notebook-ready",
				handleNotebookReady as EventListener
			);
		});
	}

	/**
	 * Add cells and execute them in real-time
	 */
	public async addAndExecuteCellsRealTime(
		notebookPath: string,
		query: string,
		datasets: Dataset[],
		analysisSteps: AnalysisStep[],
		workspaceDir: string
	): Promise<void> {
		// Helper function to generate and add code WITHOUT executing it
		const generateAndAddCode = async (
			stepDescription: string,
			stepTitle: string,
			markdownContent: string,
			previousCode?: string
		): Promise<string> => {
			// Add markdown cell
			await this.notebookService.addMarkdownCell(notebookPath, markdownContent);

			// Generate code with context
			const request: CodeGenerationRequest = {
				stepDescription,
				originalQuestion: query,
				datasets,
				workingDir: workspaceDir,
				stepIndex: 0, // stepIndex not critical for context
				previousCode,
			};

			const result =
				await this.codeGenerationService.generateDataDrivenStepCode(request);
			let code = result.code;

			// Validate and lint the generated code
			const validationResult = await this.codeValidationService.validateAndLintCode(code);
			if (!validationResult.isValid) {
				console.warn(`Code validation failed for ${stepTitle}:`, validationResult.errors);
				// Call validation error callback if available
				if (this.validationErrorCallback) {
					this.validationErrorCallback(validationResult.errors, validationResult.warnings);
				}
			}
			
			// Use the linted code (cleaned up version)
			code = validationResult.lintedCode;

			// Show code generation in chat
			if (this.codeGenerationCallback) {
				this.codeGenerationCallback(code, stepTitle);
			}

			// Execute the code to test it before adding to notebook
			try {
				const executionResult = await this.cellExecutionService.executeCell(
					`test-${stepTitle}`,
					code
				);
				if (executionResult.status === "failed") {
					console.warn(`Code execution failed for ${stepTitle}:`, executionResult.output);
					this.updateStatus(`⚠️ Code execution failed for ${stepTitle}, but adding to notebook anyway`);
				}
			} catch (error) {
				console.warn(`Error testing code for ${stepTitle}:`, error);
			}

			// Add code cell to notebook
			await this.notebookService.addCodeCell(notebookPath, code);

			this.updateStatus(`Added: ${stepTitle} (ready for manual execution)`);

			return code;
		};

		// Step 1: Verify environment and packages are ready
		this.updateStatus("Verifying environment and packages are ready...");
		
		// Wait for virtual environment and kernel to be fully ready
		await this.ensureEnvironmentReady(workspaceDir);
		
		this.updateStatus("✅ Environment verified, proceeding with notebook generation...");

		// Step 1.2: Add package installation cell as backup/documentation
		this.updateStatus("Adding package installation cell...");
		let packageInstallCode = await this.generatePackageInstallationCode(
			datasets,
			analysisSteps
		);

		// Validate and lint the package installation code
		const packageValidationResult = await this.codeValidationService.validateAndLintCode(packageInstallCode);
		if (!packageValidationResult.isValid) {
			console.warn("Package installation code validation failed:", packageValidationResult.errors);
			if (this.validationErrorCallback) {
				this.validationErrorCallback(packageValidationResult.errors, packageValidationResult.warnings);
			}
		}
		packageInstallCode = packageValidationResult.lintedCode;

		// Show code generation in chat
		if (this.codeGenerationCallback) {
			this.codeGenerationCallback(
				packageInstallCode,
				"Step 1: Package Installation"
			);
		}

		// Add package installation cell
		await this.notebookService.addCodeCell(notebookPath, packageInstallCode);
		this.updateStatus(
			"Package installation cell added (packages already installed)"
		);

		// Step 2: Data loading - Generate code NOW
		this.updateStatus("Adding data loading cell...");
		const dataLoadingStep = await this.generateDataLoadingStep(
			datasets,
			workspaceDir
		);

		// Add markdown cell for data loading
		await this.notebookService.addMarkdownCell(
			notebookPath,
			`## Step 2: Download and Load Datasets\n\nThis cell will download and load the selected datasets for analysis.`
		);

		// Generate data loading code NOW
		const request: CodeGenerationRequest = {
			stepDescription: dataLoadingStep.description,
			originalQuestion: query,
			datasets,
			workingDir: workspaceDir,
			stepIndex: 0,
		};

		const dataLoadingResult = await this.codeGenerationService.generateDataDrivenStepCode(request);
		let dataLoadingCode = dataLoadingResult.code;
		
		// Validate and lint the data loading code
		const dataValidationResult = await this.codeValidationService.validateAndLintCode(dataLoadingCode);
		if (!dataValidationResult.isValid) {
			console.warn("Data loading code validation failed:", dataValidationResult.errors);
			if (this.validationErrorCallback) {
				this.validationErrorCallback(dataValidationResult.errors, dataValidationResult.warnings);
			}
		}
		dataLoadingCode = dataValidationResult.lintedCode;
		
		// Test execute the data loading code
		try {
			const executionResult = await this.cellExecutionService.executeCell(
				"test-data-loading",
				dataLoadingCode
			);
			if (executionResult.status === "failed") {
				console.warn("Data loading code execution failed:", executionResult.output);
				this.updateStatus("⚠️ Data loading code execution failed, but adding to notebook anyway");
			}
		} catch (error) {
			console.warn("Error testing data loading code:", error);
		}
		
		// Show code generation in chat
		if (this.codeGenerationCallback) {
			this.codeGenerationCallback(dataLoadingCode, "Step 2: Data Loading");
		}

		// Add data loading cell with validated code
		await this.notebookService.addCodeCell(notebookPath, dataLoadingCode);
		this.updateStatus("Data loading cell added (ready for manual execution)");

		// Step 3: Analysis steps - Generate code sequentially for each step
		this.updateStatus("Adding analysis step cells...");
		for (let i = 0; i < analysisSteps.length; i++) {
			const step = analysisSteps[i];
			const stepNumber = i + 3; // Start from step 3 (after package and data loading)
			
			// Add small delay between steps for better coordination
			if (i > 0) {
				await new Promise(resolve => setTimeout(resolve, 1000));
			}

			// Add markdown cell for the step
			await this.notebookService.addMarkdownCell(
				notebookPath,
				`## Step ${stepNumber}: ${step.description}\n\nThis cell performs the analysis step: ${step.description}`
			);

			// Generate analysis code NOW
			const analysisRequest: CodeGenerationRequest = {
				stepDescription: step.description,
				originalQuestion: query,
				datasets,
				workingDir: workspaceDir,
				stepIndex: i,
			};

			const analysisResult = await this.codeGenerationService.generateDataDrivenStepCode(analysisRequest);
			let analysisCode = analysisResult.code;
			
			// Validate and lint the analysis code
			const analysisValidationResult = await this.codeValidationService.validateAndLintCode(analysisCode);
			if (!analysisValidationResult.isValid) {
				console.warn(`Analysis step ${stepNumber} code validation failed:`, analysisValidationResult.errors);
				if (this.validationErrorCallback) {
					this.validationErrorCallback(analysisValidationResult.errors, analysisValidationResult.warnings);
				}
			}
			analysisCode = analysisValidationResult.lintedCode;
			
			// Test execute the analysis code
			try {
				const executionResult = await this.cellExecutionService.executeCell(
					`test-analysis-${stepNumber}`,
					analysisCode
				);
				if (executionResult.status === "failed") {
					console.warn(`Analysis step ${stepNumber} code execution failed:`, executionResult.output);
					this.updateStatus(`⚠️ Analysis step ${stepNumber} execution failed, but adding to notebook anyway`);
				}
			} catch (error) {
				console.warn(`Error testing analysis step ${stepNumber} code:`, error);
			}
			
			// Show code generation in chat
			if (this.codeGenerationCallback) {
				this.codeGenerationCallback(analysisCode, `Step ${stepNumber}: ${step.description}`);
			}

			// Add the analysis cell with validated code
			await this.notebookService.addCodeCell(notebookPath, analysisCode);
			this.updateStatus(
				`Added analysis step ${stepNumber} (ready for manual execution)`
			);
		}

		this.updateStatus(
			"All cells added to notebook - ready for manual execution!"
		);
	}

	/**
	 * Execute cells in background without blocking the UI
	 */
	private async executeCellsInBackground(
		notebookPath: string,
		workspaceDir: string,
		packageInstallCode: string,
		datasets: Dataset[],
		analysisSteps: AnalysisStep[]
	): Promise<void> {
		try {
			// Execute package installation
			this.updateStatus("Installing required packages...");
			const packageResult = await this.cellExecutionService.executeCell(
				"package-installation",
				packageInstallCode
			);
			await this.updateCellOutput(
				notebookPath,
				2,
				packageResult.output || "Packages installed successfully!",
				workspaceDir
			);

			// Execute data download cells
			for (let i = 0; i < datasets.length; i++) {
				const dataset = datasets[i];
				this.updateStatus(`Downloading dataset ${dataset.id}...`);

				// Get the code from the notebook
				let notebookContent: string;
				try {
					notebookContent = await window.electronAPI.readFile(notebookPath);
				} catch (error) {
					console.error("Failed to read notebook file:", notebookPath, error);
					this.updateStatus(`Failed to read notebook file: ${notebookPath}`);
					continue;
				}

				let notebook: any;
				try {
					notebook = JSON.parse(notebookContent);
				} catch (error) {
					console.error("Failed to parse notebook JSON:", error);
					this.updateStatus("Failed to parse notebook content");
					continue;
				}
				const cellIndex = 4 + i * 2; // Calculate cell index
				const code = notebook.cells[cellIndex]?.source?.join("") || "";

				if (code) {
					const downloadResult = await this.cellExecutionService.executeCell(
						`download-dataset-${cellIndex}`,
						code
					);
					await this.updateCellOutput(
						notebookPath,
						cellIndex + 1,
						downloadResult.output ||
							`Dataset ${dataset.id} processed successfully!`,
						workspaceDir
					);
				}
			}

			// Execute analysis cells
			for (let i = 0; i < analysisSteps.length; i++) {
				const step = analysisSteps[i];
				this.updateStatus(`Executing analysis step ${i + 1}...`);

				// Get the code from the notebook
				let notebookContent: string;
				try {
					notebookContent = await window.electronAPI.readFile(notebookPath);
				} catch (error) {
					console.error("Failed to read notebook file:", notebookPath, error);
					this.updateStatus(`Failed to read notebook file: ${notebookPath}`);
					continue;
				}

				let notebook: any;
				try {
					notebook = JSON.parse(notebookContent);
				} catch (error) {
					console.error("Failed to parse notebook JSON:", error);
					this.updateStatus("Failed to parse notebook content");
					continue;
				}
				const cellIndex = 4 + datasets.length * 2 + i * 2; // Calculate cell index
				const code = notebook.cells[cellIndex]?.source?.join("") || "";

				if (code) {
					const analysisResult = await this.cellExecutionService.executeCell(
						`analysis-step-${cellIndex}`,
						code
					);
					await this.updateCellOutput(
						notebookPath,
						cellIndex + 1,
						analysisResult.output ||
							`Analysis step ${i + 1} completed successfully!`,
						workspaceDir
					);
				}
			}

			this.updateStatus("All cells executed successfully!");
		} catch (error) {
			console.error("Error executing cells in background:", error);
			this.updateStatus(
				"Some cells failed to execute. Check the notebook for details."
			);
		}
	}

	// Note: Notebook operations are now handled by NotebookService

	/**
	 * Update cell output in the notebook
	 */
	private async updateCellOutput(
		notebookPath: string,
		cellIndex: number,
		output: string,
		workspaceDir: string
	): Promise<void> {
		await this.notebookService.updateCellOutput(
			notebookPath,
			cellIndex,
			output,
			workspaceDir
		);

		// Analyze output with LLM and fix code if needed
		await this.analyzeAndFixCellOutput(
			notebookPath,
			cellIndex,
			output,
			workspaceDir
		);
	}

	/**
	 * Analyze cell output with LLM and fix code if problems are detected
	 */
	private async analyzeAndFixCellOutput(
		notebookPath: string,
		cellIndex: number,
		output: string,
		workspaceDir: string
	): Promise<void> {
		try {
			// Read the current notebook to get the cell code
			const notebookContent = await window.electronAPI.readFile(notebookPath);
			const notebook = JSON.parse(notebookContent);

			if (!notebook.cells[cellIndex]) {
				return;
			}

			const cell = notebook.cells[cellIndex];
			const originalCode = cell.source.join("");

			// Check if output indicates an error or problem
			const hasError = this.detectOutputProblems(output);

			if (hasError) {
				this.updateStatus("🔍 Analyzing cell output for problems...");

				// Send to LLM for analysis and fix
				const fixedCode = await this.getLLMFixForCell(originalCode, output);

				if (fixedCode && fixedCode !== originalCode) {
					this.updateStatus("🔧 Applying LLM-suggested fixes...");

					// Update the cell with fixed code using the event system
					// Dispatch an event to update the cell code
					EventManager.dispatchEvent("update-notebook-cell-code", {
						filePath: notebookPath,
						cellIndex: cellIndex,
						code: fixedCode,
					});

					// Show the fix in chat
					if (this.llmFixCallback) {
						this.llmFixCallback(originalCode, fixedCode, output);
					} else if (this.codeGenerationCallback) {
						this.codeGenerationCallback(
							fixedCode,
							`🔧 Fixed Code (Cell ${cellIndex + 1})`
						);
					}

					// Re-execute the fixed cell
					this.updateStatus("🔄 Re-executing fixed cell...");
					const fixedResult = await this.cellExecutionService.executeCell(
						`fixed-cell-${cellIndex}`,
						fixedCode
					);

					// Update with new output
					await this.updateCellOutput(
						notebookPath,
						cellIndex,
						fixedResult.output || "Cell executed successfully after fix!",
						workspaceDir
					);
				}
			}
		} catch (error) {
			console.error("Error analyzing and fixing cell output:", error);
		}
	}

	/**
	 * Detect if cell output indicates problems that need fixing
	 */
	private detectOutputProblems(output: string): boolean {
		const errorIndicators = [
			"Error:",
			"Exception:",
			"Traceback",
			"ModuleNotFoundError",
			"ImportError",
			"NameError",
			"TypeError",
			"ValueError",
			"FileNotFoundError",
			"PermissionError",
			"ConnectionError",
			"TimeoutError",
			"KeyError",
			"IndexError",
			"AttributeError",
			"ZeroDivisionError",
			"OverflowError",
			"MemoryError",
			"OSError",
			"RuntimeError",
			"failed",
			"Failed",
			"ERROR",
			"error",
			"not found",
			"Not found",
			"No such file",
			"Permission denied",
			"Connection refused",
			"Timeout",
			"Invalid",
			"invalid",
			"Unexpected",
			"unexpected",
		];

		return errorIndicators.some((indicator) => output.includes(indicator));
	}

	

	/**
	 * Get LLM fix for problematic cell code
	 */
	private async getLLMFixForCell(
		originalCode: string,
		output: string
	): Promise<string> {
		try {
			const prompt = `I have a Python code cell that produced the following output with errors:

ORIGINAL CODE:
${originalCode}

OUTPUT WITH ERRORS:
${output}

Please analyze the output and provide a fixed version of the code that addresses the issues. The fix should:
1. Handle the specific errors shown in the output
2. Maintain the original intent of the code
3. Add proper error handling where needed
4. Use correct imports and dependencies
5. Follow Python best practices

Return ONLY the fixed Python code, no explanations or markdown formatting.`;

			const result = await this.backendClient.generateCodeFix({
				prompt: prompt,
				model: this.selectedModel,
				max_tokens: 2000,
				temperature: 0.1,
			});

			return result.code || result.response || originalCode;
		} catch (error) {
			console.error("Error getting LLM fix:", error);
			return originalCode;
		}
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

		// Add common packages (avoid duplicates since we're using a Set)
		requiredPackages.add("pandas");
		requiredPackages.add("numpy");
		requiredPackages.add("matplotlib");
		
		console.log("📦 Packages for notebook cell installation:", Array.from(requiredPackages));

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
}
