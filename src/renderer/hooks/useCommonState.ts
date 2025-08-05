/**
 * Common React state management hooks
 */
import { useState, useCallback, useEffect } from 'react';

/**
 * Common loading state hook
 */
export function useLoading(initialState: boolean = false) {
	const [isLoading, setIsLoading] = useState(initialState);
	
	const startLoading = useCallback(() => setIsLoading(true), []);
	const stopLoading = useCallback(() => setIsLoading(false), []);
	const toggleLoading = useCallback(() => setIsLoading(prev => !prev), []);
	
	return {
		isLoading,
		startLoading,
		stopLoading,
		toggleLoading,
		setIsLoading,
	};
}

/**
 * Common visibility/modal state hook
 */
export function useToggle(initialState: boolean = false) {
	const [isOpen, setIsOpen] = useState(initialState);
	
	const open = useCallback(() => setIsOpen(true), []);
	const close = useCallback(() => setIsOpen(false), []);
	const toggle = useCallback(() => setIsOpen(prev => !prev), []);
	
	return {
		isOpen,
		open,
		close,
		toggle,
		setIsOpen,
	};
}

/**
 * Copy to clipboard state hook
 */
export function useCopyState(resetDelayMs: number = 2000) {
	const [copied, setCopied] = useState(false);
	
	const setCopiedTemp = useCallback(() => {
		setCopied(true);
		setTimeout(() => setCopied(false), resetDelayMs);
	}, [resetDelayMs]);
	
	return {
		copied,
		setCopiedTemp,
	};
}

/**
 * Collapsed/expanded state hook
 */
export function useCollapsible(initialCollapsed: boolean = false) {
	const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);
	
	const collapse = useCallback(() => setIsCollapsed(true), []);
	const expand = useCallback(() => setIsCollapsed(false), []);
	const toggle = useCallback(() => setIsCollapsed(prev => !prev), []);
	
	return {
		isCollapsed,
		collapse,
		expand,
		toggle,
		setIsCollapsed,
	};
}

/**
 * Error state management hook
 */
export function useError() {
	const [error, setError] = useState<string | null>(null);
	const [hasError, setHasError] = useState(false);
	
	const setErrorMessage = useCallback((message: string | null) => {
		setError(message);
		setHasError(message !== null);
	}, []);
	
	const clearError = useCallback(() => {
		setError(null);
		setHasError(false);
	}, []);
	
	return {
		error,
		hasError,
		setError: setErrorMessage,
		clearError,
	};
}

/**
 * Async operation state hook
 */
export function useAsyncState<T>() {
	const [data, setData] = useState<T | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	
	const execute = useCallback(async (asyncFn: () => Promise<T>) => {
		setIsLoading(true);
		setError(null);
		
		try {
			const result = await asyncFn();
			setData(result);
			return result;
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : String(err);
			setError(errorMessage);
			throw err;
		} finally {
			setIsLoading(false);
		}
	}, []);
	
	const reset = useCallback(() => {
		setData(null);
		setError(null);
		setIsLoading(false);
	}, []);
	
	return {
		data,
		error,
		isLoading,
		execute,
		reset,
	};
}

/**
 * Form input state hook
 */
export function useInput(initialValue: string = '') {
	const [value, setValue] = useState(initialValue);
	const [isDirty, setIsDirty] = useState(false);
	
	const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
		setValue(e.target.value);
		setIsDirty(true);
	}, []);
	
	const reset = useCallback(() => {
		setValue(initialValue);
		setIsDirty(false);
	}, [initialValue]);
	
	const clear = useCallback(() => {
		setValue('');
		setIsDirty(true);
	}, []);
	
	return {
		value,
		onChange,
		reset,
		clear,
		isDirty,
		setValue,
	};
}