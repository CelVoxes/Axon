export const INDENTATION_RULE_PREFIXES = ["E11", "E12", "E13", "E14"];

export interface DiagnosticLike {
	code?: string;
	message?: string;
}

export function isIndentationDiagnostic(
	diagnostic: DiagnosticLike | undefined
): boolean {
	if (!diagnostic) {
		return false;
	}
	const code = diagnostic.code || "";
	if (INDENTATION_RULE_PREFIXES.some((prefix) => code.startsWith(prefix))) {
		return true;
	}
	const message = diagnostic.message || "";
	return /indent/i.test(message);
}

