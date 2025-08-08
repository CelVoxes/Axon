import { GEODataset } from "../types/DatasetTypes";
import { ArrayUtils } from "./ArrayUtils";

export function deduplicateDatasets(datasets: GEODataset[]): GEODataset[] {
	return ArrayUtils.uniqueBy(datasets, (d) => d.id);
}

export function prioritizeSearchTerms(
	terms: string[],
	originalQuery: string
): string[] {
	const originalLower = originalQuery.toLowerCase();
	return [...terms].sort((a, b) => {
		const aInOriginal = originalLower.includes(a.toLowerCase());
		const bInOriginal = originalLower.includes(b.toLowerCase());

		if (aInOriginal && !bInOriginal) return -1;
		if (!aInOriginal && bInOriginal) return 1;

		// If both or neither are in original, prefer shorter terms (more specific)
		return a.length - b.length;
	});
}
