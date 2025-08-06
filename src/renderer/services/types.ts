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
	'code-generation-started': CodeGenerationStartedEvent;
	'code-generation-chunk': CodeGenerationChunkEvent;
	'code-generation-completed': CodeGenerationCompletedEvent;
	'code-generation-failed': CodeGenerationFailedEvent;
	'code-validation-error': CodeValidationErrorEvent;
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
	timestamp: number;
}