/**
 * Shared types to prevent circular dependencies between services
 */

export interface Dataset {
	id: string;
	title: string;
	source: string;
	organism?: string;
	samples?: number;
	platform?: string;
	description?: string;
	url?: string;
	dataType?: string;
	fileFormat?: string;
	columns?: string[];
	dimensions?: number[];
	/** Optional human-friendly handle for local mentions like @data.csv */
	alias?: string;
	/** Absolute filesystem path if this is a local dataset (file or directory) */
	localPath?: string;
	/** True if localPath points to a directory (e.g., a 10x folder) */
	isLocalDirectory?: boolean;
}

export interface DataTypeAnalysis {
	dataTypes: string[];
	recommendedTools: string[];
	dataComplexity: "simple" | "moderate" | "complex";
	suggestedApproach: string;
	estimatedCells: number;
	analysisApproaches: string[];
}

export interface AnalysisPlan {
	understanding: {
		userQuestion: string;
		requiredSteps: string[];
		dataNeeded: string[];
		expectedOutputs: string[];
	};
	datasets: Dataset[];
	workingDirectory: string;
	metadata?: {
		createdAt: string;
		analysisType: string;
		complexity: string;
		estimatedDuration: string;
		kernelName?: string;
	};
}

// Code Generation Event Types
export interface CodeGenerationEvents {
	"code-generation-started": CodeGenerationStartedEvent;
	"code-generation-chunk": CodeGenerationChunkEvent;
	"code-generation-completed": CodeGenerationCompletedEvent;
	"code-generation-failed": CodeGenerationFailedEvent;
	"code-validation-precheck": CodeValidationPrecheckEvent;
	"code-validation-error": CodeValidationErrorEvent;
	"code-validation-success": CodeValidationSuccessEvent;
}

export interface CodeGenerationStartedEvent {
	stepId: string;
	stepDescription: string;
	timestamp: number;
}

export interface CodeGenerationChunkEvent {
	stepId: string;
	stepDescription: string;
	chunk: string;
	accumulatedCode: string;
	timestamp: number;
}

export interface CodeGenerationCompletedEvent {
	stepId: string;
	stepDescription: string;
	finalCode: string;
	success: boolean;
	timestamp: number;
}

export interface CodeGenerationFailedEvent {
	stepId: string;
	stepDescription: string;
	error: string;
	timestamp: number;
}

export interface CodeValidationErrorEvent {
	stepId: string;
	errors: string[];
	warnings: string[];
	originalCode: string;
	fixedCode?: string;
	timings?: CodeValidationTimings;
	timestamp: number;
}

export interface CodeValidationPrecheckEvent {
	stepId: string;
	errors: string[];
	warnings: string[];
	code: string;
	timings?: CodeValidationTimings;
	timestamp: number;
}

export interface CodeValidationSuccessEvent {
	stepId: string;
	message: string;
	code?: string;
	warnings: string[];
	timings?: CodeValidationTimings;
	timestamp: number;
}

// Shared progress types
export interface SearchProgress {
	message: string;
	step: string;
	progress: number; // 0-100
	datasetsFound?: number;
	currentTerm?: string;
}

// ========== DEPENDENCY-FREE SERVICE INTERFACES ==========

/**
 * Interfaces to break circular dependencies between services
 */

export interface CodeGenerationRequest {
	stepDescription: string;
	originalQuestion: string;
	datasets: Dataset[];
	workingDir: string;
	stepIndex: number;
	previousCode?: string;
	globalCodeContext?: string; // Add global code context from entire conversation
	// Optional target language hint for generation (default: 'python')
	language?: "python" | "r";
	fallbackMode?: "basic" | "timeout-safe" | "data-aware";
	implementation?: string; // Implementation details from DatasetManager plan
	withTesting?: boolean;
	stepId?: string;
	isDirectEdit?: boolean;
}

export interface CodeGenerationResult {
	code: string;
	success: boolean;
	error?: string;
}

export interface Cell {
	id: string;
	code: string;
	language: "python" | "r" | "markdown";
	output: string;
	hasError: boolean;
	status: "pending" | "running" | "completed" | "failed" | "cancelled";
	title?: string;
	isMarkdown?: boolean;
}

export interface ExecutionResult {
	status: "completed" | "failed" | "cancelled";
	output: string;
	shouldRetry: boolean;
	analysis?: any;
}

export interface CodeQualityOptions {
	stepTitle?: string;
	maxRetries?: number;
	timeoutMs?: number;
	globalCodeContext?: string;
}

export interface CodeValidationResult {
	isValid: boolean;
	originalCode: string;
	validatedCode: string;
	errors: string[];
	warnings: string[];
	improvements: string[];
	retryCount: number;
	success: boolean;
	timings?: CodeValidationTimings;
}

export interface CodeValidationTimings {
	totalMs: number;
	enhancementMs: number;
	lintMs: number;
	executionMs: number;
	restMs: number;
	lintBreakdown?: {
		totalMs: number;
		ruffMs?: number;
		llmMs?: number;
		recheckMs?: number;
	};
}

// ========== SERVICE INTERFACES FOR DEPENDENCY INJECTION ==========

export interface ICodeGenerator {
	/**
	 * Unified code generation method - handles all scenarios
	 */
	generateCode(request: CodeGenerationRequest): Promise<CodeGenerationResult>;

	setModel(model: string): void;
}

export interface ICodeExecutor {
	executeCell(
		cellId: string,
		code: string,
		onProgress?: (updates: Partial<Cell>) => void,
		language?: "python" | "r"
	): Promise<ExecutionResult>;

	executeCellWithAnalysis(
		cell: Cell,
		onProgress?: (updates: Partial<Cell>) => void
	): Promise<ExecutionResult>;

	updateWorkspacePath(newWorkspacePath: string): void;
}

export interface ICodeQualityValidator {
	validateOnly(code: string, stepId: string): Promise<CodeValidationResult>;

	validateAndTest(
		code: string,
		stepId: string,
		options?: CodeQualityOptions
	): Promise<CodeValidationResult>;

	getBestCode(result: CodeValidationResult): string;

	setStatusCallback(callback: (status: string) => void): void;
}

export interface IBackendClient {
	validateCode(request: {
		code: string;
		language?: string;
		context?: string;
	}): Promise<any>;

	generateCodeFix(request: {
		prompt: string;
		model: string;
		max_tokens?: number;
		temperature?: number;
		session_id?: string;
	}): Promise<any>;

	generateSuggestions(request: {
		dataTypes: string[];
		query: string;
		selectedDatasets: any[];
		contextInfo?: string;
	}): Promise<any>;

	askQuestion(params: {
		question: string;
		context?: string;
		sessionId?: string;
	}): Promise<string>;

	getLLMConfig(): Promise<{
		default_model: string;
		available_models: string[];
		service_tier?: string | null;
	} | null>;
}
