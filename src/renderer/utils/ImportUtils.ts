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
	const seenImports = new Set<string>();

	// First pass: collect all existing imports to avoid duplicates within the same code block
	for (const existing of existingImports) {
		seenImports.add(existing);
	}

	for (const line of lines) {
		const trimmedLine = line.trim();
		const isImportLine = trimmedLine.startsWith("import ") || trimmedLine.startsWith("from ");
		
		if (isImportLine) {
			// Only remove if it's a top-level import (not indented) and we've seen it before
			const isTopLevel = line.startsWith("import ") || line.startsWith("from ");
			
			if (isTopLevel && seenImports.has(trimmedLine)) {
				// Skip this duplicate import
				continue;
			} else {
				// Keep this import and add it to our seen set
				filteredLines.push(line);
				seenImports.add(trimmedLine);
			}
		} else {
			// Keep all non-import lines
			filteredLines.push(line);
		}
	}

	return filteredLines.join("\n");
}
