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
    options: AutoFixOptions = {},
    sessionId?: string
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
		return await fallbackToLLMOnly(backendClient, input, options, sessionId);
    }

	// Extract issues and warnings from Ruff results
	const issues = formatDiagnostics(initial.diagnostics.filter(d => d.kind === 'error'));
	const warnings = formatDiagnostics(initial.diagnostics.filter(d => d.kind === 'warning'));
	
	// Use Ruff's best output (fixed > formatted > original)
	const best = initial.fixedCode || initial.formattedCode || input;
	const wasFixed = best !== input;
	
	// Always prefer Ruff output first, even with errors
	// Only use LLM for syntax errors that completely break the code
	const hasSyntaxErrors = issues.some(issue => 
		issue.includes('E999:') || // Syntax error
		issue.includes('SyntaxError') // Python syntax errors
	);
	
	// Only use LLM for syntax errors that make code completely unusable
	if (hasSyntaxErrors && !initial.formattedCode && !initial.fixedCode) {
		try {
			let llmFixed = "";
            await backendClient.generateCodeStream(
                {
                    task_description:
                        `Fix only syntax errors in Python code. Return ONLY corrected code with minimal changes.\n\n` +
                        `Syntax Errors:\n${issues.filter(i => i.includes('E999:') || i.includes('SyntaxError')).join("\n")}\n\n` +
                        `Code:\n${input}\n`,
                    language: "python",
                    context: options.stepTitle || "Syntax error fixing",
                    ...(sessionId ? { session_id: sessionId } : {}),
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
            context: options.stepTitle || "Emergency code fixing (Ruff unavailable)",
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
