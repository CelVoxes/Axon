// Shared utilities for working with Python code text

export function stripCodeFences(text: string, preserveWhitespace: boolean = false): string {
	if (!text) return "";
	let s = String(text).replace(/^\ufeff/, "");

	// If the entire content is wrapped in a single top/bottom code fence, remove those fences only.
	const startsWithFence = /^\s*```[a-zA-Z]*\s*\n?/.exec(s);
	const endsWithFence = /\n?```\s*$/.exec(s);
	if (startsWithFence && endsWithFence) {
		s = s.replace(/^\s*```[a-zA-Z]*\s*\n?/, "");
		s = s.replace(/\n?```\s*$/, "");
	} else {
		// Otherwise, drop stray inline fences but avoid trimming surrounding whitespace
		s = s.replace(/```\s*python\s*/gi, "").replace(/```/g, "");
	}

	return preserveWhitespace ? s : s.trim();
}

export function normalizePythonCode(rawCode: string): string {
	if (!rawCode) return "";
	let code = String(rawCode);
	// Normalize newlines and strip BOM/zero-width no-break spaces
	code = code
		.replace(/\r\n/g, "\n")
		.replace(/^\ufeff/, "")
		.replace(/[\u200B\u200C\u200D\uFEFF]/g, "");
	// Remove surrounding markdown code fences if present
	code = stripCodeFences(code, /* preserveWhitespace */ true);

	const lines = code.split("\n");
	// Convert leading tabs to 4 spaces to avoid mixed-indentation errors
	for (let i = 0; i < lines.length; i++) {
		lines[i] = lines[i].replace(/^\t+/, (m) => " ".repeat(4 * m.length));
	}
	const nonEmpty = lines.filter((l) => l.trim().length > 0);
	if (nonEmpty.length === 0) return code;
	const anyAtCol0 = nonEmpty.some((l) => !/^\s/.test(l));
	if (!anyAtCol0) {
		// Compute common leading whitespace prefix across all non-empty lines
		const leading = nonEmpty.map((l) => l.match(/^[\t ]*/)?.[0] ?? "");
		let common = leading[0] || "";
		for (let i = 1; i < leading.length && common.length > 0; i++) {
			const s = leading[i];
			let j = 0;
			const max = Math.min(common.length, s.length);
			while (j < max && common[j] === s[j]) j++;
			common = common.slice(0, j);
		}
		if (common) {
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (line.startsWith(common)) lines[i] = line.slice(common.length);
			}
			code = lines.join("\n");
		}
	}

	return code.trimEnd();
}

export function extractPythonCode(response: string): string | null {
	const codeBlockRegex = /```(?:python)?\s*([\s\S]*?)```/;
	const match = response.match(codeBlockRegex);
	if (match) {
		return match[1].trim();
	}
	const lines = response.split("\n");
	const codeIndicators = [
		"import ",
		"def ",
		"class ",
		"print(",
		"pd.",
		"np.",
		"plt.",
	];
	const hasCodeIndicators = codeIndicators.some((indicator) =>
		lines.some((line) => line.trim().startsWith(indicator))
	);
	if (hasCodeIndicators) {
		return response.trim();
	}
	return null;
}

/**
 * Ensure that code intended for display has real newlines. Some provider streams
 * may deliver escaped sequences like "\\n". To avoid breaking legitimate string
 * literals, we only expand when the text has no real newlines at all.
 */
export function ensureDisplayNewlines(text: string): string {
	if (text == null) return "";
	let s = String(text);
	// Normalize Windows newlines first
	s = s.replace(/\r\n/g, "\n");
	if (s.indexOf("\n") >= 0) return s;
	// Expand escaped newline sequences if no real newlines are present
	// Matches one or more backslashes followed by optional 'r' and 'n'
	// e.g., "\n", "\\n", "\r\n", "\\r\\n"
	s = s.replace(/\\+(?:r)?n/g, "\n");
	return s;
}
