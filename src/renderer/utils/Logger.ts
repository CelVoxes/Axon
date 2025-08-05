/**
 * Centralized logging utility
 */

export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3,
}

export class Logger {
	private static logLevel: LogLevel = LogLevel.INFO;
	private static enabledContexts: Set<string> = new Set();
	
	/**
	 * Set global log level
	 */
	static setLogLevel(level: LogLevel): void {
		Logger.logLevel = level;
	}
	
	/**
	 * Enable logging for specific contexts
	 */
	static enableContext(...contexts: string[]): void {
		contexts.forEach(context => Logger.enabledContexts.add(context));
	}
	
	/**
	 * Disable logging for specific contexts
	 */
	static disableContext(...contexts: string[]): void {
		contexts.forEach(context => Logger.enabledContexts.delete(context));
	}
	
	/**
	 * Check if context is enabled
	 */
	private static isContextEnabled(context: string): boolean {
		return Logger.enabledContexts.size === 0 || Logger.enabledContexts.has(context);
	}
	
	/**
	 * Format log message with timestamp and context
	 */
	private static formatMessage(level: string, context: string, message: string): string {
		const timestamp = new Date().toISOString().slice(11, 23); // HH:mm:ss.sss
		return `[${timestamp}] ${level.toUpperCase().padEnd(5)} [${context}] ${message}`;
	}
	
	/**
	 * Debug logging
	 */
	static debug(context: string, message: string, ...args: any[]): void {
		if (Logger.logLevel <= LogLevel.DEBUG && Logger.isContextEnabled(context)) {
			console.debug(Logger.formatMessage('debug', context, message), ...args);
		}
	}
	
	/**
	 * Info logging
	 */
	static info(context: string, message: string, ...args: any[]): void {
		if (Logger.logLevel <= LogLevel.INFO && Logger.isContextEnabled(context)) {
			console.log(Logger.formatMessage('info', context, message), ...args);
		}
	}
	
	/**
	 * Warning logging
	 */
	static warn(context: string, message: string, ...args: any[]): void {
		if (Logger.logLevel <= LogLevel.WARN && Logger.isContextEnabled(context)) {
			console.warn(Logger.formatMessage('warn', context, message), ...args);
		}
	}
	
	/**
	 * Error logging
	 */
	static error(context: string, message: string, ...args: any[]): void {
		if (Logger.logLevel <= LogLevel.ERROR && Logger.isContextEnabled(context)) {
			console.error(Logger.formatMessage('error', context, message), ...args);
		}
	}
	
	/**
	 * Group logging for related operations
	 */
	static group(context: string, title: string, fn: () => void): void {
		if (Logger.isContextEnabled(context)) {
			console.group(Logger.formatMessage('group', context, title));
			fn();
			console.groupEnd();
		}
	}
	
	/**
	 * Time measurement
	 */
	static time(context: string, label: string): void {
		if (Logger.isContextEnabled(context)) {
			console.time(`[${context}] ${label}`);
		}
	}
	
	static timeEnd(context: string, label: string): void {
		if (Logger.isContextEnabled(context)) {
			console.timeEnd(`[${context}] ${label}`);
		}
	}
	
	/**
	 * Create a logger instance for a specific context
	 */
	static createLogger(context: string) {
		return {
			debug: (message: string, ...args: any[]) => Logger.debug(context, message, ...args),
			info: (message: string, ...args: any[]) => Logger.info(context, message, ...args),
			warn: (message: string, ...args: any[]) => Logger.warn(context, message, ...args),
			error: (message: string, ...args: any[]) => Logger.error(context, message, ...args),
			group: (title: string, fn: () => void) => Logger.group(context, title, fn),
			time: (label: string) => Logger.time(context, label),
			timeEnd: (label: string) => Logger.timeEnd(context, label),
		};
	}
}

// Pre-defined logger contexts
export const CONTEXTS = {
	API: 'api',
	UI: 'ui',
	SERVICE: 'service',
	NOTEBOOK: 'notebook',
	CHAT: 'chat',
	ANALYSIS: 'analysis',
	VALIDATION: 'validation',
	EVENT: 'event',
} as const;

// Development helper - enable common contexts in dev mode
if (process.env.NODE_ENV === 'development') {
	Logger.enableContext(
		CONTEXTS.API,
		CONTEXTS.SERVICE,
		CONTEXTS.NOTEBOOK,
		CONTEXTS.ANALYSIS
	);
}