import { BackendClient } from "./BackendClient";
import { ruffLinter, RuffResult } from "./RuffLinter";
import { stripCodeFences } from "../utils/CodeTextUtils";
import { diagnosticsToIssueStrings } from "../utils/RuffUtils";

interface AutoFixOptions {
  filename?: string;
  stepTitle?: string;
}

interface AutoFixResult {
  fixedCode: string;
  issues: string[];
  wasFixed: boolean;
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
    return { fixedCode: code, issues: [], wasFixed: false };
  }

  // First pass: Ruff lint + auto-fixes/formatting
  let initial: RuffResult;
  try {
    initial = await ruffLinter.lintCode(input, { enableFixes: true, filename });
  } catch (e) {
    // If Ruff fails entirely, fall back to original code
    return { fixedCode: input, issues: [String(e)], wasFixed: false };
  }

  // If clean, prefer Ruff's fixed/formatted output
  if (initial.isValid) {
    const best = initial.fixedCode || initial.formattedCode || input;
    return { fixedCode: best, issues: [], wasFixed: best !== code };
  }

  const issues = diagnosticsToIssueStrings(initial);

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
    return { fixedCode: best, issues, wasFixed: best !== code };
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
      return { fixedCode: best, issues: [], wasFixed: true };
    }

    // Not fully valid; pick the better of Ruff's own fix vs LLM attempt
    const fallback = recheck.fixedCode || recheck.formattedCode || cleaned;
    const initialBest = initial.fixedCode || initial.formattedCode || input;
    // Prefer the variant that changed from original (heuristic)
    const chosen = fallback !== code ? fallback : initialBest;
    return { fixedCode: chosen, issues: diagnosticsToIssueStrings(recheck), wasFixed: chosen !== code };
  } catch (_) {
    // On re-lint failure, at least return the LLM's cleaned output
    const best = cleaned || initial.fixedCode || initial.formattedCode || input;
    return { fixedCode: best, issues, wasFixed: best !== code };
  }
}
