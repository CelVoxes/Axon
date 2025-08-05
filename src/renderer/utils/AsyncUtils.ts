/**
 * Centralized async utilities and timer helpers
 */

export class AsyncUtils {
	/**
	 * Sleep for specified milliseconds
	 */
	static sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * Sleep with exponential backoff for retries
	 */
	static sleepWithBackoff(retryCount: number, baseMs: number = 1000): Promise<void> {
		return AsyncUtils.sleep(baseMs * retryCount);
	}

	/**
	 * Retry operation with exponential backoff
	 */
	static async retry<T>(
		operation: () => Promise<T>,
		maxRetries: number = 3,
		baseDelayMs: number = 1000
	): Promise<T> {
		let lastError: Error;
		
		for (let attempt = 0; attempt < maxRetries; attempt++) {
			try {
				return await operation();
			} catch (error) {
				lastError = error as Error;
				if (attempt === maxRetries - 1) {
					throw lastError;
				}
				await AsyncUtils.sleepWithBackoff(attempt + 1, baseDelayMs);
			}
		}
		
		throw lastError!;
	}

	/**
	 * Set temporary state (like copied indicators)
	 */
	static setTemporaryState<T>(
		setter: (value: T) => void,
		temporaryValue: T,
		originalValue: T,
		durationMs: number = 2000
	): void {
		setter(temporaryValue);
		setTimeout(() => setter(originalValue), durationMs);
	}

	/**
	 * Debounce function calls
	 */
	static debounce<T extends (...args: any[]) => any>(
		func: T,
		delayMs: number
	): (...args: Parameters<T>) => void {
		let timeoutId: NodeJS.Timeout;
		return (...args: Parameters<T>) => {
			clearTimeout(timeoutId);
			timeoutId = setTimeout(() => func(...args), delayMs);
		};
	}

	/**
	 * Throttle function calls
	 */
	static throttle<T extends (...args: any[]) => any>(
		func: T,
		delayMs: number
	): (...args: Parameters<T>) => void {
		let lastCall = 0;
		return (...args: Parameters<T>) => {
			const now = Date.now();
			if (now - lastCall >= delayMs) {
				lastCall = now;
				func(...args);
			}
		};
	}
}