/**
 * Centralized array processing utilities
 */

export class ArrayUtils {
	/**
	 * Remove duplicates from array
	 */
	static unique<T>(array: T[]): T[] {
		return Array.from(new Set(array));
	}

	/**
	 * Remove duplicates by key function
	 */
	static uniqueBy<T, K>(array: T[], keyFn: (item: T) => K): T[] {
		const seen = new Set<K>();
		return array.filter(item => {
			const key = keyFn(item);
			if (seen.has(key)) {
				return false;
			}
			seen.add(key);
			return true;
		});
	}

	/**
	 * Group array items by key function
	 */
	static groupBy<T, K extends string | number>(
		array: T[],
		keyFn: (item: T) => K
	): Record<K, T[]> {
		return array.reduce((groups, item) => {
			const key = keyFn(item);
			if (!groups[key]) {
				groups[key] = [];
			}
			groups[key].push(item);
			return groups;
		}, {} as Record<K, T[]>);
	}

	/**
	 * Chunk array into smaller arrays
	 */
	static chunk<T>(array: T[], size: number): T[][] {
		const chunks: T[][] = [];
		for (let i = 0; i < array.length; i += size) {
			chunks.push(array.slice(i, i + size));
		}
		return chunks;
	}

	/**
	 * Filter out null/undefined values with type safety
	 */
	static compact<T>(array: (T | null | undefined)[]): T[] {
		return array.filter((item): item is T => item != null);
	}

	/**
	 * Find first non-null/undefined value
	 */
	static findValid<T>(array: (T | null | undefined)[]): T | undefined {
		return array.find((item): item is T => item != null);
	}

	/**
	 * Check if array is empty or contains only null/undefined
	 */
	static isEmpty<T>(array: (T | null | undefined)[]): boolean {
		return array.length === 0 || array.every(item => item == null);
	}

	/**
	 * Safely get array item at index
	 */
	static safeGet<T>(array: T[], index: number): T | undefined {
		return index >= 0 && index < array.length ? array[index] : undefined;
	}

	/**
	 * Partition array into two arrays based on predicate
	 */
	static partition<T>(
		array: T[],
		predicate: (item: T) => boolean
	): [T[], T[]] {
		const trueItems: T[] = [];
		const falseItems: T[] = [];
		
		array.forEach(item => {
			if (predicate(item)) {
				trueItems.push(item);
			} else {
				falseItems.push(item);
			}
		});
		
		return [trueItems, falseItems];
	}

	/**
	 * Flatten array of arrays
	 */
	static flatten<T>(arrays: T[][]): T[] {
		return arrays.reduce((flat, arr) => flat.concat(arr), []);
	}
}