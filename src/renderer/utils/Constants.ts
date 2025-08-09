/**
 * Centralized constants used across the application
 */

export const LANGUAGES = {
	PYTHON: "python",
	R: "r",
	MARKDOWN: "markdown",
} as const;

export const CELL_STATUS = {
	PENDING: "pending",
	RUNNING: "running",
	COMPLETED: "completed",
	FAILED: "failed",
	CANCELLED: "cancelled",
} as const;

export const ANALYSIS_TYPES = {
	DIFFERENTIAL_EXPRESSION: "differential expression analysis",
	TIME_SERIES: "time series analysis",
	SURVIVAL: "survival analysis",
	PATHWAY_ENRICHMENT: "pathway enrichment analysis",
} as const;

export const FILE_FORMATS = {
	CSV: "csv",
	TSV: "tsv",
	JSON: "json",
	IPYNB: ".ipynb",
} as const;

export const API_ENDPOINTS = {
	LLM_PLAN: "/llm/plan",
	LLM_CODE: "/llm/code",
	LLM_CODE_STREAM: "/llm/code/stream",
	LLM_SUGGESTIONS: "/llm/suggestions",
	LLM_VALIDATE_CODE: "/llm/validate-code",
} as const;

// External service bases
export const CELLXCENSUS_DATASET_BASE =
	"https://datasets.cellxgene.cziscience.com";

export const DEFAULT_CONFIGS = {
	MAX_TOKENS: 2000,
	TEMPERATURE: 0.1,
	RETRY_ATTEMPTS: 3,
	TIMEOUT_MS: 120000,
} as const;

export type Language = (typeof LANGUAGES)[keyof typeof LANGUAGES];
export type CellStatus = (typeof CELL_STATUS)[keyof typeof CELL_STATUS];
export type AnalysisType = (typeof ANALYSIS_TYPES)[keyof typeof ANALYSIS_TYPES];
export type FileFormat = (typeof FILE_FORMATS)[keyof typeof FILE_FORMATS];
