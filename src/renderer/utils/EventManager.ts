/**
 * Centralized event handling utilities
 */

export class EventManager {
	private static listeners: Map<string, Set<EventListenerOrEventListenerObject>> = new Map();

	/**
	 * Add event listener with automatic cleanup tracking
	 */
	static addEventListener(
		eventType: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions
	): () => void {
		window.addEventListener(eventType, listener, options);
		
		// Track listener for cleanup
		if (!EventManager.listeners.has(eventType)) {
			EventManager.listeners.set(eventType, new Set());
		}
		EventManager.listeners.get(eventType)!.add(listener);

		// Return cleanup function
		return () => EventManager.removeEventListener(eventType, listener);
	}

	/**
	 * Remove event listener
	 */
	static removeEventListener(
		eventType: string,
		listener: EventListenerOrEventListenerObject
	): void {
		window.removeEventListener(eventType, listener);
		
		const listeners = EventManager.listeners.get(eventType);
		if (listeners) {
			listeners.delete(listener);
			if (listeners.size === 0) {
				EventManager.listeners.delete(eventType);
			}
		}
	}

	/**
	 * Dispatch custom event with type safety
	 */
	static dispatchEvent<T = any>(eventType: string, detail?: T): void {
		const event = new CustomEvent(eventType, { detail });
		window.dispatchEvent(event);
	}

	/**
	 * Clean up all listeners for a specific event type
	 */
	static cleanupEventType(eventType: string): void {
		const listeners = EventManager.listeners.get(eventType);
		if (listeners) {
			listeners.forEach(listener => {
				window.removeEventListener(eventType, listener);
			});
			EventManager.listeners.delete(eventType);
		}
	}

	/**
	 * Clean up all tracked listeners
	 */
	static cleanupAll(): void {
		EventManager.listeners.forEach((listeners, eventType) => {
			listeners.forEach(listener => {
				window.removeEventListener(eventType, listener);
			});
		});
		EventManager.listeners.clear();
	}

	/**
	 * Create a managed event listener that auto-cleans up
	 */
	static createManagedListener(
		eventType: string,
		handler: (event: CustomEvent) => void,
		options?: boolean | AddEventListenerOptions
	): () => void {
		const listener = (event: Event) => {
			if (event instanceof CustomEvent) {
				handler(event);
			}
		};

		return EventManager.addEventListener(eventType, listener, options);
	}

	/**
	 * Wait for a specific event to be dispatched
	 */
	static waitForEvent<T = any>(
		eventType: string,
		timeoutMs: number = 10000
	): Promise<T> {
		return new Promise((resolve, reject) => {
			let cleanup: (() => void) | null = null;
			
			const timeout = setTimeout(() => {
				if (cleanup) cleanup();
				reject(new Error(`Event ${eventType} timeout after ${timeoutMs}ms`));
			}, timeoutMs);

			cleanup = EventManager.createManagedListener(eventType, (event) => {
				clearTimeout(timeout);
				if (cleanup) cleanup();
				resolve(event.detail);
			});
		});
	}
}