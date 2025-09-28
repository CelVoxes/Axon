import { BackendClient } from "../backend/BackendClient";
import { ruffLinter, RuffResult, RuffDiagnostic } from "./RuffLinter";
import { stripCodeFences } from "../../utils/CodeTextUtils";

interface AutoFixOptions {
	filename?: string;
	stepTitle?: string;
	enableLLMFallback?: boolean;
}

interface LintTimingBreakdown {
	totalMs: number;
	ruffMs?: number;
	llmMs?: number;
	recheckMs?: number;
}

interface AutoFixResult {
	fixedCode: string;
	issues: string[];
	warnings: string[];
	wasFixed: boolean;
	ruffSucceeded: boolean;
	timings?: LintTimingBreakdown;
}

// Helper to format diagnostics consistently
function formatDiagnostics(diagnostics: RuffDiagnostic[]): string[] {
	return diagnostics.map(
		(d) =>
			`${d.code}: ${d.message} (line ${
				d.endLine && d.endLine !== d.startLine
					? `${d.startLine}-${d.endLine}`
					: d.startLine
			})`
	);
}

const MAX_SAFE_LINE_COUNT = 400;
const MAX_SAFE_CHAR_COUNT = 16000;

export async function autoFixWithRuffAndLLM(
	backendClient: BackendClient,
	code: string,
	options: AutoFixOptions = {},
	sessionId?: string
): Promise<AutoFixResult> {
	const filename = options.filename || `cell_${Date.now()}.py`;
	const getNow =
		typeof performance !== "undefined" &&
		typeof performance.now === "function"
			? () => performance.now()
			: () => Date.now();
	const overallStart = getNow();
	let ruffMs = 0;
	let llmMs = 0;
	let recheckMs = 0;

	// Normalize and strip code fences first to avoid formatter parse errors
	const input = stripCodeFences(code);
	if (!input || !input.trim()) {
		const totalMs = getNow() - overallStart;
		return {
			fixedCode: code,
			issues: [],
			warnings: [],
			wasFixed: false,
			ruffSucceeded: true,
			timings: {
				totalMs,
				ruffMs,
				llmMs,
				recheckMs,
			},
		};
	}

	// Short-circuit for very large cells to avoid blocking the UI
	const lineCount = input.split(/\r?\n/).length;
	const charCount = input.length;
	if (lineCount > MAX_SAFE_LINE_COUNT || charCount > MAX_SAFE_CHAR_COUNT) {
		const totalMs = getNow() - overallStart;
		return {
			fixedCode: input,
			issues: [],
			warnings: [
				`Lint skipped: cell is large (${lineCount} lines, ${charCount.toLocaleString()} chars). Run manual lint if needed.`,
			],
			wasFixed: false,
			ruffSucceeded: false,
			timings: {
				totalMs,
				ruffMs,
				llmMs,
				recheckMs,
			},
		};
	}

	// Single pass: Ruff lint + auto-fixes first
	let initial: RuffResult;
	const ruffStart = getNow();
	try {
		initial = await ruffLinter.lintCode(input, {
			enableFixes: true,
			filename,
			formatCode: false,
		});
		ruffMs = getNow() - ruffStart;
	} catch (e) {
		ruffMs = getNow() - ruffStart;
		// If Ruff fails entirely, skip slow LLM fallback to keep edits snappy
		const totalMs = getNow() - overallStart;
		return {
			fixedCode: input,
			issues: ["Ruff unavailable"],
			warnings: [],
			wasFixed: false,
			ruffSucceeded: false,
			timings: {
				totalMs,
				ruffMs,
				llmMs,
				recheckMs,
			},
		};
	}

	// Extract issues and warnings from Ruff results
	const issues = formatDiagnostics(
		initial.diagnostics.filter((d) => d.kind === "error")
	);
	const warnings = formatDiagnostics(
		initial.diagnostics.filter((d) => d.kind === "warning")
	);

	// Use Ruff's best output (fixed > formatted > original)
	const best = initial.fixedCode || initial.formattedCode || input;
	const wasFixed = best !== input;

	// Always prefer Ruff output first, even with errors
	// Only use LLM fallback for minimal edits when it's truly necessary
	const hasSyntaxErrors = issues.some(
		(issue) =>
			issue.includes("E999:") || // Syntax error
			issue.toLowerCase().includes("syntaxerror")
	);
	const hasUndefined = issues.some(
		(issue) => issue.startsWith("F821:") || /undefined name/i.test(issue)
	);

	// Conditions to try minimal LLM fallback:
	// - Syntax errors or undefined names remain after Ruff
	// - Keep it bounded by size to avoid latency spikes
	const isSmall = input.split(/\r?\n/).length <= 400;
	const enableLLMFallback = options.enableLLMFallback === true;
	const allowFallback =
		enableLLMFallback &&
		!initial.isValid &&
		isSmall &&
		(hasSyntaxErrors || hasUndefined);
	let recheckStart = 0;

	if (!allowFallback) {
		const totalMs = getNow() - overallStart;
		try {
			recheckStart = getNow();
			const recheck = await ruffLinter.lintCode(best, {
				enableFixes: false,
				filename,
				formatCode: false,
			});
			recheckMs = getNow() - recheckStart;
			const finalIssues = formatDiagnostics(
				recheck.diagnostics.filter((d) => d.kind === "error")
			);
			const finalWarnings = formatDiagnostics(
				recheck.diagnostics.filter((d) => d.kind === "warning")
			);
			return {
				fixedCode: best,
				issues: recheck.isValid ? [] : finalIssues,
				warnings: finalWarnings,
				wasFixed,
				ruffSucceeded: true,
				timings: {
					totalMs,
					ruffMs,
					llmMs,
					recheckMs,
				},
			};
		} catch (recheckError) {
			if (!recheckMs && recheckStart) {
				recheckMs = getNow() - recheckStart;
			}
			return {
				fixedCode: best,
				issues: initial.isValid ? [] : issues,
				warnings,
				wasFixed,
				ruffSucceeded: true,
				timings: {
					totalMs,
					ruffMs,
					llmMs,
					recheckMs,
				},
			};
		}
	}

	// Minimal LLM fallback (edit-mode-like): fix only listed diagnostics, keep code structure
	const llmStart = getNow();
	let llmFixed = await runMinimalLLMFallback(
		backendClient,
		best,
		filename,
		issues,
		warnings,
		options,
		sessionId
	);
	llmMs = getNow() - llmStart;
	llmFixed = stripCodeFences(llmFixed);

	// Re-lint quickly to get updated diagnostics for UI
	let fallbackRecheckStart = 0;
	try {
		fallbackRecheckStart = getNow();
		const recheck = await ruffLinter.lintCode(llmFixed, {
			enableFixes: false,
			filename,
			formatCode: false,
		});
		recheckMs = getNow() - fallbackRecheckStart;
		const newIssues = formatDiagnostics(
			recheck.diagnostics.filter((d) => d.kind === "error")
		);
		const newWarnings = formatDiagnostics(
			recheck.diagnostics.filter((d) => d.kind === "warning")
		);
		const totalMs = getNow() - overallStart;
		return {
			fixedCode: llmFixed || best,
			issues: recheck.isValid ? [] : newIssues,
			warnings: newWarnings,
			wasFixed: (llmFixed || "") !== input,
			ruffSucceeded: true,
			timings: {
				totalMs,
				ruffMs,
				llmMs,
				recheckMs,
			},
		};
	} catch (_) {
		// If recheck fails, return LLM-fixed code with original diagnostics
		if (!recheckMs && fallbackRecheckStart) {
			recheckMs = getNow() - fallbackRecheckStart;
		}
		const totalMs = getNow() - overallStart;
		return {
			fixedCode: llmFixed || best,
			issues,
			warnings,
			wasFixed: (llmFixed || "") !== input,
			ruffSucceeded: true,
			timings: {
				totalMs,
				ruffMs,
				llmMs,
				recheckMs,
			},
		};
	}
}

// Minimal, instruction-bound LLM fallback similar to edit-mode: fix only errors/warnings
async function runMinimalLLMFallback(
	backendClient: BackendClient,
	code: string,
	filename: string,
	issues: string[],
	warnings: string[],
	options: AutoFixOptions,
	sessionId?: string
): Promise<string> {
	const task = [
		`You will revise the given Python code to resolve ONLY the listed diagnostics.`,
		`- Do not add new functionality or complex refactors.`,
		`- Keep structure and imports intact unless required to fix undefined names.`,
		`- Do not add package installation commands or magic.`,
		`- Output ONLY the corrected code (no markdown).`,
		`\nFile: ${filename}`,
		`Diagnostics to address:`,
		...issues.map((s) => `- ${s}`),
		warnings.length ? `Non-blocking warnings (optional):` : ``,
		...warnings.map((s) => `- ${s}`),
		`\nCode:\n${code}`,
	]
		.filter(Boolean)
		.join("\n");

	let acc = "";
	await backendClient.generateCodeStream(
		{
			task_description: task,
			language: "python",
			context: options.stepTitle || "Minimal lint fix",
			...(sessionId ? { session_id: sessionId } : {}),
		},
		(chunk: string) => {
			acc += chunk;
		}
	);
	return acc || code;
}

// Emergency fallback when Ruff WebAssembly completely fails
async function fallbackToLLMOnly(
	backendClient: BackendClient,
	input: string,
	options: AutoFixOptions,
	sessionId?: string
): Promise<AutoFixResult> {
	const getNow =
		typeof performance !== "undefined" &&
		typeof performance.now === "function"
			? () => performance.now()
			: () => Date.now();
	const overallStart = getNow();
	try {
		let llmFixed = "";
		await backendClient.generateCodeStream(
			{
				task_description:
					`Fix and improve the following Python code. Focus on syntax errors, import issues, and basic best practices. Return ONLY the corrected code, no explanations.\n\n` +
					`Code:\n${input}\n`,
				language: "python",
				context:
					options.stepTitle || "Emergency code fixing (Ruff unavailable)",
				...(sessionId ? { session_id: sessionId } : {}),
			},
			(chunk: string) => {
				llmFixed += chunk;
			}
		);

		const cleaned = stripCodeFences(llmFixed);
		const totalMs = getNow() - overallStart;
		return {
			fixedCode: cleaned || input,
			issues: [],
			warnings: ["Ruff unavailable - used LLM-only validation"],
			wasFixed: cleaned !== input,
			ruffSucceeded: false,
			timings: {
				totalMs,
				ruffMs: 0,
				llmMs: totalMs,
				recheckMs: 0,
			},
		};
	} catch (e) {
		const totalMs = getNow() - overallStart;
		return {
			fixedCode: input,
			issues: [`Emergency fallback failed: ${e}`],
			warnings: ["Both Ruff and LLM validation failed"],
			wasFixed: false,
			ruffSucceeded: false,
			timings: {
				totalMs,
				ruffMs: 0,
				llmMs: totalMs,
				recheckMs: 0,
			},
		};
	}
}
