import { runNotebookStep } from "../utils";

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
				console.log(`Error output: ${errorMessage}`);

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
				console.log(`Output: ${finalOutput.substring(0, 200)}...`);

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
				output: error instanceof Error ? error.message : String(error),
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
			`CellExecutionService: Error analysis - Retryable: ${isRetryable}, Error: ${errorOutput.substring(
				0,
				100
			)}...`
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
			`CellExecutionService: Output analysis for ${cellTitle}:`,
			analysis
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
