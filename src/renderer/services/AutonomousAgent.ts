import { BackendClient } from "./BackendClient";
import {
	Dataset,
	AnalysisPlan,
	CodeGenerationRequest,
	ICodeGenerator,
	ICodeExecutor,
	ICodeQualityValidator,
} from "./types";
import { DatasetManager } from "./DatasetManager";
import { CodeGenerationService } from "./CodeGenerationService";
import { CellExecutionService } from "./CellExecutionService";
import { NotebookService } from "./NotebookService";
import { EnvironmentManager } from "./EnvironmentManager";
import { WorkspaceManager } from "./WorkspaceManager";
import { CodeQualityOrchestrator } from "./CodeQualityOrchestrator";
import { CodeQualityService } from "./CodeQualityService";
import { NotebookGenerationOptions } from "./NotebookService";
import { AsyncUtils } from "../utils/AsyncUtils";
import { AnalysisOrchestrationService } from "./AnalysisOrchestrationService";
import { ConfigManager } from "./ConfigManager";
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
	private analysisOrchestrator: AnalysisOrchestrationService;
	private datasetManager: DatasetManager;
	private codeGenerator: ICodeGenerator;
	private codeExecutor: ICodeExecutor;
	private codeQualityValidator: ICodeQualityValidator;
	private codeQualityService: CodeQualityService;
	private statusCallback?: (status: string) => void;
	private notebookService: NotebookService;
	private environmentManager: EnvironmentManager;
	private workspaceManager: WorkspaceManager;
	private workspacePath: string;
	private originalQuery: string = "";
	public isRunning: boolean = false;
	private shouldStopAnalysis: boolean = false;
	private selectedModel: string = ConfigManager.getInstance().getDefaultModel();

	// Global code context to track all generated code across the conversation
	private globalCodeContext = new Map<string, string>();
	private conversationId: string;

	constructor(
		backendClient: BackendClient,
		workspacePath: string,
		selectedModel?: string,
		kernelName?: string
	) {
		this.backendClient = backendClient;
		this.analysisOrchestrator = new AnalysisOrchestrationService(backendClient);
		this.datasetManager = new DatasetManager();
		this.environmentManager = new EnvironmentManager(this.datasetManager);
		this.workspaceManager = new WorkspaceManager();

		// Use dependency injection to break circular dependencies
		this.codeGenerator = new CodeGenerationService(
			backendClient,
			selectedModel || ConfigManager.getInstance().getDefaultModel()
		);
		this.codeExecutor = new CellExecutionService(workspacePath);

		// Create dependency-free code quality validator
		this.codeQualityValidator = new CodeQualityOrchestrator(backendClient);
		// Full code quality service (validation + optional execution tests)
		this.codeQualityService = new CodeQualityService(
			backendClient,
			this.codeExecutor as any,
			this.codeGenerator as any
		);

		this.notebookService = new NotebookService({
			workspacePath,
			kernelName: kernelName,
		});
		this.workspacePath = workspacePath;
		if (selectedModel) {
			this.selectedModel = selectedModel;
		}

		// Initialize conversation tracking
		this.conversationId = `conv_${Date.now()}_${Math.random()
			.toString(36)
			.substr(2, 9)}`;
	}

	private async updateKernelNameFromWorkspace(): Promise<void> {
		try {
			const kernelName = await this.environmentManager.getWorkspaceKernelName(
				this.workspacePath
			);
			console.log(`Retrieved kernel name from workspace: ${kernelName}`);

			// Update the NotebookService with the correct kernel name
			this.notebookService = new NotebookService({
				workspacePath: this.workspacePath,
				kernelName: kernelName,
			});
		} catch (error) {
			console.warn(
				"Failed to get kernel name from workspace, using default: python3",
				error
			);
			// Use default kernel name on error
			this.notebookService = new NotebookService({
				workspacePath: this.workspacePath,
				kernelName: "python3",
			});
		}
	}

	setModel(model: string) {
		this.selectedModel = model;
		this.codeGenerator.setModel(model);
	}

	setStatusCallback(callback: (status: string) => void) {
		this.statusCallback = callback;
		this.analysisOrchestrator.setStatusCallback(callback);
		this.datasetManager.setStatusCallback(callback);
		this.environmentManager.setStatusCallback(callback);
		this.workspaceManager.setStatusCallback(callback);
		this.codeQualityValidator.setStatusCallback(callback);
	}

	private updateStatus(message: string) {
		if (this.statusCallback) {
			this.statusCallback(message);
		}
	}

	// ========== GLOBAL CODE CONTEXT MANAGEMENT ==========

	/**
	 * Add code to the global context
	 */
	addCodeToContext(codeId: string, code: string): void {
		this.globalCodeContext.set(codeId, code);
		console.log(`📝 AutonomousAgent: Added code to global context: ${codeId}`);
	}

	/**
	 * Get all code from the global context
	 */
	getGlobalCodeContext(): string {
		const allCode = Array.from(this.globalCodeContext.values()).join("\n\n");
		return allCode;
	}

	/**
	 * Get code context as a formatted string for LLM prompts
	 */
	getFormattedCodeContext(): string {
		if (this.globalCodeContext.size === 0) {
			return "";
		}

		const contextEntries = Array.from(this.globalCodeContext.entries())
			.map(([id, code]) => `// Code Block: ${id}\n${code}`)
			.join("\n\n");

		return `\n\nPREVIOUSLY GENERATED CODE (DO NOT REPEAT IMPORTS OR SETUP):
\`\`\`python
${contextEntries}
\`\`\`

IMPORTANT: Do not repeat imports, setup code, or functions that were already generated. Focus only on new functionality for this step.`;
	}

	/**
	 * Clear the global code context (useful for new conversations)
	 */
	clearCodeContext(): void {
		this.globalCodeContext.clear();
		console.log("🧹 AutonomousAgent: Cleared global code context");
	}

	/**
	 * Get the current conversation ID
	 */
	getConversationId(): string {
		return this.conversationId;
	}

	/**
	 * Start a new conversation (clears context and generates new ID)
	 */
	startNewConversation(): void {
		this.clearCodeContext();
		this.conversationId = `conv_${Date.now()}_${Math.random()
			.toString(36)
			.substr(2, 9)}`;
		console.log(
			`🆕 AutonomousAgent: Started new conversation: ${this.conversationId}`
		);
	}

	/**
	 * Ensure virtual environment and kernel are ready for code execution
	 */
	private async ensureEnvironmentReady(workspaceDir: string): Promise<void> {
		await this.environmentManager.ensureEnvironmentReady(workspaceDir);
	}

	/**
	 * Install required packages based on analysis requirements
	 */
	private async installRequiredPackages(
		datasets: Dataset[],
		workingDir: string
	): Promise<void> {
		await this.environmentManager.installRequiredPackages(datasets, workingDir);
	}

	async executeAnalysisRequest(query: string): Promise<AnalysisResult> {
		this.originalQuery = query;
		this.isRunning = true;
		this.shouldStopAnalysis = false;

		try {
			// Use AnalysisOrchestrator to create the analysis plan
			const analysisPlan = await this.analysisOrchestrator.createAnalysisPlan(
				query
			);

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
			// Use AnalysisOrchestrator to create the analysis plan with existing data
			const analysisPlan =
				await this.analysisOrchestrator.createAnalysisPlanWithData(
					query,
					downloadedDatasets,
					this.workspacePath
				);

			// Update the workspace path to use the analysis-specific directory
			this.workspacePath = analysisPlan.workingDirectory;
			this.codeExecutor.updateWorkspacePath(this.workspacePath);
			this.notebookService.updateWorkspacePath(this.workspacePath);

			// Ensure environment is ready (create virtual environment if needed)
			this.updateStatus("🔧 Setting up Python environment...");
			await this.ensureEnvironmentReady(this.workspacePath);

			// Start Jupyter with workspace kernels
			this.updateStatus("🔧 Starting Jupyter with workspace kernels...");
			await this.environmentManager.startJupyterWithWorkspaceKernels(
				this.workspacePath
			);

			// Ensure workspace kernel is ready
			this.updateStatus("🔧 Setting up workspace kernel...");
			await this.environmentManager.ensureWorkspaceKernelReady(
				this.workspacePath
			);

			// Install required packages for the analysis
			this.updateStatus("📦 Installing required packages...");
			await this.installRequiredPackages(
				downloadedDatasets,
				this.workspacePath
			);

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

		// Save the analysis plan using WorkspaceManager
		await this.workspaceManager.saveAnalysisPlan(workingDir, analysisPlan);

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
			description:
				"Download datasets deterministically to ./data and verify files",
			code: "", // Empty - code will be generated later
			status: "pending",
		};
	}

	/**
	 * Build a deterministic data download cell using selected dataset metadata only.
	 * This avoids LLM duplication and ensures stable behavior.
	 */
	private buildDeterministicDataDownloadCode(datasets: Dataset[]): string {
		const lines: string[] = [];
		lines.push("from pathlib import Path");
		lines.push("import requests");
		lines.push("import os");
		lines.push("");
		lines.push("print('Starting deterministic data download...')");
		lines.push("data_dir = Path('data')");
		lines.push("data_dir.mkdir(exist_ok=True)");
		lines.push("");
		lines.push("datasets = [");
		for (const d of datasets) {
			const source = (d as any).source || "Unknown";
			const providedUrl = (d as any).url || "";
			const safeTitle = (d.title || d.id).replace(/"/g, '\\"');
			lines.push(
				`    {"id": "${d.id}", "title": "${safeTitle}", "source": "${source}", "url": "${providedUrl}"},`
			);
		}
		lines.push("]");
		lines.push("");
		lines.push("def _safe_filename(url, dataset_id):");
		lines.push("    url_l = (url or '').lower()");
		lines.push("    if url_l.endswith('.h5ad'): return f'{dataset_id}.h5ad'");
		lines.push("    if url_l.endswith('.csv'): return f'{dataset_id}.csv'");
		lines.push("    if url_l.endswith('.tsv'): return f'{dataset_id}.tsv'");
		lines.push("    if url_l.endswith('.txt'): return f'{dataset_id}.txt'");
		lines.push("    return f'{dataset_id}.data'");
		lines.push("");
		lines.push("for rec in datasets:");
		lines.push("    did = rec.get('id')");
		lines.push("    url = rec.get('url')");
		lines.push("    title = rec.get('title') or did");
		lines.push("    if not url:");
		lines.push("        print(f'No URL for dataset: {title}')");
		lines.push("        continue");
		lines.push("    try:");
		lines.push("        print('Downloading:', title)");
		lines.push(
			"        resp = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=60)"
		);
		lines.push("        resp.raise_for_status()");
		lines.push("        fname = _safe_filename(url, did)");
		lines.push("        fpath = data_dir / fname");
		lines.push("        if fpath.exists():");
		lines.push("            print('Already exists, skipping:', str(fpath))");
		lines.push("            continue");
		lines.push("        with open(fpath, 'wb') as f: f.write(resp.content)");
		lines.push("        size = os.path.getsize(fpath)");
		lines.push("        print('Saved:', str(fpath), 'size:', size, 'bytes')");
		lines.push("    except Exception as e:");
		lines.push("        print('Failed to download', title, 'error:', str(e))");
		lines.push("");
		lines.push("print('Deterministic data download complete.')");
		lines.push("");
		return lines.join("\n");
	}

	/**
	 * Simplified method for step-by-step generation using unified method
	 */
	public async generateSingleStepCode(
		stepDescription: string,
		originalQuestion: string,
		datasets: Dataset[],
		workingDir: string,
		stepIndex: number
	): Promise<string> {
		this.updateStatus(
			`Generating AI code for: ${stepDescription.substring(0, 50)}...`
		);

		const request: CodeGenerationRequest = {
			stepDescription,
			originalQuestion,
			datasets,
			workingDir,
			stepIndex,
			globalCodeContext: this.getGlobalCodeContext(),
			stepId: `step-${stepIndex}-${Date.now()}-${Math.random()
				.toString(36)
				.substr(2, 9)}`,
		};

		const result = await this.codeGenerator.generateCode(request);

		// Store the generated code in global context
		this.addCodeToContext(request.stepId!, result.code);

		return result.code;
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
			// Execute with auto-fix-and-rerun loop
			const maxAttempts = 2;
			let attempt = 0;
			let lastResult: any = {
				status: "failed",
				output: "",
				shouldRetry: false,
			};

			while (attempt <= maxAttempts) {
				// Use CellExecutionService to execute the step
				const result = await this.codeExecutor.executeCell(
					step.id,
					step.code,
					(updates: any) => {
						// Update step with progress (streaming)
						Object.assign(step, updates);
					}
				);

				step.status = result.status;
				step.output = result.output;

				if (result.status === "completed") {
					return result;
				}

				// If failed, decide whether to attempt auto-fix based on output
				lastResult = result;
				const errorOutput = result.output || "";
				const canRetry = Boolean(result.shouldRetry) && errorOutput.length > 0;
				if (!canRetry || attempt === maxAttempts) {
					break;
				}

				// Attempt auto-fix using CodeQualityService and retry once
				this.updateStatus(
					`⚠️ Step failed, attempting auto-fix (attempt ${attempt + 1})...`
				);
				const refactored = await this.codeQualityService.generateRefactoredCode(
					step.code,
					errorOutput,
					step.description,
					this.workspacePath
				);

				// Clean and prepare the refactored code (imports, dirs, error handling)
				const prepared = this.codeQualityService.cleanAndPrepareCode(
					refactored,
					{
						addImports: true,
						addErrorHandling: true,
						addDirectoryCreation: true,
						stepDescription: step.description,
						globalCodeContext: this.getGlobalCodeContext(),
					}
				);

				// Update step code and global context, then retry
				step.code = prepared;
				this.addCodeToContext(
					`auto-fix-${step.id}-attempt-${attempt + 1}`,
					prepared
				);
				attempt += 1;
			}

			// Return last failure if we couldn't recover
			return lastResult;
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

	/**
	 * Simplified dynamic code generation using unified method
	 */
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

		// Generate unique step ID for dynamic generation
		const stepId = `dynamic-${step.id}-${Date.now()}`;

		// Regenerate code with current context and data-driven tool selection
		const request: CodeGenerationRequest = {
			stepDescription: step.description,
			originalQuestion: analysisResult.understanding.userQuestion,
			datasets: analysisResult.datasets,
			workingDir: analysisResult.workingDirectory,
			stepIndex: parseInt(step.id.split("_")[1]) - 1,
			globalCodeContext: this.getGlobalCodeContext(),
			stepId,
		};

		const result = await this.codeGenerator.generateCode(request);

		// Store the generated code in global context
		this.addCodeToContext(stepId, result.code);

		return result.code;
	}

	stopAnalysis(): void {
		this.shouldStopAnalysis = true;
		this.isRunning = false;
	}

	/**
	 * Create an analysis workspace using AnalysisOrchestrator
	 */
	async createAnalysisWorkspace(query: string): Promise<string> {
		return await this.workspaceManager.createAnalysisWorkspace(
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

	/**
	 * Create a unified analysis notebook structure (workflow orchestration)
	 */
	async generateUnifiedNotebook(
		query: string,
		datasets: Dataset[],
		analysisSteps: AnalysisStep[],
		workspaceDir: string
	): Promise<string | null> {
		// Delegate to NotebookService for complete notebook creation and opening
		const options: NotebookGenerationOptions = {
			query,
			datasets,
			analysisSteps,
			workspaceDir,
			includePackageInstall: true,
		};

		return await this.notebookService.generateAndOpenNotebook(options);
	}

	/**
	 * Start code generation for an existing notebook (simplified orchestration)
	 */
	async startNotebookCodeGeneration(
		notebookPath: string,
		query: string,
		datasets: Dataset[],
		analysisSteps: AnalysisStep[],
		workspaceDir: string
	): Promise<boolean> {
		console.log(
			"🚀 STARTING CODE GENERATION - packages should be installed by now"
		);

		// Check if notebook file exists and is valid
		try {
			const fileContent = await window.electronAPI.readFile(notebookPath);
			const notebook = JSON.parse(fileContent);

			// Basic validation - check if it has the expected structure
			if (!notebook.cells || !Array.isArray(notebook.cells)) {
				console.error("Notebook file exists but has invalid structure");
				return false;
			}

			console.log(
				`Notebook file is valid and ready for code generation: ${notebookPath}`
			);
		} catch (error) {
			console.error(
				`Notebook file not found or invalid: ${notebookPath}`,
				error
			);

			// Try waiting for notebook to be ready as fallback
			const readyResult = await this.notebookService.waitForNotebookReady(
				notebookPath
			);
			if (!readyResult.isReady) {
				console.error("Notebook not ready for code generation");
				return false;
			}
		}

		// Delegate the complex cell generation to a focused method
		return await this.generateNotebookCells(
			notebookPath,
			query,
			datasets,
			analysisSteps,
			workspaceDir
		);
	}

	/**
	 * Open notebook in editor (delegate to NotebookService)
	 */
	public async openNotebookInEditor(notebookPath: string): Promise<boolean> {
		return await this.notebookService.openNotebookInEditor(notebookPath);
	}

	/**
	 * Generate notebook cells with proper service delegation
	 */
	private async generateNotebookCells(
		notebookPath: string,
		query: string,
		datasets: Dataset[],
		analysisSteps: AnalysisStep[],
		workspaceDir: string
	): Promise<boolean> {
		try {
			// Step 1: Ensure environment is ready and executor workspace is correct
			await this.ensureEnvironmentReady(workspaceDir);
			this.workspacePath = workspaceDir;
			this.codeExecutor.updateWorkspacePath(this.workspacePath);

			// Step 2: Generate, lint and add package installation code
			const packageCode =
				await this.environmentManager.generatePackageInstallationCode(
					datasets,
					analysisSteps
				);
			// Validate (lint/clean) without executing; execution will happen after adding to notebook
			const packageTestResult = await this.codeQualityService.validateAndTest(
				packageCode,
				"package-install",
				{ stepTitle: "Package installation", skipExecution: true }
			);
			{
				const finalPackageCode =
					this.codeQualityService.getBestCode(packageTestResult);
				await this.notebookService.addCodeCell(notebookPath, finalPackageCode);
				this.updateStatus("Package installation cell added");

				// Execute the just-added cell with real-time streaming to notebook
				await this.executeAndStreamNotebookCell(
					notebookPath,
					finalPackageCode,
					"Package installation"
				);
			}

			// Step 3: Deterministic data download (bypass LLM for reliability)
			const rawDataDownloadCode =
				this.buildDeterministicDataDownloadCode(datasets);
			// Validate and lightly clean to ensure imports and structure, skip execution here
			const dataDownloadValidation =
				await this.codeQualityService.validateAndTest(
					rawDataDownloadCode,
					"data-download",
					{ stepTitle: "Data download", skipExecution: true }
				);
			const finalDataDownloadCode = this.codeQualityService.getBestCode(
				dataDownloadValidation
			);
			await this.notebookService.addCodeCell(
				notebookPath,
				finalDataDownloadCode
			);

			// Add deterministic download code to global context to prevent LLM re-downloading
			this.addCodeToContext("data-download", finalDataDownloadCode);

			this.updateStatus("Data download cell added");

			// Execute the data download cell and stream output into the notebook
			await this.executeAndStreamNotebookCell(
				notebookPath,
				finalDataDownloadCode,
				"Data download"
			);

			// Step 4: Generate and add analysis step codes
			for (let i = 0; i < analysisSteps.length; i++) {
				const step = analysisSteps[i];
				const stepCode = await this.generateAndTestStepCode(
					step,
					query,
					datasets,
					workspaceDir,
					i + 2
				);
				// Add code cell to notebook
				await this.notebookService.addCodeCell(notebookPath, stepCode);

				this.updateStatus(
					`Added analysis step ${i + 1} of ${analysisSteps.length}`
				);

				// Execute and stream this step's output in real time; auto-fix on failure
				const result = await this.executeAndStreamNotebookCell(
					notebookPath,
					stepCode,
					step.description
				);

				// Update global context with the final executed code if it differs (e.g., after auto-fix)
				if (result && typeof result.analysis === "object") {
					// no-op: reserved for future richer analysis handling
				}

				// Small delay between steps
				if (i < analysisSteps.length - 1) {
					await AsyncUtils.sleep(500);
				}
			}

			this.updateStatus("All notebook cells generated successfully!");
			return true;
		} catch (error) {
			console.error("Error generating notebook cells:", error);
			this.updateStatus("Error generating notebook cells");
			return false;
		}
	}

	/**
	 * Generate and test code for a single step using unified method
	 */
	private async generateAndTestStepCode(
		step: AnalysisStep,
		query: string,
		datasets: Dataset[],
		workspaceDir: string,
		stepIndex: number
	): Promise<string> {
		const stepId = `step-${stepIndex}-${Date.now()}`;

		// Generate code using unified method
		const request: CodeGenerationRequest = {
			stepDescription: step.description,
			originalQuestion: query,
			datasets,
			workingDir: workspaceDir,
			stepIndex,
			globalCodeContext: this.getGlobalCodeContext(),
			stepId,
		};

		const genResult = await this.codeGenerator.generateCode(request);

		// Store generated code in global context
		this.addCodeToContext(stepId, genResult.code);

		// Validate, clean (strip ```python fences), auto-fix; DEFER EXECUTION to after appending to notebook
		try {
			const quality = await this.codeQualityService.validateAndTest(
				genResult.code,
				stepId,
				{
					stepTitle: step.description,
					globalCodeContext: this.getGlobalCodeContext(),
					skipExecution: true,
				}
			);
			return this.codeQualityService.getBestCode(quality);
		} catch (e) {
			console.warn(
				`Code quality pipeline failed for step: ${step.description}:`,
				e as any
			);
			// Fall back to raw generated code
			return genResult.code;
		}
	}

	/**
	 * Execute the most recently added cell's code, streaming output into the notebook UI in real time.
	 * If execution fails and is retryable, attempt an auto-fix, update the same cell's code, and retry once.
	 */
	private async executeAndStreamNotebookCell(
		notebookPath: string,
		code: string,
		stepDescription: string
	) {
		// Stream handler: update the last cell's output in the notebook file/UI
		const onProgress = (updates: any) => {
			if (updates && typeof updates.output === "string") {
				EventManager.dispatchEvent("update-notebook-cell", {
					filePath: notebookPath,
					cellIndex: -1, // -1 denotes last-added cell
					output: updates.output,
					status: updates.status || (updates.hasError ? "failed" : "running"),
				});
			}
		};

		// First execution
		const firstResult = await this.codeExecutor.executeCell(
			`nbcell-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
			code,
			onProgress
		);

		if (firstResult.status === "completed") {
			return firstResult;
		}

		// Attempt auto-fix if retry is advisable
		const errorOutput = firstResult.output || "";
		const canRetry = Boolean(firstResult.shouldRetry) && errorOutput.length > 0;
		if (!canRetry) {
			return firstResult;
		}

		this.updateStatus("Attempting auto-fix based on execution error...");
		const refactored = await this.codeQualityService.generateRefactoredCode(
			code,
			errorOutput,
			stepDescription,
			this.workspacePath
		);

		const prepared = this.codeQualityService.cleanAndPrepareCode(refactored, {
			addImports: true,
			addErrorHandling: true,
			addDirectoryCreation: true,
			stepDescription,
			globalCodeContext: this.getGlobalCodeContext(),
		});

		// Update the same (last) notebook cell's code before re-executing
		await this.notebookService.updateCellCode(notebookPath, -1, prepared);
		this.addCodeToContext(
			`auto-fix-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
			prepared
		);

		// Re-execute with streaming
		const secondResult = await this.codeExecutor.executeCell(
			`nbcell-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
			prepared,
			onProgress
		);

		return secondResult;
	}

	/**
	 * Generate package installation code (delegate to EnvironmentManager)
	 */
	private async generatePackageInstallationCode(
		datasets: Dataset[],
		analysisSteps: AnalysisStep[]
	): Promise<string> {
		return await this.environmentManager.generatePackageInstallationCode(
			datasets,
			analysisSteps
		);
	}
}
