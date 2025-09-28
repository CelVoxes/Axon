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
	implementation?: string; // Implementation details from DatasetManager plan
	expected_outputs?: string[]; // Expected outputs from this step
	expectedOps?: string[]; // Operations expected to satisfy this step
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
	private generatedCodeSignatures = new Set<string>();
	private executedOperations = new Set<string>();
	private analysisFullyCovered = false;
	private planLocked = false;
	private analysisTaskChecklist: Array<{
		description: string;
		status: "pending" | "completed" | "skipped";
		note?: string;
	}> = [];
	private planOverride: string[] | null = null;
	private planStepMetadata = new Map<string, { expectedOps: string[] }>();
	private planStepOrder: string[] = [];
	private pendingChecklistUpdate: {
		payload: {
			steps: Array<{ description: string; status: string; note?: string }>;
			completed: number;
			total: number;
			skipped: number;
		};
		statusMessage: string;
	} | null = null;
	private checklistDispatchTimer: ReturnType<typeof setTimeout> | null = null;
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
		this.datasetManager.setBackendClient(backendClient);
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
						this.registerCodeSignature(code);
						this.registerOperations(this.extractOperationSignatures(code));
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
		this.generatedCodeSignatures.clear();
		this.executedOperations.clear();
		this.analysisFullyCovered = false;
		this.planLocked = false;
		this.analysisTaskChecklist = [];
		this.planOverride = null;
		this.planStepMetadata.clear();
		this.planStepOrder = [];
		if (this.checklistDispatchTimer !== null) {
			clearTimeout(this.checklistDispatchTimer);
			this.checklistDispatchTimer = null;
		}
		this.pendingChecklistUpdate = null;
		try {
			delete (window as any).__axonChecklistSnapshot;
		} catch (_) {}
		console.log("🧹 AutonomousAgent: Cleared global code context");
	}

	private initializeChecklist(steps: AnalysisStep[]): void {
		this.analysisTaskChecklist = steps.map((step) => ({
			description: step.description || step.id,
			status: "pending",
		}));
		this.emitChecklistStatus();
	}

	private async maybeSkipUpcomingSteps(
		analysisSteps: AnalysisStep[],
		startIndex: number
	): Promise<void> {
		if (
			this.planLocked ||
			!this.analysisFullyCovered ||
			startIndex >= analysisSteps.length
		) {
			return;
		}

		for (let idx = startIndex; idx < analysisSteps.length; idx++) {
			const step = analysisSteps[idx];
			if (step.status !== "pending") {
				continue;
			}

			const description = step.description || step.id;
			const estimatedOps = this.estimateOperationsFromText(description);
			const newEstimatedOps = Array.from(estimatedOps).filter(
				(op) => !this.executedOperations.has(op)
			);
			if (newEstimatedOps.length > 0) {
				break;
			}

			const llmDecision = await this.shouldSkipStepWithLLM(step, {
				reason: "analysis already covered",
				stage: "mid-run",
			});
			if (!llmDecision.skip) {
				break;
			}

			const reason = llmDecision.reason || "analysis already covered";
			step.code = "";
			step.status = "completed";
			step.output = "Skipped";
			this.updateChecklist(description, "skipped", "↷");
			this.updateStatus(`Skipping "${description}" — ${reason}`);
			EventManager.dispatchEvent("step-skipped", {
				stepDescription: description,
				reason,
				timestamp: Date.now(),
			});
		}
	}

	private updateChecklist(
		description: string,
		status: "completed" | "skipped",
		note?: string
	) {
		const entry = this.analysisTaskChecklist.find(
			(item) => item.description === description
		);
		if (entry) {
			entry.status = status;
			if (note) entry.note = note;
		} else {
			this.analysisTaskChecklist.push({ description, status, note });
		}
		this.emitChecklistStatus();
	}

	private emitChecklistStatus() {
		if (!this.analysisTaskChecklist.length) return;
		const total = this.analysisTaskChecklist.length;
		const completed = this.analysisTaskChecklist.filter(
			(item) => item.status === "completed"
		).length;
		const pending = this.analysisTaskChecklist.filter(
			(item) => item.status === "pending"
		);
		const skipped = this.analysisTaskChecklist.filter(
			(item) => item.status === "skipped"
		).length;
		const topPending = pending.slice(0, 3).map((item) => item.description);
		const statusParts: string[] = [`Checklist ${completed}/${total} complete`];
		if (skipped) {
			statusParts.push(`${skipped} skipped`);
		}
		if (topPending.length) {
			statusParts.push(`Next: ${topPending[0]}`);
		}
		this.queueChecklistDispatch(
			{
				steps: this.analysisTaskChecklist.map((item) => ({ ...item })),
				completed,
				total,
				skipped,
			},
			statusParts.join(" • ")
		);
	}

	private queueChecklistDispatch(
		payload: {
			steps: Array<{ description: string; status: string; note?: string }>;
			completed: number;
			total: number;
			skipped: number;
		},
		statusMessage: string
	) {
		// Dispatch immediately so listeners (like the chat panel) can hydrate right away,
		// even during app startup when timers may fire before React effects register.
		EventManager.dispatchEvent("analysis-checklist-updated", payload);
		this.pendingChecklistUpdate = { payload, statusMessage };
		try {
			(window as any).__axonChecklistSnapshot = {
				payload,
				statusMessage,
				timestamp: Date.now(),
			};
		} catch (_) {}
		if (this.checklistDispatchTimer !== null) {
			return;
		}
		this.checklistDispatchTimer = setTimeout(() => {
			const update = this.pendingChecklistUpdate;
			this.pendingChecklistUpdate = null;
			this.checklistDispatchTimer = null;
			if (!update) return;
			this.updateStatus(update.statusMessage);
		}, 0);
	}

	setPlanOverride(steps: string[] | null): void {
		if (Array.isArray(steps) && steps.length > 0) {
			this.planOverride = steps
				.map((step) => (step || "").toString().trim())
				.filter((step) => step.length > 0);
			this.planStepOrder = [...this.planOverride];
		} else {
			this.planOverride = null;
			this.planStepOrder = [];
		}
	}

	private async shouldSkipStepWithLLM(
		step: AnalysisStep,
		options: {
			reason: string;
			stage: "pre-generation" | "post-generation" | "mid-run";
			sanitizedCode?: string;
		}
	): Promise<{ skip: boolean; reason?: string }> {
		if (!this.backendClient) {
			return { skip: true, reason: options.reason };
		}

		const truncate = (text: string, max: number = 1400) =>
			text.length <= max ? text : `${text.slice(0, max)}\n...`;

		const checklistSnapshot =
			this.analysisTaskChecklist
				.map((item, idx) => {
					const note = item.note?.trim() ? ` (${item.note.trim()})` : "";
					return `${idx + 1}. [${item.status}] ${item.description}${note}`;
				})
				.join("\n") || "(no checklist entries)";
		const executedOpsList = Array.from(this.executedOperations);
		const operationsText = executedOpsList.length
			? executedOpsList.map((op) => `- ${op}`).join("\n")
			: "(no tracked operations yet)";
		const pendingDescriptions =
			this.analysisTaskChecklist
				.filter((item) => item.status === "pending")
				.map((item) => `- ${item.description}`)
				.join("\n") || "(no remaining steps)";

		const contextParts: string[] = [];
		if (this.originalQuery) {
			contextParts.push(`Original question: ${this.originalQuery}`);
		}
		contextParts.push(
			`Current step description: ${step.description || step.id}\nStage: ${
				options.stage
			}\nProposed skip reason: ${options.reason}`
		);
		contextParts.push(`Checklist snapshot:\n${checklistSnapshot}`);
		contextParts.push(`Executed operations:\n${operationsText}`);
		contextParts.push(`Pending steps:\n${pendingDescriptions}`);
		if (options.sanitizedCode) {
			contextParts.push(
				`Candidate code snippet (truncated):\n${truncate(
					options.sanitizedCode
				)}`
			);
		}
		const context = contextParts.join("\n\n");

		const question =
			"You are reviewing an automated scientific analysis pipeline. " +
			"Given the context above, decide whether the current step should be executed." +
			" Reply with SKIP or RUN (optionally followed by a colon and a short reason).";

		try {
			const sessionId = (() => {
				try {
					const generatorAny = this.codeGenerator as any;
					if (
						generatorAny &&
						typeof generatorAny.getSessionIdForPath === "function"
					) {
						return generatorAny.getSessionIdForPath(this.workspacePath);
					}
				} catch (_) {}
				return undefined;
			})();
			const answer = await this.backendClient.askQuestion({
				question,
				context,
				sessionId,
			});
			const raw = String(answer || "").trim();
			if (!raw) {
				return { skip: false };
			}
			const match = raw.toUpperCase().match(/\b(SKIP|RUN)\b/);
			if (!match) {
				return { skip: false };
			}
			const decisionWord = match[1];
			let reasonText: string | undefined;
			const colonIndex = raw.indexOf(":");
			if (colonIndex >= 0) {
				reasonText = raw.slice(colonIndex + 1).trim();
			} else {
				const afterMatch = raw
					.slice(raw.toUpperCase().indexOf(decisionWord) + decisionWord.length)
					.trim();
				if (afterMatch.length > 0) {
					reasonText = afterMatch.replace(/^[\-–—\s]+/, "").trim();
				}
			}
			if (reasonText) {
				reasonText = reasonText.replace(/^"+|"+$/g, "").trim();
			}
			const skip = decisionWord === "SKIP";
			console.log("AutonomousAgent: LLM skip decision", {
				step: step.description || step.id,
				decision: decisionWord,
				reason: reasonText,
			});
			return { skip, reason: reasonText };
		} catch (error) {
			console.warn(
				"AutonomousAgent: LLM skip evaluation failed, defaulting to RUN",
				error
			);
			return { skip: false };
		}
	}

	private skipRemainingSteps(
		analysisSteps: AnalysisStep[],
		startIndex: number,
		reason: string
	) {
		for (let idx = startIndex; idx < analysisSteps.length; idx++) {
			const step = analysisSteps[idx];
			step.code = "";
			step.status = "completed";
			step.output = "Skipped";
			const description = step.description || step.id;
			const entry = this.analysisTaskChecklist.find(
				(item) => item.description === description
			);
			if (entry) {
				entry.status = "skipped";
				entry.note = reason;
			} else {
				this.analysisTaskChecklist.push({
					description,
					status: "skipped",
					note: reason,
				});
			}
			const statusReason = reason ? reason.trim() : "skipped";
			this.updateStatus(`↷ Skipping "${description}" — ${statusReason}`);
			this.emitChecklistStatus();
		}
		if (startIndex >= analysisSteps.length) {
			this.emitChecklistStatus();
		}
	}

	private extractOperationSignatures(code: string): Set<string> {
		const ops = new Set<string>();
		if (!code) return ops;
		const patterns: Array<[string, RegExp]> = [
			["read_10x", /sc\.read_10x_mtx\s*\(/],
			["normalize_total", /sc\.pp\.normalize_total\s*\(/],
			["log1p", /sc\.pp\.log1p\s*\(/],
			["highly_variable_genes", /sc\.pp\.highly_variable_genes\s*\(/],
			["regress_out", /sc\.pp\.regress_out\s*\(/],
			["scale", /sc\.pp\.scale\s*\(/],
			["pca", /sc\.tl\.pca\s*\(/],
			["neighbors", /sc\.pp\.neighbors\s*\(/],
			["umap", /sc\.tl\.umap\s*\(/],
			["leiden", /sc\.tl\.leiden\s*\(/],
			["rank_genes_groups", /sc\.tl\.rank_genes_groups\s*\(/],
			["save", /adata\.write\s*\(/],
			["plot", /sc\.pl\./],
			["qc_metrics", /calculate_qc_metrics\s*\(/],
			["scrublet", /scrublet|scrub\.Scrublet/],
			["layers_counts", /adata\.layers\[["']counts["']\]/],
		];
		for (const [key, regex] of patterns) {
			if (regex.test(code)) {
				ops.add(key);
			}
		}
		return ops;
	}

	private registerOperations(ops: Set<string>): void {
		if (ops.size === 0) return;
		ops.forEach((op) => this.executedOperations.add(op));
		if (this.planLocked) {
			this.updateChecklistForExecutedOperations();
			return;
		}
		const coreOps = [
			"normalize_total",
			"log1p",
			"highly_variable_genes",
			"regress_out",
			"scale",
			"pca",
			"neighbors",
			"umap",
			"leiden",
			"rank_genes_groups",
		];
		const covered = coreOps.filter((op) => this.executedOperations.has(op));
		if (covered.length >= 6) {
			this.analysisFullyCovered = true;
		}
	}

	private updateChecklistForExecutedOperations(): void {
		if (!this.planLocked || !this.analysisTaskChecklist.length) {
			return;
		}
		let changed = false;
		for (const entry of this.analysisTaskChecklist) {
			if (entry.status !== "pending") continue;
			const meta = this.planStepMetadata.get(entry.description);
			if (!meta || meta.expectedOps.length === 0) continue;
			const satisfied = meta.expectedOps.every((op) =>
				this.executedOperations.has(op)
			);
			if (satisfied) {
				entry.status = "completed";
				changed = true;
			}
		}
		if (changed) {
			this.emitChecklistStatus();
		}
	}

	private estimateOperationsFromText(text: string | undefined): Set<string> {
		const ops = new Set<string>();
		if (!text) return ops;
		const lower = text.toLowerCase();
		const add = (op: string) => ops.add(op);
		if (/read\s+10x|10x\s+mtx|adata.*layers|load\s+data/.test(lower)) {
			add("read_10x");
			add("layers_counts");
		}
		if (/normalize|library\s+size/.test(lower)) add("normalize_total");
		if (/log1p|log-transform|log\s+transform/.test(lower)) add("log1p");
		if (/highly\s+variable|hvg/.test(lower)) add("highly_variable_genes");
		if (/regress/.test(lower)) add("regress_out");
		if (/scale/.test(lower)) add("scale");
		if (/pca/.test(lower)) add("pca");
		if (/neighbor/.test(lower)) add("neighbors");
		if (/umap/.test(lower)) add("umap");
		if (/leiden|cluster/.test(lower)) add("leiden");
		if (/differential|rank\s+genes|marker/.test(lower))
			add("rank_genes_groups");
		if (/qc|mitochondrial|calculate_qc_metrics/.test(lower)) add("qc_metrics");
		if (/scrublet|doublet/.test(lower)) add("scrublet");
		if (/write|save/.test(lower)) add("save");
		if (/plot|visualiz(e|ation)/.test(lower)) add("plot");
		return ops;
	}

	private computeCodeSignature(code: string): string | null {
		if (!code) return null;
		const strippedDoc = code
			.replace(/"""[\s\S]*?"""/g, "")
			.replace(/'''[\s\S]*?'''/g, "");
		const withoutComments = strippedDoc.replace(/#.*$/gm, "");
		const normalized = withoutComments.replace(/\s+/g, "").trim().toLowerCase();
		return normalized.length ? normalized : null;
	}

	private isDuplicateCode(code: string): boolean {
		const signature = this.computeCodeSignature(code);
		if (!signature) return false;
		return this.generatedCodeSignatures.has(signature);
	}

	private registerCodeSignature(code: string): void {
		const signature = this.computeCodeSignature(code);
		if (signature) {
			this.generatedCodeSignatures.add(signature);
		}
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

	async executeAnalysisRequest(
		query: string,
		preAnalysis?: {
			intent?: string;
			entities?: string[];
			data_types?: string[];
			analysis_type?: string | string[];
			complexity?: string;
			reasoning_summary?: string;
		}
	): Promise<AnalysisResult> {
		this.originalQuery = query;
		this.isRunning = true;
		this.shouldStopAnalysis = false;

		try {
			// Use AnalysisOrchestrator to create the analysis plan
			const analysisPlan = await this.analysisOrchestrator.createAnalysisPlan(
				query,
				[],
				preAnalysis
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
		downloadedDatasets: Dataset[],
		preAnalysis?: {
			intent?: string;
			entities?: string[];
			data_types?: string[];
			analysis_type?: string | string[];
			complexity?: string;
			reasoning_summary?: string;
		}
	): Promise<AnalysisResult> {
		this.originalQuery = query;
		this.isRunning = true;
		this.shouldStopAnalysis = false;

		console.log("AutonomousAgent: workspacePath =", this.workspacePath);

		try {
			// Clear DatasetManager caches for fresh analysis
			if (
				this.datasetManager &&
				typeof this.datasetManager.clearCaches === "function"
			) {
				this.datasetManager.clearCaches();
			}

			// Use AnalysisOrchestrator to create the analysis plan with existing data
			const analysisPlan =
				await this.analysisOrchestrator.createAnalysisPlanWithData(
					query,
					downloadedDatasets,
					this.workspacePath,
					preAnalysis
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
		const overrideSteps = Array.isArray(this.planOverride) && this.planOverride.length
			? this.planOverride
				.map((step) => (step || "").toString().trim())
				.filter((step) => step.length > 0)
			: null;
		const requestedSteps: string[] = overrideSteps
			? overrideSteps
			: Array.isArray(understanding?.requiredSteps)
			? understanding.requiredSteps
				.map((step: any) =>
					typeof step === "string"
						? step.trim()
						: typeof step?.description === "string"
						? step.description.trim()
						: String(step || "").trim()
				)
				.filter((step: string) => step.length > 0)
			: [];

		const dataAnalysis = await this.datasetManager.analyzeDataTypesAndSelectTools(
			datasets,
			workingDir
		);

		let steps: AnalysisStep[];

		if (requestedSteps.length > 0) {
			this.updateStatus("Using LLM-defined plan for analysis steps...");
			steps = requestedSteps.map((description: string, index: number) => ({
				id: `step_${index + 1}`,
				description,
				code: "",
				status: "pending" as const,
				dataTypes: dataAnalysis.dataTypes,
				tools: dataAnalysis.recommendedTools,
				prerequisites: [],
				implementation: undefined,
			}));
			this.planLocked = true;
			this.planOverride = null;
		} else {
			// Fall back to intelligent generation when the LLM did not supply steps
			steps = await this.generateIntelligentAnalysisSteps(
				understanding.userQuestion,
				datasets,
				workingDir
			);
			this.planLocked = false;
			this.planOverride = null;
		}

		this.planStepOrder = steps.map((s) => s.description || s.id);
		this.planStepMetadata.clear();
		steps.forEach((step, index) => {
			const expected = this.deriveExpectedOperations(step.description || step.id);
			if (expected.length > 0) {
				step.expectedOps = expected;
			}
			step.implementation = this.buildPlanStepImplementation(
				step.description || step.id,
				index,
				this.planStepOrder,
				expected
			);
			this.planStepMetadata.set(step.description || step.id, {
				expectedOps: expected,
			});
		});

		// Store the analysis plan for future step generation
		const analysisPlan = {
			understanding,
			datasets,
			workingDir,
			requiredSteps: requestedSteps.length ? requestedSteps : understanding.requiredSteps,
			userQuestion: understanding.userQuestion,
			dataTypes: dataAnalysis.dataTypes,
			recommendedTools: dataAnalysis.recommendedTools,
		};

		// Save the analysis plan using WorkspaceManager
		await this.workspaceManager.saveAnalysisPlan(workingDir, analysisPlan);

		this.updateStatus(
			requestedSteps.length
				? "Ready to execute the LLM-defined analysis plan."
				: "Ready to execute intelligent analysis with data-driven tool selection!"
		);
		return steps;
	}

	private deriveExpectedOperations(description: string): string[] {
		const lower = (description || "").toLowerCase();
		const ops = new Set<string>();
		const add = (op: string) => ops.add(op);
		if (/import|load|read/.test(lower)) {
			add("read_10x");
			add("layers_counts");
		}
		if (/qc|quality/.test(lower)) add("qc_metrics");
		if (/normalize|scaling|library/.test(lower)) {
			add("normalize_total");
			add("log1p");
			add("scale");
		}
		if (/dimensional|pca|neighbors|umap|tsne/.test(lower)) {
			add("pca");
			add("neighbors");
			add("umap");
		}
		if (/cluster|leiden|community/.test(lower)) add("leiden");
		if (/marker|differential|rank genes/.test(lower)) add("rank_genes_groups");
		if (/visualiz|plot|figure/.test(lower)) add("plot");
		if (/batch|integration/.test(lower)) add("regress_out");
		return Array.from(ops);
	}

	private buildPlanStepImplementation(
		description: string,
		index: number,
		planOrder: string[],
		expectedOps: string[]
	): string {
		const total = planOrder.length;
		const prior = planOrder.slice(0, index);
		const next = planOrder.slice(index + 1);
		const lines: string[] = [];
		if (total > 0) {
			lines.push("Plan overview:");
			planOrder.forEach((stepDesc, idx) => {
				lines.push(`${idx + 1}. ${stepDesc}`);
			});
		}
		lines.push("");
		lines.push(
			`You are implementing step ${index + 1} of ${total}: "${description}".`
		);
		if (prior.length > 0) {
			lines.push(
				`Assume previous steps are complete: ${prior.join("; ")}. Do not repeat them.`
			);
		} else {
			lines.push("This is the first step in the plan; initialise only what is necessary.");
		}
		if (next.length > 0) {
			lines.push(
				`Do NOT implement later steps (they will be handled separately): ${next.join(", ")}.`
			);
		} else {
			lines.push("This is the final step; finalise outputs if appropriate.");
		}
		if (expectedOps.length > 0) {
			lines.push(
				`Focus on achieving these operations in this cell: ${expectedOps.join(", ")}.`
			);
		}
		lines.push(
			"Keep this cell narrowly scoped. Avoid performing downstream analysis or repeating earlier processing."
		);
		return lines.join("\n");
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
							stepCode,
							eventData.warnings,
							eventData.timings || validationResult?.timings
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
							eventData.lintedCode,
							eventData.timings || validationResult?.timings
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

		// Notify user about auto-fix process
		EventManager.dispatchEvent("auto-fix-started", {
			stepDescription: step.description || step.id,
			attempt: attempt + 1,
			errorOutput: errorOutput,
			timestamp: Date.now(),
		});

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

		// Notify user about auto-fix completion
		EventManager.dispatchEvent("auto-fix-completed", {
			stepDescription: step.description || step.id,
			attempt: attempt + 1,
			timestamp: Date.now(),
		});
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
			// Don't send massive global context - let Responses API handle memory
			globalCodeContext: "", // Empty to avoid context bloat
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
			// Don't send massive global context - let Responses API handle memory
			globalCodeContext: "", // Empty to avoid context bloat
			stepId,
			implementation: (step as any).implementation || null,
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
			// Generate dynamic analysis roadmap using LLM instead of hardcoded logic
			const analysisPlan =
				await this.datasetManager.generateDynamicAnalysisRoadmap(
					userQuestion,
					datasets,
					workingDir
				);

			// Convert plan to analysis steps
			const steps: AnalysisStep[] = [];

			for (let i = 0; i < analysisPlan.steps.length; i++) {
				const planStep = analysisPlan.steps[i];

				// Store implementation details from the plan for code generation
				steps.push({
					id: `step_${i + 1}`,
					description: planStep.description,
					code: "", // Empty - code will be generated later
					status: "pending",
					dataTypes: analysisPlan.metadata.dataTypes,
					tools:
						(planStep as any).tools || analysisPlan.metadata.recommendedTools,
					prerequisites: planStep.prerequisites || [],
					implementation: (planStep as any).implementation || null,
					expected_outputs: (planStep as any).expected_outputs || [],
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

		// Reset code signature tracking for this generation pass
		this.generatedCodeSignatures.clear();
		this.executedOperations.clear();
		this.analysisFullyCovered = false;

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
					// Don't send massive global context - let Responses API handle memory
					globalCodeContext: "", // Empty to avoid context bloat
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

		if (this.isDuplicateCode(finalCode)) {
			console.log(
				"AutonomousAgent: Setup cell already present, skipping duplicate for:",
				stepDescription
			);
			return true;
		}

		// Add to global context if requested
		if (addToContext && contextKey) {
			this.addCodeToContext(contextKey, finalCode);
		}

		this.registerCodeSignature(finalCode);
		this.registerOperations(this.extractOperationSignatures(finalCode));

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
						bestCode,
						eventData.warnings,
						eventData.timings || validationResult?.timings
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
						eventData.lintedCode,
						eventData.timings || validationResult?.timings
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
		this.initializeChecklist(analysisSteps);
		for (let i = 0; i < analysisSteps.length; i++) {
			if (this.shouldStopAnalysis) {
				this.updateStatus("Analysis cancelled");
				return false;
			}

			const step = analysisSteps[i];
			if (step.status !== "pending") {
				if (step.output === "Skipped") {
					this.updateStatus(
						`Skipping "${step.description || step.id}" — already handled`
					);
				}
				continue;
			}
			const estimatedOps = this.estimateOperationsFromText(
				step.description || step.id
			);
			const newEstimatedOps = Array.from(estimatedOps).filter(
				(op) => !this.executedOperations.has(op)
			);
			const stepsRemaining = analysisSteps.length - (i + 1);
			const allowHeuristics = !this.planLocked;
			const shouldSkipBefore =
				allowHeuristics &&
				i > 0 &&
				this.analysisFullyCovered &&
				newEstimatedOps.length === 0 &&
				stepsRemaining >= 2;
			if (shouldSkipBefore) {
				const llmDecision = await this.shouldSkipStepWithLLM(step, {
					reason: "analysis already covered",
					stage: "pre-generation",
				});
				if (llmDecision.skip) {
					const note = llmDecision.reason || "analysis already covered";
					console.log(
						"AutonomousAgent: LLM confirmed skip before generation:",
						i + 1,
						note
					);
					step.status = "completed";
					step.output = "Skipped";
					this.updateChecklist(step.description || step.id, "skipped", "↷");
					this.updateStatus(
						`Skipping "${step.description || step.id}" — ${note}`
					);

					// Send skip notification to chat
					EventManager.dispatchEvent("step-skipped", {
						stepDescription: step.description || step.id,
						reason: note,
						timestamp: Date.now(),
					});
					await this.maybeSkipUpcomingSteps(analysisSteps, i + 1);
					continue;
				}
				console.log(
					"AutonomousAgent: LLM override — executing step despite coverage heuristic:",
					i + 1
				);
			}

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

			const sanitizedCode = this.sanitizeNotebookPythonCode(stepCode);
			const stepOps = this.extractOperationSignatures(sanitizedCode);
			const newOps = Array.from(stepOps).filter(
				(op) => !this.executedOperations.has(op)
			);
			if (i > 0 && this.analysisFullyCovered && newOps.length === 0) {
				const llmDecision = await this.shouldSkipStepWithLLM(step, {
					reason: "analysis already covered",
					stage: "post-generation",
					sanitizedCode,
				});
				if (llmDecision.skip) {
					const note = llmDecision.reason || "analysis already covered";
					console.log(
						"AutonomousAgent: LLM confirmed skip after generation (covered):",
						i + 1,
						note
					);
					step.code = sanitizedCode;
					step.status = "completed";
					step.output = "Skipped";
					this.updateChecklist(step.description || step.id, "skipped", "↷");
					this.registerOperations(stepOps);
					(this as any).pendingValidationResult = null;
					(this as any).pendingValidationStepId = null;

					// Send skip notification to chat
					EventManager.dispatchEvent("step-skipped", {
						stepDescription: step.description || step.id,
						reason: note,
						timestamp: Date.now(),
					});
					await this.maybeSkipUpcomingSteps(analysisSteps, i + 1);
					continue;
				}
				console.log(
					"AutonomousAgent: LLM override — keeping step with overlapping operations:",
					i + 1
				);
			}
			if (!this.planLocked && this.isDuplicateCode(sanitizedCode)) {
				const llmDecision = await this.shouldSkipStepWithLLM(step, {
					reason: "duplicate code",
					stage: "post-generation",
					sanitizedCode,
				});
				if (llmDecision.skip) {
					const note = llmDecision.reason || "duplicate code";
					console.log(
						"AutonomousAgent: LLM confirmed skip for duplicate code:",
						i + 1,
						note
					);
					step.code = sanitizedCode;
					step.status = "completed";
					step.output = "Skipped (duplicate code)";
					this.updateChecklist(step.description || step.id, "skipped", "↷");
					(this as any).pendingValidationResult = null;
					(this as any).pendingValidationStepId = null;
					this.registerOperations(stepOps);

					// Send skip notification to chat
					EventManager.dispatchEvent("step-skipped", {
						stepDescription: step.description || step.id,
						reason: note,
						timestamp: Date.now(),
					});
					await this.maybeSkipUpcomingSteps(analysisSteps, i + 1);
					continue;
				}
				console.log(
					"AutonomousAgent: LLM override — keeping cell despite duplication heuristic:",
					i + 1
				);
			}

			console.log(
				"AutonomousAgent: Adding validated code to notebook for step:",
				i + 1
			);
			await this.notebookService.addCodeCell(notebookPath, sanitizedCode);
			this.registerCodeSignature(sanitizedCode);
			this.registerOperations(stepOps);
			this.addCodeToContext(`notebook-step-${i + 1}`, sanitizedCode);
			console.log("AutonomousAgent: Code added to notebook for step:", i + 1);
			this.updateChecklist(step.description || step.id, "completed");

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
								stepCode,
								eventData.warnings,
								eventData.timings || validationResult?.timings
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
								eventData.lintedCode,
								eventData.timings || validationResult?.timings
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
			await this.maybeSkipUpcomingSteps(analysisSteps, i + 1);

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

		const baseQuestion = this.originalQuery || query;
		const planIdx = this.planStepOrder.findIndex(
			(desc) => desc === (step.description || step.id)
		);
		const focusQuestionLines: string[] = [];
		focusQuestionLines.push(`User question: ${baseQuestion}`);
		focusQuestionLines.push(
			`Current plan step${
				planIdx >= 0
					? ` (${planIdx + 1}/${this.planStepOrder.length})`
					: ""
			}: ${step.description}`
		);
		focusQuestionLines.push(
			"Implement only this plan step in the next cell. Earlier steps are complete; later steps will be implemented separately."
		);
		const focusQuestion = focusQuestionLines.join("\n");

		// Generate code using unified method
		const request: CodeGenerationRequest = {
			stepDescription: step.description,
			originalQuestion: focusQuestion,
			datasets,
			workingDir: workspaceDir,
			stepIndex,
			// Don't send massive global context - let Responses API handle memory
			globalCodeContext: "", // Empty to avoid context bloat
			stepId,
			implementation: step.implementation,
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
					// Don't send massive global context - let Responses API handle memory
					globalCodeContext: "", // Empty to avoid context bloat
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

		// Notify user about auto-fix process in notebook
		EventManager.dispatchEvent("notebook-auto-fix-started", {
			stepDescription,
			errorOutput,
			timestamp: Date.now(),
		});

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
					// Don't send massive global context - let Responses API handle memory
					globalCodeContext: "", // Empty to avoid context bloat
				}
			);

			// Notify user about auto-fix completion in notebook
			EventManager.dispatchEvent("notebook-auto-fix-completed", {
				stepDescription,
				timestamp: Date.now(),
			});

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
