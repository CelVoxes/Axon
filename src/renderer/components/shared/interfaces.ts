// Common file item interface
export interface FileItem {
	name: string;
	path: string;
	isDirectory: boolean;
	size?: number;
	modified?: Date;
}

// Common analysis step interface
export interface AnalysisStep {
	id: string;
	description: string;
	code: string;
	status: "pending" | "running" | "completed" | "failed" | "cancelled";
	output?: string;
	files?: string[];
	dataTypes?: string[]; // What data types this step works with
	tools?: string[]; // What tools/libraries this step uses
	prerequisites?: string[]; // What steps must be completed first
}

// Common cell interface for notebooks
export interface Cell {
	id: string;
	code: string;
	language: "python" | "r" | "markdown";
	output: string;
	hasError: boolean;
	status: "pending" | "running" | "completed" | "failed";
	title?: string;
	isMarkdown?: boolean;
}

// Common status types
export type StatusType = "running" | "stopped" | "starting" | "ready" | "error";

// Common button variant types
export type ButtonVariant =
	| "primary"
	| "secondary"
	| "danger"
	| "icon"
	| "success";

// Common size types
export type SizeType = "small" | "medium" | "large";

// Common layout role types
export type LayoutRole = "sidebar" | "main" | "chat";

// Common props interface for components that need layout roles
export interface LayoutProps {
	"data-layout-role"?: LayoutRole;
	children?: React.ReactNode;
}

// Common context menu interface
export interface ContextMenuState {
	visible: boolean;
	x: number;
	y: number;
	item: FileItem | null;
}
