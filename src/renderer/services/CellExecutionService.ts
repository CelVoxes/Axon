// Centralized notebook step execution logic
import { ErrorUtils } from "../utils/ErrorUtils";
async function runNotebookStep(
	stepId: string,
	code: string,
	update: (payload: { output: string | null; error: string | null }) => void,
	workspacePath?: string
) {
	try {
		console.log(
			`Executing notebook step ${stepId} with code:`,
			code.substring(0, 100) + "..."
		);

		// @ts-ignore
		const result = await window.electronAPI.executeJupyterCode(
			code,
			workspacePath
		);

		console.log(`Jupyter execution result:`, result);

		if (result.success) {
			update({ output: result.output || null, error: null });
		} else {
			update({ output: null, error: result.error || "Execution failed" });
		}
	} catch (error: unknown) {
		const errMsg = ErrorUtils.handleError(`Error executing notebook step ${stepId}`, error);
		update({ output: null, error: errMsg });
	}
}

export interface Cell {
	id: string;
	code: string;
	language: "python" | "r" | "markdown";
	output: string;
	hasError: boolean;
	status: "pending" | "running" | "completed" | "failed";
	title?: string;
	isMarkdown?: boolean;
}

export interface ExecutionResult {
	status: "completed" | "failed";
	output: string;
	shouldRetry: boolean;
	analysis?: any;
}

export class CellExecutionService {
	private workspacePath: string;

	constructor(workspacePath: string) {
		this.workspacePath = workspacePath;
	}

	updateWorkspacePath(newWorkspacePath: string) {
		console.log(`CellExecutionService: Updating workspace path from ${this.workspacePath} to ${newWorkspacePath}`);
		this.workspacePath = newWorkspacePath;
	}

	async executeCellWithAnalysis(
		cell: Cell,
		onProgress?: (updates: Partial<Cell>) => void
	): Promise<ExecutionResult> {
		console.log(
			`CellExecutionService: Executing cell with analysis: ${cell.title}`
		);

		// Update cell status to running
		onProgress?.({ status: "running" });

		try {
			// Execute the cell
			let finalOutput = "";
			let hasError = false;
			let errorMessage = "";

			await runNotebookStep(
				cell.id,
				cell.code,
				(payload: { output: string | null; error: string | null }) => {
					const newStatus = payload.error ? "failed" : "completed";
					onProgress?.({
						output: payload.output ?? undefined,
						hasError: !!payload.error,
						status: newStatus,
					});

					// Store the final output and error for analysis
					if (payload.output) finalOutput = payload.output;
					if (payload.error) {
						hasError = true;
						errorMessage = payload.error;
					}
				},
				this.workspacePath
			);

			if (hasError) {
				console.log(
					`CellExecutionService: Cell execution failed: ${cell.title}`
				);

				// Analyze the error to determine if we should retry
				const shouldRetry = await this.analyzeErrorForRetry(
					errorMessage,
					cell.code
				);

				return {
					status: "failed",
					output: errorMessage || "Execution failed",
					shouldRetry,
				};
			} else {
				console.log(
					`CellExecutionService: Cell execution completed: ${cell.title}`
				);

				// Analyze the output to determine if it's successful
				const outputAnalysis = await this.analyzeCellOutput(
					finalOutput,
					cell.title || ""
				);

				return {
					status: "completed",
					output: finalOutput,
					shouldRetry: false,
					analysis: outputAnalysis,
				};
			}
		} catch (error) {
			console.error(
				`CellExecutionService: Error executing cell ${cell.title}:`,
				error
			);
			return {
				status: "failed",
				output: ErrorUtils.getErrorMessage(error),
				shouldRetry: true, // Retry on unexpected errors
			};
		}
	}

	private async analyzeErrorForRetry(
		errorOutput: string,
		originalCode: string
	): Promise<boolean> {
		// Simple heuristic: retry if it's a common, fixable error
		const retryableErrors = [
			"ModuleNotFoundError",
			"ImportError",
			"NameError",
			"AttributeError",
			"TypeError",
			"ValueError",
			"FileNotFoundError",
			"PermissionError",
		];

		const isRetryable = retryableErrors.some((errorType) =>
			errorOutput.includes(errorType)
		);

		console.log(
			`CellExecutionService: Error analysis - Retryable: ${isRetryable}`
		);

		return isRetryable;
	}

	private async analyzeCellOutput(
		output: string,
		cellTitle: string
	): Promise<any> {
		// Simple output analysis to determine success
		const analysis = {
			hasOutput: output.length > 0,
			outputLength: output.length,
			containsError: output.toLowerCase().includes("error"),
			containsWarning: output.toLowerCase().includes("warning"),
			containsPlot: output.includes("Figure") || output.includes("plot"),
			containsData: output.includes("DataFrame") || output.includes("array"),
		};

		console.log(
			`CellExecutionService: Output analysis completed for ${cellTitle}`
		);
		return analysis;
	}

	async executeCell(
		cellId: string,
		code: string,
		onProgress?: (updates: Partial<Cell>) => void
	): Promise<ExecutionResult> {
		const cell: Cell = {
			id: cellId,
			code,
			language: "python",
			output: "",
			hasError: false,
			status: "pending",
		};

		return this.executeCellWithAnalysis(cell, onProgress);
	}
}
