import { BackendClient } from "../backend/BackendClient";
import {
	Dataset,
	AnalysisPlan,
	CodeGenerationRequest,
	ICodeGenerator,
	ICodeExecutor,
	// ICodeQualityValidator interface removed
} from "../types";
import { DatasetManager } from "./DatasetManager";
import { CodeGenerationService } from "../code/CodeGenerationService";
import { CellExecutionService } from "../notebook/CellExecutionService";
import { NotebookService } from "../notebook/NotebookService";
import { EnvironmentManager } from "../notebook/EnvironmentManager";
import { WorkspaceManager } from "../notebook/WorkspaceManager";
// CodeQualityOrchestrator removed - using CodeQualityService directly
import { CodeQualityService } from "../code/CodeQualityService";
import { NotebookGenerationOptions } from "../notebook/NotebookService";
import { AsyncUtils } from "../../utils/AsyncUtils";
import { AnalysisOrchestrationService } from "../chat/AnalysisOrchestrationService";
import { ConfigManager } from "../backend/ConfigManager";
import { EventManager } from "../../utils/EventManager";

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
	// Removed redundant CodeQualityOrchestrator
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

	// Lightweight dataset → hint detection to steer scRNA-seq reliably
	private detectSingleCellFromDatasets(datasets: Dataset[]): boolean {
		try {
			if (!Array.isArray(datasets)) return false;
			return datasets.some((d: any) => {
				const dt = String(d?.dataType || "").toLowerCase();
				const ff = String(d?.fileFormat || "").toLowerCase();
				const plat = String(d?.platform || "").toLowerCase();
				const url = String(d?.url || "").toLowerCase();
				const lp = String((d as any)?.localPath || "").toLowerCase();
				return (
					dt.includes("single_cell") ||
					dt.includes("singlecell") ||
					dt.includes("scrna") ||
					ff.includes("10x") ||
					ff.includes("h5ad") ||
					plat.includes("10x") ||
					url.endsWith(".h5ad") ||
					/filtered_feature_bc_matrix/.test(lp)
				);
			});
		} catch (_) {
			return false;
		}
	}

	private buildDatasetHints(datasets: Dataset[]): string {
		const isSc = this.detectSingleCellFromDatasets(datasets);
		if (isSc) {
			return [
				"DATASET HINT: single-cell RNA-seq detected (10x/AnnData).",
				"Use Scanpy standard pipeline; no heuristic transform checks.",
				"Prefer ad.read_h5ad when *.h5ad present; else sc.read_10x_mtx(data_dir).",
			].join(" \n");
		}
		return "";
	}

	// Extract pip/conda packages suggested by LLM code snippets
	private extractPackagesFromCode(code: string): string[] {
		const pkgs = new Set<string>();
		try {
			const c = String(code || "");
			const installRe = /(\%?pip|python\s+-m\s+pip)\s+install\s+([^\n;#]+)/gi;
			let m: RegExpExecArray | null;
			while ((m = installRe.exec(c)) !== null) {
				const raw = m[2] || "";
				raw
					.split(/\s+/)
					.map((t) => t.trim())
					.filter((t) => !!t && !t.startsWith("-") && !t.startsWith("#"))
					.forEach((t) => pkgs.add(t));
			}
			const subprocRe =
				/subprocess\.(?:check_call|run)\([^\)]*?([\[\(][^\]\)]+[\]\)])\)/gi;
			const arrayTokenRe = /['\"]([^'\"]+)['\"]/g;
			while ((m = subprocRe.exec(c)) !== null) {
				const list = m[1] || "";
				const tokens: string[] = [];
				let tm: RegExpExecArray | null;
				while ((tm = arrayTokenRe.exec(list)) !== null) {
					tokens.push(tm[1]);
				}
				const pipIdx = tokens.findIndex((t) => t.toLowerCase() === "pip");
				const installIdx = tokens.findIndex(
					(t) => t.toLowerCase() === "install"
				);
				if (pipIdx >= 0 && installIdx > pipIdx) {
					const pkgTokens = tokens.slice(installIdx + 1);
					pkgTokens
						.filter((t) => !!t && !t.startsWith("-"))
						.forEach((t) => pkgs.add(t));
				}
			}
		} catch (_) {}
		return Array.from(pkgs);
	}

	private buildInstallCellCode(packages: string[]): string {
		const unique = Array.from(new Set(packages))
			.filter(Boolean)
			.sort((a, b) => a.localeCompare(b));
		return [
			"# Install required packages as a single pip transaction for consistent dependency resolution",
			"import subprocess",
			"import sys",
			"",
			`required_packages = ${JSON.stringify(unique)}`,
			"",
			'print("Installing required packages as one pip call...")',
			"try:",
			'    subprocess.check_call([sys.executable, "-m", "pip", "install", *required_packages])',
			'    print("✓ All packages installed")',
			"except subprocess.CalledProcessError:",
			'    print("⚠ Failed to install one or more packages")',
			"",
			"# Optional: verify dependency conflicts",
			"try:",
			'    subprocess.check_call([sys.executable, "-m", "pip", "check"])  # verifies dependency conflicts',
			'    print("Dependency check passed")',
			"except subprocess.CalledProcessError:",
			'    print("⚠ Dependency conflicts detected")',
		].join("\n");
	}

	private async ensurePackageInstallationCell(
		notebookPath: string,
		datasets: Dataset[],
		llmSuggestedPkgs?: string[]
	): Promise<void> {
		try {
			// Check if notebook already contains an install step
			const nb = await this.notebookService.readNotebook(notebookPath);
			const existingCode = (nb.cells || [])
				.filter((c: any) => c?.cell_type === "code")
				.map((c: any) =>
					Array.isArray(c.source) ? c.source.join("") : String(c.source || "")
				)
				.join("\n");
			const installRegex = /(\b%?pip\s+install\b|\b%?conda\s+install\b)/i;
			const pipModuleRegex =
				/sys\.executable[\s\S]*?"-m"[\s\S]*?"pip"[\s\S]*?"install"/i;
			const subprocessPipRegex =
				/subprocess\.(check_call|run)\([^\)]*"pip"[^\)]*"install"/i;
			const hasInstall =
				installRegex.test(existingCode) ||
				pipModuleRegex.test(existingCode) ||
				subprocessPipRegex.test(existingCode);
			if (hasInstall) {
				console.log(
					"⏭️ Skipping package installation - already exists in notebook"
				);
				return;
			}

			// Try environment-derived package list
			const envInstall =
				await this.environmentManager.generatePackageInstallationCode(
					datasets,
					[],
					this.workspacePath
				);

			let finalInstallCode =
				envInstall && envInstall.trim().length > 0 ? envInstall : undefined;
			if (
				!finalInstallCode &&
				Array.isArray(llmSuggestedPkgs) &&
				llmSuggestedPkgs.length > 0
			) {
				console.log(
					"📦 Falling back to LLM-suggested packages for install cell (agent):",
					llmSuggestedPkgs
				);
				finalInstallCode = this.buildInstallCellCode(llmSuggestedPkgs);
			}

			if (finalInstallCode && finalInstallCode.trim().length > 0) {
				await this.notebookService.addCodeCell(notebookPath, finalInstallCode);
			}
		} catch (e) {
			console.warn("AutonomousAgent: ensurePackageInstallationCell failed:", e);
		}
	}
	// Ensure generated Python code is safe to run inside a notebook (no CLI arg parsing surprises)
	private sanitizeNotebookPythonCode(code: string): string {
		try {
			const c = String(code || "");
			const needsArgvGuard =
				/argparse|parse_args\s*\(/.test(c) && !/sys\.argv\s*=/.test(c);
			if (needsArgvGuard) {
				const hasImportSys = /\bimport\s+sys\b/.test(c);
				const prefix =
					(hasImportSys ? "" : "import sys\n") + "sys.argv = ['']\n";
				return prefix + c;
			}
			return c;
		} catch (_) {
			return code;
		}
	}

	// Global code context to track all generated code across the conversation
	private globalCodeContext = new Map<string, string>();
	private conversationId: string;
	// Legacy event listener removed - validation is now synchronous

	constructor(
		backendClient: BackendClient,
		workspacePath: string,
		selectedModel?: string,
		kernelName?: string,
		sessionId?: string
	) {
		this.backendClient = backendClient;
		this.analysisOrchestrator = new AnalysisOrchestrationService(backendClient);
		this.datasetManager = new DatasetManager();
		this.environmentManager = new EnvironmentManager(this.datasetManager);
		this.workspaceManager = new WorkspaceManager();

		// Use dependency injection to break circular dependencies
		this.codeGenerator = new CodeGenerationService(
			backendClient,
			selectedModel || ConfigManager.getInstance().getDefaultModel(),
			sessionId
		);
		this.codeExecutor = new CellExecutionService(workspacePath);

		// Single code quality service handles all validation and enhancement
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

		// Event-driven validation disabled - using synchronous validation
	}

	// Legacy event-driven validation method removed - now using synchronous validation

	/**
	 * Clean up resources
	 */
	destroy() {
		// No event listeners to clean up - validation is now synchronous
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
		// Pass to code quality service for unified status updates
		this.codeQualityService.setStatusCallback(callback);
	}

	private updateStatus(message: string) {
		if (this.statusCallback) {
			this.statusCallback(message);
		}
	}

	/**
	 * Seed the agent's global code context from an existing notebook file.
	 * Adds code from all code cells so generation can avoid duplicate imports/setup.
	 */
	private async seedContextFromNotebook(notebookPath: string): Promise<void> {
		try {
			const fileContent = await (window as any).electronAPI.readFile(
				notebookPath
			);
			const nb = JSON.parse(fileContent);
			if (Array.isArray(nb?.cells)) {
				let added = 0;
				for (let idx = 0; idx < nb.cells.length; idx++) {
					const c = nb.cells[idx];
					if (c?.cell_type !== "code") continue;
					const srcArr: string[] = Array.isArray(c.source) ? c.source : [];
					const code = srcArr.join("");
					if (code && code.trim().length > 0) {
						const id = `nb-cell-${idx}`;
						this.addCodeToContext(id, code);
						added++;
					}
				}
				if (added > 0) {
					this.updateStatus(`Loaded ${added} prior code cells into context`);
				}
			}
		} catch (e) {
			console.warn("Failed to seed global context from notebook:", e);
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

			// Start Jupyter with workspace kernels (EnvironmentManager will show status)
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

			// Initialize NotebookService with simplified kernel approach
			this.notebookService = new NotebookService({
				workspacePath: this.workspacePath,
				kernelName: "python3", // Will be dynamically discovered by JupyterService
			});

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
		// Only include remote datasets with explicit URLs
		const remoteDatasets = datasets.filter(
			(d: any) => Boolean((d as any).url) && !Boolean((d as any).localPath)
		);

		lines.push("datasets = [");
		for (const d of remoteDatasets) {
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
	 * Create a lightweight, deterministic cell that verifies local dataset paths
	 * and provides a simple mapping for later cells. This cell does not copy or
	 * move data; it only validates availability and prints helpful diagnostics.
	 */
	private buildLocalDataPreparationCode(datasets: Dataset[]): string {
		const lines: string[] = [];
		const localDatasets = datasets.filter((d: any) =>
			Boolean((d as any).localPath)
		);

		lines.push("from pathlib import Path");
		lines.push("print('Using mentioned local data folder as data_dir...')");
		lines.push("");

		if (localDatasets.length === 0) {
			lines.push("print('No local datasets selected')");
			lines.push("");
			return lines.join("\\n");
		}

		// Choose a single folder as data_dir (prefer the first directory; otherwise the parent of the first file)
		const firstDir = (localDatasets as any[]).find((d) =>
			Boolean(d.isLocalDirectory)
		);
		const firstAny = (localDatasets as any[])[0];
		const chosen = firstDir || firstAny;
		const chosenPath = (chosen?.localPath || "")
			.replace(/\\/g, "\\\\")
			.replace(/\"/g, '\\"');
		lines.push(`# Use the mentioned path as data_dir`);
		lines.push(`p = Path("${chosenPath}")`);
		lines.push(
			"if not p.exists():\n    raise FileNotFoundError(f'Path not found: {p}')"
		);
		lines.push("data_dir = p if p.is_dir() else p.parent");
		lines.push("print(f'data_dir set to: {data_dir}')");
		lines.push("# Optional: quick peek at contents");
		lines.push("try:");
		lines.push("    items = list(data_dir.iterdir())");
		lines.push("    print(f'Items in data_dir ({len(items)}):')");
		lines.push("    for x in items[:10]: print(' -', x.name)");
		lines.push("except Exception as e:");
		lines.push("    print('Could not list data_dir contents:', e)");
		lines.push("");
		return lines.join("\\n") + "\\n";
	}

	/**
	 * DEPRECATED: Use generateValidatedStepCode() instead
	 * This method bypasses validation and should not be used
	 */
	public async generateSingleStepCode(
		stepDescription: string,
		originalQuestion: string,
		datasets: Dataset[],
		workingDir: string,
		stepIndex: number
	): Promise<string> {
		console.warn(
			"AutonomousAgent: generateSingleStepCode is deprecated, use generateValidatedStepCode instead"
		);

		// Redirect to the validated path to maintain compatibility
		const analysisStep = {
			id: `deprecated-step-${Date.now()}`,
			description: stepDescription,
			code: "",
			status: "pending" as const,
		};

		return await this.generateAndTestStepCode(
			analysisStep,
			originalQuestion,
			datasets,
			workingDir,
			stepIndex
		);
	}

	/**
	 * UNIFIED CODE GENERATION API
	 * Generate and validate code for any use case (chat, analysis, etc.)
	 * Returns validated code without adding to notebook
	 */
	public async generateValidatedCode(
		stepDescription: string,
		originalQuestion: string,
		datasets: Dataset[],
		workingDir: string
	): Promise<string> {
		console.log(
			"AutonomousAgent: generateValidatedCode called for:",
			stepDescription
		);
		// Append dataset-derived hints (e.g., single-cell) to the original question
		const dsHint = this.buildDatasetHints(datasets);
		if (dsHint) {
			originalQuestion = `${originalQuestion}\n\n${dsHint}`;
		}

		const analysisStep = {
			id: `unified-step-${Date.now()}`,
			description: stepDescription,
			code: "",
			status: "pending" as const,
		};

		return await this.generateAndTestStepCode(
			analysisStep,
			originalQuestion,
			datasets,
			workingDir,
			0
		);
	}

	/**
	 * Generate, validate, and add code to notebook
	 * Uses the unified validation pipeline
	 */
	public async generateAndAddValidatedCode(
		stepDescription: string,
		originalQuestion: string,
		datasets: Dataset[],
		workingDir: string,
		notebookPath: string
	): Promise<void> {
		console.log(
			"AutonomousAgent: generateAndAddValidatedCode called for:",
			stepDescription
		);

		// Ensure context includes existing notebook cells to avoid duplicate imports/setup
		await this.seedContextFromNotebook(notebookPath);

		// Use the unified validated code generation
		const stepCode = await this.generateValidatedCode(
			stepDescription,
			originalQuestion,
			datasets,
			workingDir
		);

		// Sanitize for notebook execution safety
		const sanitized = this.sanitizeNotebookPythonCode(stepCode);

		// Ensure install cell if needed (use LLM-suggested packages as hint)
		const llmSuggestedPkgs = this.extractPackagesFromCode(stepCode);
		await this.ensurePackageInstallationCell(
			notebookPath,
			datasets,
			llmSuggestedPkgs
		);

		// Add to notebook and emit validation events in proper order
		console.log("AutonomousAgent: Adding validated code to notebook...");
		await this.notebookService.addCodeCell(notebookPath, sanitized);

		// Emit validation events AFTER notebook cell is successfully added
		if ((this as any).pendingValidationResult && this.codeGenerator) {
			const validationResult = (this as any).pendingValidationResult;
			const stepId = (this as any).pendingValidationStepId;

			if (validationResult?.validationEventData) {
				const eventData = validationResult.validationEventData;
				if (eventData.isValid) {
					if (
						typeof (this.codeGenerator as any).emitValidationSuccess ===
						"function"
					) {
						const message = `Code validation passed${
							eventData.wasFixed ? " (fixes applied)" : ""
						}${
							eventData.warnings.length > 0
								? ` with ${eventData.warnings.length} warning(s)`
								: ""
						}`;
						// Use stepCode (unsanitized) for UI comparison, not sanitized code
						(this.codeGenerator as any).emitValidationSuccess(
							stepId,
							message,
							stepCode
						);
					}
				} else {
					if (
						typeof (this.codeGenerator as any).emitValidationErrors ===
						"function"
					) {
						(this.codeGenerator as any).emitValidationErrors(
							stepId,
							eventData.errors,
							eventData.warnings,
							eventData.originalCode,
							eventData.lintedCode
						);
					}
				}
			}

			// Clear pending validation
			(this as any).pendingValidationResult = null;
			(this as any).pendingValidationStepId = null;
		}

		console.log(
			"AutonomousAgent: Code generation and validation completed successfully"
		);
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
			return this.createCancelledResult(step);
		}

		step.status = "running";

		try {
			return await this.executeStepWithRetry(step);
		} catch (error) {
			return this.createErrorResult(step, error);
		}
	}

	/**
	 * Create a cancelled result for a step
	 */
	private createCancelledResult(step: AnalysisStep): any {
		step.status = "cancelled";
		return {
			status: "cancelled",
			output: "Analysis was cancelled",
			shouldRetry: false,
		};
	}

	/**
	 * Create an error result for a step
	 */
	private createErrorResult(step: AnalysisStep, error: unknown): any {
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

	/**
	 * Execute step with retry logic and auto-fix capability
	 */
	private async executeStepWithRetry(step: AnalysisStep): Promise<any> {
		const maxAttempts = 2;
		let lastResult: any = {
			status: "failed",
			output: "",
			shouldRetry: false,
		};

		for (let attempt = 0; attempt <= maxAttempts; attempt++) {
			const result = await this.executeSingleAttempt(step);

			if (result.status === "completed") {
				return result;
			}

			lastResult = result;
			const canRetry = this.shouldRetryExecution(result, attempt, maxAttempts);

			if (!canRetry) {
				break;
			}

			// Apply auto-fix for retry
			await this.applyAutoFix(step, result.output || "", attempt);
		}

		return lastResult;
	}

	/**
	 * Execute a single attempt of the step
	 */
	private async executeSingleAttempt(step: AnalysisStep): Promise<any> {
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
		return result;
	}

	/**
	 * Determine if execution should be retried
	 */
	private shouldRetryExecution(
		result: any,
		attempt: number,
		maxAttempts: number
	): boolean {
		const errorOutput = result.output || "";
		const canRetry = Boolean(result.shouldRetry) && errorOutput.length > 0;
		return canRetry && attempt < maxAttempts;
	}

	/**
	 * Apply auto-fix to step code based on error output
	 */
	private async applyAutoFix(
		step: AnalysisStep,
		errorOutput: string,
		attempt: number
	): Promise<void> {
		this.updateStatus(
			`⚠️ Step failed, attempting auto-fix (attempt ${attempt + 1})...`
		);

		const prepared = await this.generateFixedCode(
			step.code,
			errorOutput,
			step.description
		);

		step.code = prepared;
		this.addCodeToContext(
			`auto-fix-${step.id}-attempt-${attempt + 1}`,
			prepared
		);
	}

	/**
	 * Common method to generate fixed code based on error output
	 */
	private async generateFixedCode(
		originalCode: string,
		errorOutput: string,
		stepDescription: string
	): Promise<string> {
		const refactored = await this.codeQualityService.generateRefactoredCode(
			originalCode,
			errorOutput,
			stepDescription,
			this.workspacePath
		);

		return this.codeQualityService.enhanceCode(refactored, {
			addImports: true,
			addErrorHandling: true,
			addDirectoryCreation: true,
			stepDescription,
			globalCodeContext: this.getGlobalCodeContext(),
		});
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
		workspaceDir: string,
		options?: { skipEnvCells?: boolean }
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

		// Seed global context from existing notebook so subsequent code is aware
		await this.seedContextFromNotebook(notebookPath);

		// Delegate the complex cell generation to a focused method
		return await this.generateNotebookCells(
			notebookPath,
			query,
			datasets,
			analysisSteps,
			workspaceDir,
			options
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
		workspaceDir: string,
		options?: { skipEnvCells?: boolean }
	): Promise<boolean> {
		try {
			// Setup environment and workspace
			if (
				!(await this.setupNotebookEnvironment(
					workspaceDir,
					options?.skipEnvCells
				))
			) {
				return false;
			}

			// Generate environment setup cells
			if (!options?.skipEnvCells) {
				if (
					!(await this.generateEnvironmentCells(
						notebookPath,
						datasets,
						analysisSteps,
						workspaceDir
					))
				) {
					return false;
				}
			}

			// Generate analysis step cells
			return await this.generateAnalysisStepCells(
				notebookPath,
				query,
				datasets,
				analysisSteps,
				workspaceDir
			);
		} catch (error) {
			console.error("Error generating notebook cells:", error);
			this.updateStatus("Error generating notebook cells");
			return false;
		}
	}

	/**
	 * Setup notebook environment and workspace
	 */
	private async setupNotebookEnvironment(
		workspaceDir: string,
		skipEnvCells?: boolean
	): Promise<boolean> {
		if (this.shouldStopAnalysis) {
			this.updateStatus("Analysis cancelled");
			return false;
		}

		if (!skipEnvCells) {
			await this.ensureEnvironmentReady(workspaceDir);
		}

		this.workspacePath = workspaceDir;
		this.codeExecutor.updateWorkspacePath(this.workspacePath);
		return true;
	}

	/**
	 * Generate environment setup cells (package install, data download, local data prep)
	 */
	private async generateEnvironmentCells(
		notebookPath: string,
		datasets: Dataset[],
		analysisSteps: AnalysisStep[],
		workspaceDir: string
	): Promise<boolean> {
		// Generate package installation cell
		try {
			console.log(
				"🔧 AutonomousAgent: About to generate package installation code for datasets:",
				datasets.length
			);

			// Test the package installation code generation directly first
			const testPackageCode =
				await this.environmentManager.generatePackageInstallationCode(
					datasets,
					analysisSteps,
					workspaceDir
				);
			console.log(
				"📦 AutonomousAgent: Generated package installation code length:",
				testPackageCode?.length
			);
			console.log(
				"📦 AutonomousAgent: Package code preview:",
				testPackageCode?.substring(0, 200)
			);

			const packageCellSuccess = await this.generateSetupCell(
				"Package installation",
				() => Promise.resolve(testPackageCode), // Use pre-generated code to avoid double generation
				notebookPath,
				false // Don't add to global context
			);
			if (!packageCellSuccess) {
				console.warn(
					"⚠️ Package installation cell generation returned false, but continuing..."
				);
			} else {
				console.log("✅ Package installation cell generation succeeded");
			}
		} catch (error) {
			console.error("❌ Package installation cell generation failed:", error);
			// Continue with other setup cells even if package installation fails
			// The user can still manually install packages if needed
		}

		// Generate data download cells
		const remoteDatasets = datasets.filter(
			(d: any) => Boolean((d as any).url) && !Boolean((d as any).localPath)
		);
		if (remoteDatasets.length > 0) {
			try {
				const dataDownloadSuccess = await this.generateSetupCell(
					"Data download",
					() =>
						Promise.resolve(
							this.buildDeterministicDataDownloadCode(remoteDatasets)
						),
					notebookPath,
					true, // Add to global context
					"data-download"
				);
				if (!dataDownloadSuccess) {
					console.warn(
						"Data download cell generation failed, but continuing..."
					);
				}
			} catch (error) {
				console.error("Data download cell generation failed:", error);
				// Continue with other setup cells
			}
		}

		// Generate local data preparation cell
		const localDatasets = datasets.filter((d: any) =>
			Boolean((d as any).localPath)
		);
		if (localDatasets.length > 0) {
			// Do not auto-add a cell; LLM will set data_dir and load based on context (snapshot + localPath)
			console.log(
				"🔎 Skipping auto-added local data prep; LLM decides loading from data_dir"
			);
		}

		// Do not precreate any loader helpers; LLM will decide loading approach in analysis cells

		return true;
	}

	/**
	 * Unified method for generating setup cells with events
	 */
	private async generateSetupCell(
		stepDescription: string,
		codeGenerator: () => Promise<string>,
		notebookPath: string,
		addToContext: boolean,
		contextKey?: string
	): Promise<boolean> {
		console.log(
			`AutonomousAgent: generateSetupCell called for: ${stepDescription}`
		);
		if (this.shouldStopAnalysis) {
			this.updateStatus("Analysis cancelled");
			return false;
		}

		const stepId = `${stepDescription
			.toLowerCase()
			.replace(/\s+/g, "-")}-${Date.now()}`;

		// Emit generation started event
		EventManager.dispatchEvent("code-generation-started", {
			stepId,
			stepDescription,
			timestamp: Date.now(),
		});

		// Generate code
		const rawCode = await codeGenerator();
		console.log(
			`AutonomousAgent: Generated code for ${stepDescription}:`,
			rawCode.substring(0, 200) + "..."
		);

		// Emit generation completed event
		EventManager.dispatchEvent("code-generation-completed", {
			stepId,
			stepDescription,
			finalCode: rawCode,
			success: true,
			timestamp: Date.now(),
		});

		// Validate and enhance code
		console.log(
			"AutonomousAgent: Starting validation for step:",
			stepId,
			"with stepTitle:",
			stepDescription
		);
		let validationResult;
		try {
			// For local-data-prep, avoid injecting output directory boilerplate that can break simple guards
			const disableDirCreation = contextKey === "local-data-prep";
			validationResult = await this.codeQualityService.validateAndTest(
				rawCode,
				stepId,
				{
					stepTitle: stepDescription,
					skipExecution: true,
					globalCodeContext: this.getGlobalCodeContext(),
					skipValidationEvents: true, // We'll emit events manually after notebook cell addition
					addDirectoryCreation: !disableDirCreation,
				}
			);
			console.log(
				"AutonomousAgent: Validation completed successfully for step:",
				stepId
			);

			// Note: Validation success event will be emitted AFTER notebook cell is added
		} catch (error) {
			console.error(
				"AutonomousAgent: Validation failed for step:",
				stepId,
				"Error:",
				error
			);

			// For validation errors, we still emit immediately since we won't be adding the cell
			if (
				this.codeGenerator &&
				typeof (this.codeGenerator as any).emitValidationErrors === "function"
			) {
				(this.codeGenerator as any).emitValidationErrors(
					stepId,
					[error instanceof Error ? error.message : "Validation failed"],
					[],
					rawCode,
					rawCode
				);
			}

			throw error;
		}

		const bestCode = this.codeQualityService.getBestCode(validationResult);
		const finalCode = this.sanitizeNotebookPythonCode(bestCode);

		// Add to global context if requested
		if (addToContext && contextKey) {
			this.addCodeToContext(contextKey, finalCode);
		}

		// Add to notebook AFTER validation completes but BEFORE validation events are emitted
		await this.notebookService.addCodeCell(notebookPath, finalCode);

		// NOW emit validation events AFTER the cell is successfully added to notebook
		// This ensures UI sees events in correct order: cell added → validation status
		if (validationResult?.validationEventData && this.codeGenerator) {
			const eventData = validationResult.validationEventData;
			if (eventData.isValid) {
				if (
					typeof (this.codeGenerator as any).emitValidationSuccess ===
					"function"
				) {
					const message = `Setup cell validation passed${
						eventData.wasFixed ? " (fixes applied)" : ""
					}${
						eventData.warnings.length > 0
							? ` with ${eventData.warnings.length} warning(s)`
							: ""
					}`;
					// Use bestCode (unsanitized) for UI comparison, not finalCode (sanitized for notebook)
					(this.codeGenerator as any).emitValidationSuccess(
						stepId,
						message,
						bestCode
					);
				}
			} else {
				if (
					typeof (this.codeGenerator as any).emitValidationErrors === "function"
				) {
					(this.codeGenerator as any).emitValidationErrors(
						stepId,
						eventData.errors,
						eventData.warnings,
						eventData.originalCode,
						eventData.lintedCode
					);
				}
			}
		}

		this.updateStatus(`${stepDescription} cell added`);
		return true;
	}

	/**
	 * Generate analysis step cells
	 */
	private async generateAnalysisStepCells(
		notebookPath: string,
		query: string,
		datasets: Dataset[],
		analysisSteps: AnalysisStep[],
		workspaceDir: string
	): Promise<boolean> {
		for (let i = 0; i < analysisSteps.length; i++) {
			if (this.shouldStopAnalysis) {
				this.updateStatus("Analysis cancelled");
				return false;
			}

			const step = analysisSteps[i];
			console.log(
				"AutonomousAgent: Starting generateAndTestStepCode for step:",
				i + 1
			);
			const stepCode = await this.generateAndTestStepCode(
				step,
				query,
				datasets,
				workspaceDir,
				i + 2
			);
			console.log(
				"AutonomousAgent: generateAndTestStepCode completed for step:",
				i + 1
			);

			console.log(
				"AutonomousAgent: Adding validated code to notebook for step:",
				i + 1
			);
			await this.notebookService.addCodeCell(
				notebookPath,
				this.sanitizeNotebookPythonCode(stepCode)
			);
			console.log("AutonomousAgent: Code added to notebook for step:", i + 1);

			// Emit validation events AFTER notebook cell is successfully added
			if ((this as any).pendingValidationResult && this.codeGenerator) {
				const validationResult = (this as any).pendingValidationResult;
				const stepId = (this as any).pendingValidationStepId;

				if (validationResult?.validationEventData) {
					const eventData = validationResult.validationEventData;
					if (eventData.isValid) {
						if (
							typeof (this.codeGenerator as any).emitValidationSuccess ===
							"function"
						) {
							const message = `Code validation passed${
								eventData.wasFixed ? " (fixes applied)" : ""
							}${
								eventData.warnings.length > 0
									? ` with ${eventData.warnings.length} warning(s)`
									: ""
							}`;
							(this.codeGenerator as any).emitValidationSuccess(
								stepId,
								message,
								stepCode
							);
						}
					} else {
						if (
							typeof (this.codeGenerator as any).emitValidationErrors ===
							"function"
						) {
							(this.codeGenerator as any).emitValidationErrors(
								stepId,
								eventData.errors,
								eventData.warnings,
								eventData.originalCode,
								eventData.lintedCode
							);
						}
					}
				}

				// Clear pending validation
				(this as any).pendingValidationResult = null;
				(this as any).pendingValidationStepId = null;
			}

			this.updateStatus(
				`Added analysis step ${i + 1} of ${analysisSteps.length}`
			);

			// Small delay between steps
			if (i < analysisSteps.length - 1) {
				await AsyncUtils.sleep(200);
			}
		}

		this.updateStatus("All notebook cells generated successfully!");
		return true;
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
		console.log(
			`AutonomousAgent: generateAndTestStepCode called for step: ${step.description}`
		);
		const stepId = `step-${stepIndex}-${Date.now()}`;

		// Strengthen query with dataset-derived hints (e.g., scRNA-seq) to steer codegen
		const dsHint = this.buildDatasetHints(datasets);
		if (dsHint) {
			query = `${query}\n\n${dsHint}`;
		}

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

		// Validate, clean (strip ```python fences), auto-fix; WAIT for validation to complete
		try {
			const quality = await this.codeQualityService.validateAndTest(
				genResult.code,
				stepId,
				{
					stepTitle: step.description,
					globalCodeContext: this.getGlobalCodeContext(),
					skipExecution: true,
					skipValidationEvents: true, // We'll emit events manually after notebook cell addition
					addDirectoryCreation: false,
				}
			);

			// Store the validated code and full validation result for later event emission
			const validatedCode = this.codeQualityService.getBestCode(quality);

			// Store validation result for later emission (after notebook cell is added)
			(this as any).pendingValidationResult = quality;
			(this as any).pendingValidationStepId = stepId;

			return validatedCode;
		} catch (e) {
			console.warn(
				`Code quality pipeline failed for step: ${step.description}:`,
				e as any
			);

			// Emit validation error event to satisfy UI event system
			if (
				this.codeGenerator &&
				typeof (this.codeGenerator as any).emitValidationErrors === "function"
			) {
				(this.codeGenerator as any).emitValidationErrors(
					stepId,
					[e instanceof Error ? e.message : String(e)],
					[],
					genResult.code,
					genResult.code
				);
			}

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
		const prepared = await this.generateFixedCode(
			code,
			errorOutput,
			stepDescription
		);

		// Validate the fixed code before updating cell
		const fixStepId = `auto-fix-${Date.now()}`;
		try {
			const validationResult = await this.codeQualityService.validateAndTest(
				prepared,
				fixStepId,
				{
					stepTitle: `Auto-fix: ${stepDescription}`,
					skipExecution: true,
					globalCodeContext: this.getGlobalCodeContext(),
				}
			);

			// Validation is synchronous, events are fired but code is already validated

			const validatedCode =
				this.codeQualityService.getBestCode(validationResult);

			// Update the same (last) notebook cell's code after validation
			await this.notebookService.updateCellCode(
				notebookPath,
				-1,
				validatedCode
			);
		} catch (e) {
			console.warn("Auto-fix validation failed, using unvalidated code:", e);
			// Fallback to unvalidated code if validation fails
			await this.notebookService.updateCellCode(notebookPath, -1, prepared);
		}
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
