import { RuffResult } from "../services/RuffLinter";

function formatRange(startLine: number, endLine: number): string {
  return endLine && endLine !== startLine ? `${startLine}-${endLine}` : String(startLine);
}

export function diagnosticsToErrors(ruffResult: RuffResult): string[] {
  try {
    return (ruffResult?.diagnostics || [])
      .filter((d) => d && d.kind === "error")
      .map((d) => `${d.code}: ${d.message} (line ${formatRange(d.startLine, d.endLine)})`);
  } catch (_) {
    return [];
  }
}

export function diagnosticsToWarnings(ruffResult: RuffResult): string[] {
  try {
    return (ruffResult?.diagnostics || [])
      .filter((d) => d && d.kind === "warning")
      .map((d) => `${d.code}: ${d.message} (line ${formatRange(d.startLine, d.endLine)})`);
  } catch (_) {
    return [];
  }
}

export function diagnosticsToIssueStrings(ruffResult: RuffResult): string[] {
  // Backwards-compatible: error-only issues list for auto-fix prompts
  return diagnosticsToErrors(ruffResult);
}

