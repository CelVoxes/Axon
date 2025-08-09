// Centralized notebook step execution logic
import { ErrorUtils } from "../utils/ErrorUtils";
import { Cell, ExecutionResult, ICodeExecutor } from "./types";
async function runNotebookStep(
	stepId: string,
	code: string,
	update: (payload: {
		output: string | null;
		error: string | null;
		isStream?: boolean;
	}) => void,
	workspacePath?: string
) {
	try {
		console.log(
			`Executing notebook step ${stepId} with code:`,
			code.substring(0, 100) + "..."
		);
		console.log(`Workspace path: ${workspacePath}`);
		console.log(`Code length: ${code.length} characters`);

		// Check if electronAPI is available
		if (!window.electronAPI || !window.electronAPI.executeJupyterCode) {
			const error = "electronAPI.executeJupyterCode is not available";
			console.error(error);
			update({ output: null, error });
			return;
		}

		// Hook streaming output listener to update in real-time
		let accumulatedOutput = "";
		const streamHandler = (data: any) => {
			try {
				if (data && data.type === "stream" && typeof data.code === "string") {
					accumulatedOutput = data.code;
					update({ output: accumulatedOutput, error: null, isStream: true });
				}
			} catch (_) {
				// ignore handler errors
			}
		};

		// Subscribe to streaming events
		if (window.electronAPI && window.electronAPI.onJupyterCodeWriting) {
			// @ts-ignore - preload provides this method
			window.electronAPI.onJupyterCodeWriting(streamHandler);
		}

		// Execute the code (final result will be handled below)
		// @ts-ignore
		const result = await window.electronAPI.executeJupyterCode(
			code,
			workspacePath
		);

		console.log(`Jupyter execution result:`, result);

		if (result.success) {
			update({
				output: result.output || accumulatedOutput || null,
				error: null,
				isStream: false,
			});
		} else {
			update({
				output: accumulatedOutput || null,
				error: result.error || "Execution failed",
				isStream: false,
			});
		}
	} catch (error: unknown) {
		console.error(`Critical error in runNotebookStep for ${stepId}:`, error);
		const errMsg = ErrorUtils.handleError(
			`Error executing notebook step ${stepId}`,
			error
		);
		update({ output: null, error: errMsg, isStream: false });
	} finally {
		// Ensure we remove any streaming listeners we added
		try {
			if (window.electronAPI && window.electronAPI.removeAllListeners) {
				// Remove all to avoid listener buildup (no other consumers found)
				// @ts-ignore
				window.electronAPI.removeAllListeners("jupyter-code-writing");
			}
		} catch (_) {
			// ignore cleanup errors
		}
	}
}

// Interface definitions moved to types.ts to prevent circular dependencies
// Re-export Cell interface for backwards compatibility
export { Cell, ExecutionResult } from "./types";

export class CellExecutionService implements ICodeExecutor {
	private workspacePath: string;

	constructor(workspacePath: string) {
		this.workspacePath = workspacePath;
	}

	updateWorkspacePath(newWorkspacePath: string) {
		console.log(
			`CellExecutionService: Updating workspace path from ${this.workspacePath} to ${newWorkspacePath}`
		);
		this.workspacePath = newWorkspacePath;
	}

	async executeCellWithAnalysis(
		cell: Cell,
		onProgress?: (updates: Partial<Cell>) => void
	): Promise<ExecutionResult> {
		console.log(
			`CellExecutionService: Executing cell with analysis: ${cell.title}`
		);
		console.log(
			`CellExecutionService: Code length: ${cell.code.length} characters`
		);
		console.log(
			`CellExecutionService: First 200 chars of code: ${cell.code.substring(
				0,
				200
			)}...`
		);
		console.log(`CellExecutionService: Workspace path: ${this.workspacePath}`);

		// Update cell status to running
		onProgress?.({ status: "running" });

		try {
			// Execute the cell
			let finalOutput = "";
			let hasError = false;
			let errorMessage = "";

			// Add timeout wrapper for execution
			const executionPromise = runNotebookStep(
				cell.id,
				cell.code,
				(payload: {
					output: string | null;
					error: string | null;
					isStream?: boolean;
				}) => {
					// During streaming, keep status as running; mark failed on error; final completion handled below
					const status = payload.error
						? "failed"
						: payload.isStream
						? "running"
						: "completed";
					onProgress?.({
						output: payload.output ?? undefined,
						hasError: !!payload.error,
						status,
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

			// Await execution to complete. Timeout is managed in the main process via
			// an optional idle-timeout that resets on streamed output.
			await executionPromise;

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

		// Don't retry timeout errors as they likely indicate problematic code
		const timeoutErrors = [
			"idle timeout",
			"execution timeout",
			"timeout",
			"TimeoutError",
			"execution time exceeded",
		];

		const hasTimeoutError = timeoutErrors.some((errorType) =>
			errorOutput.toLowerCase().includes(errorType)
		);

		if (hasTimeoutError) {
			console.log(
				`CellExecutionService: Timeout error detected, not retrying: ${errorOutput}`
			);
			return false;
		}

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
