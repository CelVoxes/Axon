import { BackendClient } from "../backend/BackendClient";
import { ruffLinter, RuffResult, RuffDiagnostic } from "./RuffLinter";
import { stripCodeFences } from "../../utils/CodeTextUtils";

interface AutoFixOptions {
	filename?: string;
	stepTitle?: string;
}

interface AutoFixResult {
	fixedCode: string;
	issues: string[];
	warnings: string[];
	wasFixed: boolean;
	ruffSucceeded: boolean;
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

export async function autoFixWithRuffAndLLM(
	backendClient: BackendClient,
	code: string,
	options: AutoFixOptions = {},
	sessionId?: string
): Promise<AutoFixResult> {
	const filename = options.filename || `cell_${Date.now()}.py`;

	// Normalize and strip code fences first to avoid formatter parse errors
	const input = stripCodeFences(code);
	if (!input || !input.trim()) {
		return {
			fixedCode: code,
			issues: [],
			warnings: [],
			wasFixed: false,
			ruffSucceeded: true,
		};
	}

	// Single pass: Ruff lint + auto-fixes (no formatting) first
	let initial: RuffResult;
	try {
		// Skip formatting for speed; we primarily want fixes and diagnostics
		initial = await ruffLinter.lintCode(input, {
			enableFixes: true,
			filename,
			formatCode: false,
		});
	} catch (e) {
		// If Ruff fails entirely, skip slow LLM fallback to keep edits snappy
		return {
			fixedCode: input,
			issues: ["Ruff unavailable"],
			warnings: [],
			wasFixed: false,
			ruffSucceeded: false,
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
	const shouldFallback =
		!initial.isValid && isSmall && (hasSyntaxErrors || hasUndefined);

	if (!shouldFallback) {
		return {
			fixedCode: best,
			issues: initial.isValid ? [] : issues,
			warnings,
			wasFixed,
			ruffSucceeded: true,
		};
	}

	// Minimal LLM fallback (edit-mode-like): fix only listed diagnostics, keep code structure
	let llmFixed = await runMinimalLLMFallback(
		backendClient,
		best,
		filename,
		issues,
		warnings,
		options,
		sessionId
	);
	llmFixed = stripCodeFences(llmFixed);

	// Re-lint quickly to get updated diagnostics for UI
	try {
		const recheck = await ruffLinter.lintCode(llmFixed, {
			enableFixes: false,
			filename,
			formatCode: false,
		});
		const newIssues = formatDiagnostics(
			recheck.diagnostics.filter((d) => d.kind === "error")
		);
		const newWarnings = formatDiagnostics(
			recheck.diagnostics.filter((d) => d.kind === "warning")
		);
		return {
			fixedCode: llmFixed || best,
			issues: recheck.isValid ? [] : newIssues,
			warnings: newWarnings,
			wasFixed: (llmFixed || "") !== input,
			ruffSucceeded: true,
		};
	} catch (_) {
		// If recheck fails, return LLM-fixed code with original diagnostics
		return {
			fixedCode: llmFixed || best,
			issues,
			warnings,
			wasFixed: (llmFixed || "") !== input,
			ruffSucceeded: true,
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
		return {
			fixedCode: cleaned || input,
			issues: [],
			warnings: ["Ruff unavailable - used LLM-only validation"],
			wasFixed: cleaned !== input,
			ruffSucceeded: false,
		};
	} catch (e) {
		return {
			fixedCode: input,
			issues: [`Emergency fallback failed: ${e}`],
			warnings: ["Both Ruff and LLM validation failed"],
			wasFixed: false,
			ruffSucceeded: false,
		};
	}
}
