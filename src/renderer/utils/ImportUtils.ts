/**
 * Import utilities shared by code generation and quality services
 */

/**
 * Extract imports from a code string
 */
export function extractImports(code: string): Set<string> {
	const imports = new Set<string>();
	const lines = code.split("\n");

	for (const line of lines) {
		const trimmedLine = line.trim();
		if (
			trimmedLine.startsWith("import ") ||
			trimmedLine.startsWith("from ") ||
			/^import\s+\w+/.test(trimmedLine)
		) {
			imports.add(trimmedLine);
		}
	}

	return imports;
}

/**
 * Get all imports from a global code context string
 */
export function getExistingImports(globalCodeContext?: string): Set<string> {
	const allImports = new Set<string>();
	if (globalCodeContext) {
		const imports = extractImports(globalCodeContext);
		imports.forEach((imp) => allImports.add(imp));
	}
	return allImports;
}

/**
 * Remove duplicate imports from a code string based on an existing imports set
 */
export function removeDuplicateImports(
	code: string,
	existingImports: Set<string>
): string {
	const lines = code.split("\n");
	const filteredLines: string[] = [];

	for (const line of lines) {
		const trimmedLine = line.trim();
		if (
			trimmedLine.startsWith("import ") ||
			trimmedLine.startsWith("from ") ||
			/^import\s+\w+/.test(trimmedLine)
		) {
			if (!existingImports.has(trimmedLine)) {
				filteredLines.push(line);
				existingImports.add(trimmedLine);
			}
		} else {
			filteredLines.push(line);
		}
	}

	return filteredLines.join("\n");
}
