import { BackendClient } from "../../../services/backend/BackendClient";

/**
 * Higher-order function for backend operations with consistent validation
 * Ensures all operations check backend client availability before proceeding
 */
export const withBackendValidation = <T extends any[], R>(
	operation: (client: BackendClient, ...args: T) => Promise<R>,
	operationName: string = "Operation"
) => {
	return async (
		backendClient: BackendClient | null,
		addMessage: (content: string, isUser: boolean) => void,
		resetLoadingState: () => void,
		...args: T
	): Promise<R | null> => {
		// Validate backend client availability
		if (!backendClient) {
			console.error(`${operationName}: Backend client not initialized`);
			addMessage(
				`${operationName} failed: Backend service is not available. Please wait for initialization to complete and try again.`,
				false
			);
			resetLoadingState();
			return null;
		}

		try {
			return await operation(backendClient, ...args);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			console.error(`${operationName} failed:`, error);
			
			// Provide helpful error message based on error type
			let userMessage = `${operationName} failed: ${errorMessage}.`;
			
			if (errorMessage.includes('network') || errorMessage.includes('connection')) {
				userMessage += '\n\nSuggestions:\n• Check your internet connection\n• Ensure the backend service is running\n• Try again in a few moments';
			} else if (errorMessage.includes('timeout')) {
				userMessage += '\n\nThe operation timed out. Please try again with a simpler request or check your connection.';
			} else {
				userMessage += '\n\nPlease try again or contact support if the problem persists.';
			}
			
			addMessage(userMessage, false);
			resetLoadingState();
			throw error;
		}
	};
};

/**
 * Safe async operation wrapper with proper error boundaries
 */
export const safeAsyncOperation = async (
	operation: () => Promise<void>,
	operationName: string,
	addMessage: (content: string, isUser: boolean) => void,
	resetLoadingState: () => void
): Promise<boolean> => {
	try {
		await operation();
		return true;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		console.error(`${operationName} failed:`, error);
		
		addMessage(
			`${operationName} failed: ${errorMessage}. Please try again or contact support if the problem persists.`,
			false
		);
		resetLoadingState();
		return false;
	}
};

/**
 * Validates that critical dependencies are available before proceeding
 */
export const validateDependencies = (
	dependencies: { [key: string]: any },
	addMessage: (content: string, isUser: boolean) => void,
	resetLoadingState: () => void
): boolean => {
	const missing: string[] = [];
	
	for (const [name, value] of Object.entries(dependencies)) {
		if (value === null || value === undefined) {
			missing.push(name);
		}
	}
	
	if (missing.length > 0) {
		console.error('Missing dependencies:', missing);
		addMessage(
			`Operation cannot proceed: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not available. Please wait for initialization to complete.`,
			false
		);
		resetLoadingState();
		return false;
	}
	
	return true;
};