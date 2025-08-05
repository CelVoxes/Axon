/**
 * Centralized date/time utilities
 */

export class DateUtils {
	/**
	 * Get current timestamp in milliseconds
	 */
	static now(): number {
		return Date.now();
	}

	/**
	 * Create timestamp for unique IDs
	 */
	static createTimestamp(): string {
		return Date.now().toString();
	}

	/**
	 * Format timestamp for display
	 */
	static formatTimestamp(timestamp: number | Date, options?: Intl.DateTimeFormatOptions): string {
		const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
		
		const defaultOptions: Intl.DateTimeFormatOptions = {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		};
		
		return date.toLocaleTimeString(undefined, { ...defaultOptions, ...options });
	}

	/**
	 * Format date for display
	 */
	static formatDate(timestamp: number | Date, options?: Intl.DateTimeFormatOptions): string {
		const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
		
		const defaultOptions: Intl.DateTimeFormatOptions = {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		};
		
		return date.toLocaleDateString(undefined, { ...defaultOptions, ...options });
	}

	/**
	 * Format full date and time
	 */
	static formatDateTime(timestamp: number | Date): string {
		return `${DateUtils.formatDate(timestamp)} ${DateUtils.formatTimestamp(timestamp)}`;
	}

	/**
	 * Get relative time string (e.g., "2 minutes ago")
	 */
	static getRelativeTime(timestamp: number | Date): string {
		const now = Date.now();
		const time = timestamp instanceof Date ? timestamp.getTime() : timestamp;
		const diffMs = now - time;
		
		const seconds = Math.floor(diffMs / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);
		
		if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
		if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
		if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
		if (seconds > 10) return `${seconds} seconds ago`;
		return 'just now';
	}

	/**
	 * Create safe filename timestamp
	 */
	static createFilenameTimestamp(): string {
		const now = new Date();
		return now.toISOString()
			.replace(/[:.]/g, '-')
			.replace('T', '_')
			.slice(0, -5); // Remove milliseconds and Z
	}

	/**
	 * Check if timestamp is within last N milliseconds
	 */
	static isRecent(timestamp: number | Date, withinMs: number): boolean {
		const now = Date.now();
		const time = timestamp instanceof Date ? timestamp.getTime() : timestamp;
		return (now - time) <= withinMs;
	}

	/**
	 * Add time to timestamp
	 */
	static addTime(timestamp: number | Date, ms: number): Date {
		const time = timestamp instanceof Date ? timestamp.getTime() : timestamp;
		return new Date(time + ms);
	}

	/**
	 * Common time constants
	 */
	static readonly TIME = {
		SECOND: 1000,
		MINUTE: 60 * 1000,
		HOUR: 60 * 60 * 1000,
		DAY: 24 * 60 * 60 * 1000,
		WEEK: 7 * 24 * 60 * 60 * 1000,
	} as const;
}