import { BackendClient } from "./BackendClient";
import { 
	Dataset, 
	AnalysisPlan,
	CodeGenerationRequest,
	ICodeGenerator,
	ICodeExecutor,
	ICodeQualityValidator
} from "./types";
import { DatasetManager } from "./DatasetManager";
import { CodeGenerationService } from "./CodeGenerationService";
import { CellExecutionService } from "./CellExecutionService";
import { NotebookService } from "./NotebookService";
import { EnvironmentManager } from "./EnvironmentManager";
import { WorkspaceManager } from "./WorkspaceManager";
import { CodeQualityOrchestrator } from "./CodeQualityOrchestrator";
import { NotebookGenerationOptions } from "./NotebookService";
import { AsyncUtils } from "../utils/AsyncUtils";
import { AnalysisOrchestrationService } from "./AnalysisOrchestrationService";

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
	private statusCallback?: (status: string) => void;
	private notebookService: NotebookService;
	private environmentManager: EnvironmentManager;
	private workspaceManager: WorkspaceManager;
	private workspacePath: string;
	private originalQuery: string = "";
	public isRunning: boolean = false;
	private shouldStopAnalysis: boolean = false;
	private selectedModel: string = "gpt-4o-mini";

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
			selectedModel || "gpt-4o-mini"
		);
		this.codeExecutor = new CellExecutionService(workspacePath);
		
		// Create dependency-free code quality validator
		this.codeQualityValidator = new CodeQualityOrchestrator(backendClient);
		
		this.notebookService = new NotebookService({
			workspacePath,
			kernelName: kernelName,
		});
		this.workspacePath = workspacePath;
		if (selectedModel) {
			this.selectedModel = selectedModel;
		}
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
			description: "Download and load datasets with size checking",
			code: "", // Empty - code will be generated later
			status: "pending",
		};
	}

	/**
	 * Simplified method for step-by-step generation using events
	 */
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

			// Generate unique step ID
			const stepId = `step-${stepIndex}-${Date.now()}-${Math.random()
				.toString(36)
				.substr(2, 9)}`;

			// Use the new event-based method
			const result = await this.codeGenerator.generateCodeWithEvents(
				request,
				stepId
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
			return this.codeGenerator.generateDataAwareBasicStepCodePublic(
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
			const result = await this.codeExecutor.executeCell(
				step.id,
				step.code,
				(updates: any) => {
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

	/**
	 * Simplified dynamic code generation using events
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

		// Regenerate code with current context and data-driven tool selection
		const request: CodeGenerationRequest = {
			stepDescription: step.description,
			originalQuestion: analysisResult.understanding.userQuestion,
			datasets: analysisResult.datasets,
			workingDir: analysisResult.workingDirectory,
			stepIndex: parseInt(step.id.split("_")[1]) - 1,
		};

		// Generate unique step ID for dynamic generation
		const stepId = `dynamic-${step.id}-${Date.now()}`;

		const result = await this.codeGenerator.generateCodeWithEvents(
			request,
			stepId
		);

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
			// Step 1: Ensure environment is ready
			await this.ensureEnvironmentReady(workspaceDir);

			// Step 2: Generate and add package installation code
			const packageCode =
				await this.environmentManager.generatePackageInstallationCode(
					datasets,
					analysisSteps
				);
			const packageTestResult = await this.codeQualityValidator.validateOnly(
				packageCode,
				"package-install"
			);
			await this.notebookService.addCodeCell(
				notebookPath,
				this.codeQualityValidator.getBestCode(packageTestResult)
			);

			this.updateStatus("Package installation cell added");

			// Step 3: Generate and add data loading code
			const dataLoadingStep = await this.generateDataLoadingStep(
				datasets,
				workspaceDir
			);
			const dataCode = await this.generateAndTestStepCode(
				dataLoadingStep,
				query,
				datasets,
				workspaceDir,
				1
			);
			await this.notebookService.addCodeCell(notebookPath, dataCode);

			this.updateStatus("Data loading cell added");

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
				await this.notebookService.addCodeCell(notebookPath, stepCode);

				this.updateStatus(
					`Added analysis step ${i + 1} of ${analysisSteps.length}`
				);

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
	 * Generate and test code for a single step
	 */
	private async generateAndTestStepCode(
		step: AnalysisStep,
		query: string,
		datasets: Dataset[],
		workspaceDir: string,
		stepIndex: number
	): Promise<string> {
		try {
			// Generate code using CodeGenerationService
			const request: CodeGenerationRequest = {
				stepDescription: step.description,
				originalQuestion: query,
				datasets,
				workingDir: workspaceDir,
				stepIndex,
			};

			const stepId = `step-${stepIndex}-${Date.now()}`;
			const result = await this.codeGenerator.generateCodeWithEvents(
				request,
				stepId
			);

			// Test the generated code using CodeQualityValidator
			const testResult = await this.codeQualityValidator.validateAndTest(
				result.code,
				stepId,
				{ stepTitle: step.description }
			);

			// Return the best version of the code
			return this.codeQualityValidator.getBestCode(testResult);
		} catch (error) {
			console.error(
				`Error generating code for step: ${step.description}:`,
				error
			);
			
			// Check if this is related to a timeout issue and use safer code
			const isTimeoutRelated = error instanceof Error && 
				error.message.toLowerCase().includes('timeout');
				
			if (isTimeoutRelated) {
				console.log("Using timeout-safe code generation for:", step.description);
				return this.codeGenerator.generateTimeoutSafeCodePublic(
					step.description,
					datasets,
					stepIndex
				);
			}
			
			// Return regular fallback code
			return this.codeGenerator.generateDataAwareBasicStepCodePublic(
				step.description,
				datasets,
				stepIndex
			);
		}
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
