/**
 * Centralized validation utilities
 */

export class ValidationUtils {
	/**
	 * Check if string is not empty after trimming
	 */
	static isNonEmptyString(value: unknown): value is string {
		return typeof value === 'string' && value.trim().length > 0;
	}

	/**
	 * Check if array is not empty
	 */
	static isNonEmptyArray<T>(value: unknown): value is T[] {
		return Array.isArray(value) && value.length > 0;
	}

	/**
	 * Check if object is not null/undefined and has properties
	 */
	static isValidObject(value: unknown): value is Record<string, any> {
		return value != null && typeof value === 'object' && !Array.isArray(value);
	}

	/**
	 * Check if number is valid and finite
	 */
	static isValidNumber(value: unknown): value is number {
		return typeof value === 'number' && !isNaN(value) && isFinite(value);
	}

	/**
	 * Check if value is a valid positive integer
	 */
	static isPositiveInteger(value: unknown): value is number {
		return ValidationUtils.isValidNumber(value) && value > 0 && Number.isInteger(value);
	}

	/**
	 * Sanitize string by trimming and removing extra whitespace
	 */
	static sanitizeString(value: string): string {
		return value.trim().replace(/\s+/g, ' ');
	}

	/**
	 * Validate file extension
	 */
	static hasValidExtension(filename: string, validExtensions: string[]): boolean {
		const extension = filename.toLowerCase().split('.').pop();
		return extension ? validExtensions.includes(extension) : false;
	}

	/**
	 * Check if URL is valid
	 */
	static isValidUrl(value: string): boolean {
		try {
			new URL(value);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Check if email is valid (basic check)
	 */
	static isValidEmail(value: string): boolean {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		return emailRegex.test(value);
	}

	/**
	 * Validate object has required properties
	 */
	static hasRequiredProperties<T extends Record<string, any>>(
		obj: unknown,
		requiredProps: (keyof T)[]
	): obj is T {
		if (!ValidationUtils.isValidObject(obj)) {
			return false;
		}
		
		return requiredProps.every(prop => 
			obj.hasOwnProperty(prop as string) && obj[prop as string] != null
		);
	}

	/**
	 * Clamp number to range
	 */
	static clamp(value: number, min: number, max: number): number {
		return Math.min(Math.max(value, min), max);
	}

	/**
	 * Get safe property from object
	 */
	static safeGet<T>(
		obj: Record<string, any> | null | undefined,
		key: string,
		defaultValue: T
	): T {
		return (obj && obj[key] !== undefined) ? obj[key] : defaultValue;
	}
}