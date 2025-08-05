/**
 * Performance monitoring and optimization utilities
 */

export class PerformanceUtils {
	private static timers: Map<string, number> = new Map();
	private static measurements: Map<string, number[]> = new Map();
	
	/**
	 * Start timing an operation
	 */
	static startTimer(label: string): void {
		PerformanceUtils.timers.set(label, performance.now());
	}
	
	/**
	 * End timing and return duration
	 */
	static endTimer(label: string): number {
		const startTime = PerformanceUtils.timers.get(label);
		if (!startTime) {
			console.warn(`Timer "${label}" was not started`);
			return 0;
		}
		
		const duration = performance.now() - startTime;
		PerformanceUtils.timers.delete(label);
		
		// Store measurement for analysis
		if (!PerformanceUtils.measurements.has(label)) {
			PerformanceUtils.measurements.set(label, []);
		}
		PerformanceUtils.measurements.get(label)!.push(duration);
		
		return duration;
	}
	
	/**
	 * Measure function execution time
	 */
	static measure<T>(label: string, fn: () => T): T {
		PerformanceUtils.startTimer(label);
		const result = fn();
		const duration = PerformanceUtils.endTimer(label);
		console.log(`${label}: ${duration.toFixed(2)}ms`);
		return result;
	}
	
	/**
	 * Measure async function execution time
	 */
	static async measureAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
		PerformanceUtils.startTimer(label);
		const result = await fn();
		const duration = PerformanceUtils.endTimer(label);
		console.log(`${label}: ${duration.toFixed(2)}ms`);
		return result;
	}
	
	/**
	 * Get performance statistics for a label
	 */
	static getStats(label: string): {
		count: number;
		min: number;
		max: number;
		avg: number;
		total: number;
	} | null {
		const measurements = PerformanceUtils.measurements.get(label);
		if (!measurements || measurements.length === 0) {
			return null;
		}
		
		const min = Math.min(...measurements);
		const max = Math.max(...measurements);
		const total = measurements.reduce((sum, val) => sum + val, 0);
		const avg = total / measurements.length;
		
		return {
			count: measurements.length,
			min,
			max,
			avg,
			total,
		};
	}
	
	/**
	 * Clear all measurements
	 */
	static clearStats(): void {
		PerformanceUtils.measurements.clear();
	}
	
	/**
	 * Print all performance statistics
	 */
	static printStats(): void {
		console.group('Performance Statistics');
		for (const [label] of PerformanceUtils.measurements) {
			const stats = PerformanceUtils.getStats(label);
			if (stats) {
				console.log(`${label}:`, {
					calls: stats.count,
					min: `${stats.min.toFixed(2)}ms`,
					max: `${stats.max.toFixed(2)}ms`,
					avg: `${stats.avg.toFixed(2)}ms`,
					total: `${stats.total.toFixed(2)}ms`,
				});
			}
		}
		console.groupEnd();
	}
	
	/**
	 * Debounce function calls for performance
	 */
	static debounce<T extends (...args: any[]) => any>(
		func: T,
		delay: number
	): (...args: Parameters<T>) => void {
		let timeoutId: NodeJS.Timeout;
		return (...args: Parameters<T>) => {
			clearTimeout(timeoutId);
			timeoutId = setTimeout(() => func(...args), delay);
		};
	}
	
	/**
	 * Throttle function calls for performance
	 */
	static throttle<T extends (...args: any[]) => any>(
		func: T,
		delay: number
	): (...args: Parameters<T>) => void {
		let lastCall = 0;
		return (...args: Parameters<T>) => {
			const now = Date.now();
			if (now - lastCall >= delay) {
				lastCall = now;
				func(...args);
			}
		};
	}
	
	/**
	 * Memoize function results for performance
	 */
	static memoize<T extends (...args: any[]) => any>(func: T): T {
		const cache = new Map();
		return ((...args: Parameters<T>) => {
			const key = JSON.stringify(args);
			if (cache.has(key)) {
				return cache.get(key);
			}
			const result = func(...args);
			cache.set(key, result);
			return result;
		}) as T;
	}
	
	/**
	 * Batch operations for better performance
	 */
	static batch<T>(
		items: T[],
		batchSize: number,
		processor: (batch: T[]) => Promise<void>,
		delay: number = 0
	): Promise<void> {
		return new Promise(async (resolve, reject) => {
			try {
				for (let i = 0; i < items.length; i += batchSize) {
					const batch = items.slice(i, i + batchSize);
					await processor(batch);
					
					if (delay > 0 && i + batchSize < items.length) {
						await new Promise(resolve => setTimeout(resolve, delay));
					}
				}
				resolve();
			} catch (error) {
				reject(error);
			}
		});
	}
	
	/**
	 * Memory usage monitoring
	 */
	static getMemoryUsage(): {
		used: string;
		total: string;
		percentage: string;
	} {
		if ('memory' in performance) {
			const memory = (performance as any).memory;
			const used = (memory.usedJSHeapSize / 1024 / 1024).toFixed(2);
			const total = (memory.totalJSHeapSize / 1024 / 1024).toFixed(2);
			const percentage = ((memory.usedJSHeapSize / memory.totalJSHeapSize) * 100).toFixed(1);
			
			return {
				used: `${used} MB`,
				total: `${total} MB`,
				percentage: `${percentage}%`,
			};
		}
		
		return {
			used: 'N/A',
			total: 'N/A',
			percentage: 'N/A',
		};
	}
}