/**
 * Common component prop types and interfaces
 */
import { ReactNode, CSSProperties } from 'react';

/**
 * Base props for all components
 */
export interface BaseProps {
	className?: string;
	style?: CSSProperties;
	children?: ReactNode;
	id?: string;
	'data-testid'?: string;
}

/**
 * Common loading props
 */
export interface LoadingProps {
	isLoading?: boolean;
	loadingText?: string;
	loadingComponent?: ReactNode;
}

/**
 * Common error props
 */
export interface ErrorProps {
	error?: string | null;
	onError?: (error: string) => void;
	errorComponent?: ReactNode;
}

/**
 * Common callback props
 */
export interface CallbackProps {
	onSubmit?: () => void;
	onCancel?: () => void;
	onChange?: (value: any) => void;
	onClick?: () => void;
}

/**
 * Modal/Dialog props
 */
export interface ModalProps extends BaseProps {
	isOpen: boolean;
	onClose: () => void;
	title?: string;
	size?: 'sm' | 'md' | 'lg' | 'xl';
	closable?: boolean;
}

/**
 * Button props
 */
export interface ButtonProps extends BaseProps, CallbackProps {
	variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
	size?: 'sm' | 'md' | 'lg';
	disabled?: boolean;
	loading?: boolean;
	icon?: ReactNode;
	fullWidth?: boolean;
}

/**
 * Input props
 */
export interface InputProps extends BaseProps {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	disabled?: boolean;
	required?: boolean;
	error?: string;
	label?: string;
	type?: 'text' | 'password' | 'email' | 'number';
}

/**
 * Code display props
 */
export interface CodeProps extends BaseProps {
	code: string;
	language?: string;
	title?: string;
	collapsible?: boolean;
	copyable?: boolean;
	maxHeight?: string;
	showLineNumbers?: boolean;
}

/**
 * Status indicator props
 */
export interface StatusProps extends BaseProps {
	status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
	message?: string;
	showIcon?: boolean;
}

/**
 * List item props
 */
export interface ListItemProps<T = any> extends BaseProps {
	item: T;
	index: number;
	selected?: boolean;
	onSelect?: (item: T, index: number) => void;
	onAction?: (action: string, item: T) => void;
}

/**
 * Pagination props
 */
export interface PaginationProps extends BaseProps {
	currentPage: number;
	totalPages: number;
	onPageChange: (page: number) => void;
	pageSize?: number;
	showSizeChanger?: boolean;
}

/**
 * Search props
 */
export interface SearchProps extends BaseProps {
	query: string;
	onSearch: (query: string) => void;
	onClear?: () => void;
	placeholder?: string;
	suggestions?: string[];
	loading?: boolean;
}

/**
 * File upload props
 */
export interface FileUploadProps extends BaseProps {
	onFileSelect: (files: FileList) => void;
	accept?: string;
	multiple?: boolean;
	maxSize?: number;
	disabled?: boolean;
}

/**
 * Common data props
 */
export interface DataProps<T = any> {
	data: T[];
	loading?: boolean;
	error?: string | null;
	onRefresh?: () => void;
}

/**
 * Theme props
 */
export interface ThemeProps {
	theme?: 'light' | 'dark';
	variant?: 'default' | 'compact' | 'comfortable';
}

/**
 * Animation props
 */
export interface AnimationProps {
	animated?: boolean;
	duration?: number;
	delay?: number;
	easing?: string;
}

/**
 * Accessibility props
 */
export interface A11yProps {
	'aria-label'?: string;
	'aria-describedby'?: string;
	'aria-expanded'?: boolean;
	role?: string;
	tabIndex?: number;
}