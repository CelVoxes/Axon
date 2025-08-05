/**
 * Centralized string processing utilities
 */

export class StringUtils {
	/**
	 * Create safe filename from string
	 */
	static toSafeFilename(input: string): string {
		return input
			.toLowerCase()
			.replace(/[^a-z0-9_-]/g, '_')
			.replace(/_+/g, '_')
			.replace(/^_|_$/g, '');
	}

	/**
	 * Truncate string with ellipsis
	 */
	static truncate(str: string, maxLength: number, suffix: string = '...'): string {
		if (str.length <= maxLength) return str;
		return str.slice(0, maxLength - suffix.length) + suffix;
	}

	/**
	 * Capitalize first letter
	 */
	static capitalize(str: string): string {
		return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
	}

	/**
	 * Convert to title case
	 */
	static toTitleCase(str: string): string {
		return str.split(' ')
			.map(word => StringUtils.capitalize(word))
			.join(' ');
	}

	/**
	 * Convert camelCase to kebab-case
	 */
	static camelToKebab(str: string): string {
		return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
	}

	/**
	 * Convert kebab-case to camelCase
	 */
	static kebabToCamel(str: string): string {
		return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
	}

	/**
	 * Remove extra whitespace
	 */
	static normalizeWhitespace(str: string): string {
		return str.trim().replace(/\s+/g, ' ');
	}

	/**
	 * Extract numbers from string
	 */
	static extractNumbers(str: string): number[] {
		const matches = str.match(/\d+/g);
		return matches ? matches.map(Number) : [];
	}

	/**
	 * Count occurrences of substring
	 */
	static countOccurrences(str: string, search: string): number {
		return (str.match(new RegExp(search, 'g')) || []).length;
	}

	/**
	 * Check if string contains any of the given patterns
	 */
	static containsAny(str: string, patterns: string[]): boolean {
		const lowerStr = str.toLowerCase();
		return patterns.some(pattern => lowerStr.includes(pattern.toLowerCase()));
	}

	/**
	 * Replace multiple patterns at once
	 */
	static replaceMultiple(str: string, replacements: Record<string, string>): string {
		let result = str;
		Object.entries(replacements).forEach(([search, replace]) => {
			result = result.replace(new RegExp(search, 'g'), replace);
		});
		return result;
	}

	/**
	 * Generate random string
	 */
	static random(length: number = 8): string {
		const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
		let result = '';
		for (let i = 0; i < length; i++) {
			result += chars.charAt(Math.floor(Math.random() * chars.length));
		}
		return result;
	}

	/**
	 * Format bytes to human readable string
	 */
	static formatBytes(bytes: number, decimals: number = 2): string {
		if (bytes === 0) return '0 Bytes';
		
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		
		return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
	}

	/**
	 * Parse comma-separated values
	 */
	static parseCSV(str: string): string[] {
		return str.split(',').map(item => item.trim()).filter(Boolean);
	}

	/**
	 * Join with proper grammar (e.g., "A, B, and C")
	 */
	static joinWithAnd(items: string[]): string {
		if (items.length === 0) return '';
		if (items.length === 1) return items[0];
		if (items.length === 2) return items.join(' and ');
		
		const last = items[items.length - 1];
		const rest = items.slice(0, -1);
		return rest.join(', ') + ', and ' + last;
	}
}