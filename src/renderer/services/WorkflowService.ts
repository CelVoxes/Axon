import { Dataset } from "./AnalysisPlanner";
import { AnalysisSuggestionsService, DataTypeSuggestions } from "./AnalysisSuggestionsService";
import { AutonomousAgent } from "./AutonomousAgent";
import { DatasetManager } from "./DatasetManager";
import { NotebookService } from "./NotebookService";
import { StatusManager } from "./StatusManager";

export interface WorkflowStep {
	id: string;
	name: string;
	status: "pending" | "running" | "completed" | "failed";
	description: string;
	progress: number;
	result?: any;
	error?: string;
}

export class WorkflowService {
    private statusManager: StatusManager;
    private suggestionsService: AnalysisSuggestionsService;
    private datasetManager: DatasetManager;
    private agent: AutonomousAgent;
    private notebookService: NotebookService;

    private stepCallback?: (step: WorkflowStep) => void;

    constructor(
        agent: AutonomousAgent,
        suggestionsService: AnalysisSuggestionsService,
        datasetManager: DatasetManager,
        notebookService: NotebookService
    ) {
        this.agent = agent;
        this.suggestionsService = suggestionsService;
        this.datasetManager = datasetManager;
        this.notebookService = notebookService;
        this.statusManager = StatusManager.getInstance();
    }

    setStepCallback(callback: (step: WorkflowStep) => void) {
		this.stepCallback = callback;
	}

    private updateStep(step: WorkflowStep) {
		if (this.stepCallback) {
			this.stepCallback(step);
		}
	}

    private updateStatus(message: string) {
		this.statusManager.updateStatus(message);
	}

    async execute(
		query: string,
		selectedDatasets: Dataset[]
	): Promise<{
		suggestions: DataTypeSuggestions;
		notebookPath: string;
		workingDirectory: string;
	}> {
		const steps: WorkflowStep[] = [
			{
				id: "suggestions",
				name: "Generate Analysis Suggestions",
				status: "pending",
				description: "Analyzing selected datasets and generating analysis suggestions",
				progress: 0,
			},
			{
				id: "workspace",
				name: "Create Analysis Workspace",
				status: "pending",
				description: "Setting up folders and workspace structure",
				progress: 0,
			},
			{
				id: "notebook",
				name: "Create Analysis Notebook",
				status: "pending",
				description: "Creating empty notebook file and opening in editor",
				progress: 0,
			},
			{
				id: "code_generation",
				name: "Generate Analysis Code",
				status: "pending",
				description: "AI generates code for each analysis step",
				progress: 0,
			},
		];

		try {
			// Step 1: Generate dataset-aware analysis suggestions
			this.updateStep({ ...steps[0], status: "running", progress: 10 });
			this.updateStatus("🔍 Analyzing selected datasets...");

			const dataTypes = await this.datasetManager.analyzeDataTypes(selectedDatasets);
			const suggestions = await this.suggestionsService.generateSuggestions(
				dataTypes,
				query,
				selectedDatasets
			);

			this.updateStep({ ...steps[0], status: "completed", progress: 100, result: suggestions });

			// Step 2: Create analysis workspace
			this.updateStep({ ...steps[1], status: "running", progress: 20 });
			this.updateStatus("📁 Creating analysis workspace...");

			const workingDirectory = await this.agent.createAnalysisWorkspace(query);

			this.updateStep({ ...steps[1], status: "completed", progress: 100, result: workingDirectory });

			// Step 3: Create empty notebook
			this.updateStep({ ...steps[2], status: "running", progress: 30 });
			this.updateStatus("📓 Creating analysis notebook...");

			// Generate analysis steps based on suggestions
			const analysisResult = await this.agent.executeAnalysisRequestWithData(
				query,
				selectedDatasets
			);

			const notebookPath = await this.agent.generateUnifiedNotebook(
				query,
				selectedDatasets,
				analysisResult.steps,
				workingDirectory
			);

			this.updateStep({ ...steps[2], status: "completed", progress: 100, result: notebookPath });

			// Step 4: Start code generation (this will stream to chat)
			this.updateStep({ ...steps[3], status: "running", progress: 40 });
			this.updateStatus("🤖 Starting AI code generation...");

			// This will trigger streaming code generation visible in chat
			await this.agent.startNotebookCodeGeneration(
				notebookPath,
				query,
				selectedDatasets,
				analysisResult.steps,
				workingDirectory
			);

			this.updateStep({ ...steps[3], status: "completed", progress: 100 });
			this.updateStatus("✅ Analysis workflow completed!");

			return {
				suggestions,
				notebookPath,
				workingDirectory,
			};

		} catch (error) {
			const failedStep = steps.find(s => s.status === "running");
			if (failedStep) {
				this.updateStep({ 
					...failedStep, 
					status: "failed", 
					error: error instanceof Error ? error.message : String(error) 
				});
			}
			throw error;
		}
	}
}
