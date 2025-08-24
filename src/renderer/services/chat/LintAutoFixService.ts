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
	return diagnostics.map(d => 
		`${d.code}: ${d.message} (line ${d.endLine && d.endLine !== d.startLine ? `${d.startLine}-${d.endLine}` : d.startLine})`
	);
}

export async function autoFixWithRuffAndLLM(
	backendClient: BackendClient,
	code: string,
	options: AutoFixOptions = {}
): Promise<AutoFixResult> {
	console.log(`LintAutoFixService: autoFixWithRuffAndLLM started for: ${options.filename}, code length: ${code.length}`);
	const filename = options.filename || `cell_${Date.now()}.py`;

	// Normalize and strip code fences first to avoid formatter parse errors
	const input = stripCodeFences(code);
	if (!input || !input.trim()) {
		return { fixedCode: code, issues: [], warnings: [], wasFixed: false, ruffSucceeded: true };
	}

	// First pass: Ruff lint + auto-fixes/formatting
	let initial: RuffResult;
	try {
		console.log('LintAutoFixService: Starting Ruff linting for:', filename);
		initial = await ruffLinter.lintCode(input, { enableFixes: true, filename });
		console.log('LintAutoFixService: Ruff linting completed for:', filename, 'isValid:', initial.isValid);
	} catch (e) {
		console.warn("LintAutoFixService: Ruff WebAssembly failed, falling back to LLM", e);
		// If Ruff fails entirely, use LLM as emergency fallback
		return await fallbackToLLMOnly(backendClient, input, options);
	}

	// Extract issues and warnings from Ruff results
	const issues = formatDiagnostics(initial.diagnostics.filter(d => d.kind === 'error'));
	const warnings = formatDiagnostics(initial.diagnostics.filter(d => d.kind === 'warning'));
	
	// If clean, prefer Ruff's fixed/formatted output
	if (initial.isValid) {
		const best = initial.fixedCode || initial.formattedCode || input;
		console.log('LintAutoFixService: Returning clean result for:', filename);
		// Detect changes relative to normalized input
		return { fixedCode: best, issues: [], warnings, wasFixed: best !== input, ruffSucceeded: true };
	}

	// Prepare prompt to backend LLM to correct code
	let llmFixed = "";
	try {
		await backendClient.generateCodeStream(
			{
				task_description:
					`Fix the following Python code validation errors. Return ONLY the corrected code, no explanations.\n\n` +
					`Errors:\n${issues.join("\n")}\n\n` +
					`Code:\n${input}\n`,
				language: "python",
				context: options.stepTitle || "Code validation error fixing",
			},
			(chunk: string) => {
				llmFixed += chunk;
			}
		);
	} catch (e) {
		// If backend correction fails, fall back to Ruff's fixed/format attempt
		const best = initial.fixedCode || initial.formattedCode || input;
		return { fixedCode: best, issues, warnings, wasFixed: best !== input, ruffSucceeded: true };
	}

	const cleaned = stripCodeFences(llmFixed);

	// Re-run Ruff on LLM-corrected code
	try {
		const recheck = await ruffLinter.lintCode(cleaned, {
			enableFixes: true,
			filename: filename.replace(/\.py$/, "_fixed.py"),
		});

		if (recheck.isValid) {
			const best = recheck.fixedCode || recheck.formattedCode || cleaned;
			const recheckWarnings = formatDiagnostics(recheck.diagnostics.filter(d => d.kind === 'warning'));
			console.log(`🔧 LLM fix successful: ${recheckWarnings.length} warnings remain`);
			return { fixedCode: best, issues: [], warnings: recheckWarnings, wasFixed: true, ruffSucceeded: true };
		}

		// Not fully valid; pick the better of Ruff's own fix vs LLM attempt
		const fallback = recheck.fixedCode || recheck.formattedCode || cleaned;
		const initialBest = initial.fixedCode || initial.formattedCode || input;
		// Prefer the variant that changed from the normalized input (heuristic)
		const chosen = fallback !== input ? fallback : initialBest;
		const recheckIssues = formatDiagnostics(recheck.diagnostics.filter(d => d.kind === 'error'));
		const recheckWarnings = formatDiagnostics(recheck.diagnostics.filter(d => d.kind === 'warning'));
		console.log(`⚠️ LLM fix incomplete: ${recheckIssues.length} errors, ${recheckWarnings.length} warnings remain`);
		console.log('LintAutoFixService: autoFixWithRuffAndLLM returning incomplete fix for:', options.filename);
		return {
			fixedCode: chosen,
			issues: recheckIssues,
			warnings: recheckWarnings,
			wasFixed: chosen !== input,
			ruffSucceeded: true,
		};
	} catch (_) {
		// On re-lint failure, at least return the LLM's cleaned output
		const best = cleaned || initial.fixedCode || initial.formattedCode || input;
		return { fixedCode: best, issues, warnings, wasFixed: best !== input, ruffSucceeded: false };
	}
}

// Emergency fallback when Ruff WebAssembly completely fails
async function fallbackToLLMOnly(
	backendClient: BackendClient,
	input: string,
	options: AutoFixOptions
): Promise<AutoFixResult> {
	try {
		let llmFixed = "";
		await backendClient.generateCodeStream(
			{
				task_description:
					`Fix and improve the following Python code. Focus on syntax errors, import issues, and basic best practices. Return ONLY the corrected code, no explanations.\n\n` +
					`Code:\n${input}\n`,
				language: "python",
				context: options.stepTitle || "Emergency code fixing (Ruff unavailable)",
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
			ruffSucceeded: false 
		};
	} catch (e) {
		return { 
			fixedCode: input, 
			issues: [`Emergency fallback failed: ${e}`], 
			warnings: ["Both Ruff and LLM validation failed"],
			wasFixed: false, 
			ruffSucceeded: false 
		};
	}
}
