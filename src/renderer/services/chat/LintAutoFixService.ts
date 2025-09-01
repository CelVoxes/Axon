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
	const filename = options.filename || `cell_${Date.now()}.py`;

	// Normalize and strip code fences first to avoid formatter parse errors
	const input = stripCodeFences(code);
	if (!input || !input.trim()) {
		return { fixedCode: code, issues: [], warnings: [], wasFixed: false, ruffSucceeded: true };
	}

	// Single pass: Ruff lint + auto-fixes/formatting only
	let initial: RuffResult;
	try {
		initial = await ruffLinter.lintCode(input, { enableFixes: true, filename });
	} catch (e) {
		// If Ruff fails entirely, use LLM as emergency fallback
		return await fallbackToLLMOnly(backendClient, input, options);
	}

	// Extract issues and warnings from Ruff results
	const issues = formatDiagnostics(initial.diagnostics.filter(d => d.kind === 'error'));
	const warnings = formatDiagnostics(initial.diagnostics.filter(d => d.kind === 'warning'));
	
	// Use Ruff's best output (fixed > formatted > original)
	const best = initial.fixedCode || initial.formattedCode || input;
	const wasFixed = best !== input;
	
	// Skip expensive LLM double-checking unless there are critical errors
	const hasCriticalErrors = issues.some(issue => 
		issue.includes('F821:') || // Undefined name
		issue.includes('E999:') || // Syntax error
		issue.includes('F401:')    // Unused import (less critical)
	);
	
	// Only use LLM for critical errors that Ruff couldn't fix
	if (hasCriticalErrors && !initial.isValid) {
		try {
			let llmFixed = "";
			await backendClient.generateCodeStream(
				{
					task_description:
						`Fix critical Python errors. Return ONLY corrected code.\n\n` +
						`Errors:\n${issues.join("\n")}\n\n` +
						`Code:\n${input}\n`,
					language: "python",
					context: options.stepTitle || "Critical error fixing",
				},
				(chunk: string) => {
					llmFixed += chunk;
				}
			);
			
			const cleaned = stripCodeFences(llmFixed);
			if (cleaned && cleaned.trim()) {
				return { fixedCode: cleaned, issues: [], warnings, wasFixed: true, ruffSucceeded: true };
			}
		} catch (e) {
			// Fall through to Ruff result
		}
	}
	
	return { 
		fixedCode: best, 
		issues: initial.isValid ? [] : issues, 
		warnings, 
		wasFixed, 
		ruffSucceeded: true 
	};
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
