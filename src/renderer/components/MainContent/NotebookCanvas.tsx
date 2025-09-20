import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import styled from "styled-components";
import {
	FiPlay,
	FiSquare,
	FiCpu,
	FiFileText,
	FiPlus,
	FiArrowRightCircle,
	FiExternalLink,
	FiLayers,
	FiGitBranch,
} from "react-icons/fi";
import { typography } from "../../styles/design-system";
import { EventManager } from "../../utils/EventManager";

type NotebookCell = {
	cell_type: "code" | "markdown";
	source: string[] | string;
	metadata: any;
	execution_count?: number | null;
	outputs?: any[];
};

type CellState = { code: string; output: string };

type NodeData = {
	index: number;
	x: number;
	y: number;
	width: number;
	height: number;
	inputsRaw: string[];
	inputVars: string[];
	outputVars: string[];
	resourceReads: string[];
	resourceWrites: string[];
	hasError: boolean;
	isMarkdown: boolean;
	label: string;
	summary: string;
};

type EdgeData = {
	source: number;
	target: number;
	vars: string[];
	kind: "data" | "seq" | "resource";
};

type CommandOutcome = "success" | "error" | "info";

type CommandHistoryEntry = {
	id: number;
	command: string;
	message: string;
	outcome: CommandOutcome;
	timestamp: number;
};

type ZoomDirection = "in" | "out" | "reset";

type ParsedCommand =
	| { kind: "run-cell"; index: number }
	| { kind: "run-range"; start: number; end: number }
	| { kind: "run-selected" }
	| { kind: "run-all" }
	| { kind: "stop-cell"; scope: "selected" | "index" | "all"; index?: number }
	| { kind: "open-cell"; index: number }
	| { kind: "select-cell"; index: number }
	| { kind: "clear-selection" }
	| { kind: "add-cell"; cellType: "code" | "markdown"; content?: string }
	| { kind: "zoom"; direction: ZoomDirection }
	| { kind: "help" }
	| { kind: "unknown"; reason: string };

type AddCellOptions = {
	insertAfter?: number;
};

interface NotebookCanvasProps {
	filePath: string;
	cells: NotebookCell[];
	cellStates: CellState[];
	onOpenCell?: (index: number) => void;
}

const CanvasWrapper = styled.div`
	position: relative;
	width: 100%;
	height: 100%;
	background: #141414;
	border: 1px solid #2d2d2d;
	border-radius: 10px;
	overflow: hidden;
`;

const Grid = styled.div`
	position: absolute;
	inset: 0;
	background-size: 28px 28px;
	background-image: linear-gradient(#1f1f1f 1px, transparent 1px),
		linear-gradient(90deg, #1f1f1f 1px, transparent 1px);
`;

const Viewport = styled.div`
	position: absolute;
	inset: 0;
	transform-origin: 0 0;
`;

const NodeContainer = styled.div<{ $selected: boolean; $error: boolean }>`
	position: absolute;
	width: 280px;
	min-height: 210px;
	background: #1d1d1d;
	border: 1px solid
		${(p) => (p.$error ? "#ef4444" : p.$selected ? "#4b9ce6" : "#2f2f2f")};
	border-radius: 10px;
	color: #ececec;
	box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
	cursor: grab;
	transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;

	&:hover {
		border-color: ${(p) => (p.$error ? "#f87171" : "#60a5fa")};
		box-shadow: 0 14px 34px rgba(15, 23, 42, 0.45);
		transform: translateY(-2px);
	}
`;

const NodeHeader = styled.div`
	padding: 12px 16px;
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 12px;
	border-bottom: 1px solid #262626;
`;

const NumberBadge = styled.span`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	border-radius: 50%;
	background: #2b2b2b;
	border: 1px solid #3c3c3c;
	font-size: ${typography.sm};
	font-weight: 600;
	color: #d5d5d5;
`;

const NodeSummary = styled.div`
	flex: 1;
	font-size: ${typography.sm};
	line-height: 1.35;
	color: #dcdcdc;
	display: -webkit-box;
	-webkit-line-clamp: 3;
	-webkit-box-orient: vertical;
	overflow: hidden;
`;

const ControlButton = styled.button<{ $variant: "run" | "stop" }>`
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 4px 10px;
	font-size: 12px;
	border-radius: 7px;
	border: 1px solid transparent;
	cursor: pointer;
	background: ${(p) => (p.$variant === "run" ? "#0d6efd" : "#c0392b")};
	border-color: ${(p) => (p.$variant === "run" ? "#0f7ef0" : "#c8503f")};
	color: #ffffff;

	&:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
`;

const NodeBody = styled.div`
	padding: 14px 16px 18px 16px;
	display: grid;
	gap: 12px;
`;

const SectionLabel = styled.div`
	font-size: ${typography.xs};
	color: #a0a0a0;
	text-transform: uppercase;
	letter-spacing: 0.04em;
`;

const IOList = styled.div`
	display: flex;
	gap: 6px;
	flex-wrap: wrap;
`;

const IOBadge = styled.span`
    padding: 2px 8px;
    font-size: ${typography.xs};
    border-radius: 999px;
    background: #242424;
    border: 1px solid #343434;
    color: #d7d7d7;
`;

const IOBadgeButton = styled.button`
    padding: 2px 8px;
    font-size: ${typography.xs};
    border-radius: 999px;
    background: #242424;
    border: 1px solid #3a4a63;
    color: #dbeafe;
    cursor: pointer;
    transition: border-color 0.2s ease, background 0.2s ease, transform 0.15s ease;

    &:hover {
        border-color: #60a5fa;
        background: rgba(37, 99, 235, 0.2);
        transform: translateY(-1px);
    }

    &:active {
        transform: translateY(0);
    }
`;

const OutputPreview = styled.pre`
	margin: 0;
	padding: 8px 10px;
	max-height: 90px;
	overflow: auto;
	background: #101010;
	border-radius: 8px;
	border: 1px solid #252525;
	font-size: 11px;
	line-height: 1.4;
`;

const NodeTopRow = styled.div`
    display: flex;
    align-items: center;
    gap: 10px;
`;

const NodeTypeIcon = styled.div<{ $variant: "code" | "markdown" }>`
    width: 30px;
    height: 30px;
    border-radius: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: ${(p) => (p.$variant === "code" ? "rgba(59, 130, 246, 0.18)" : "rgba(16, 185, 129, 0.18)")};
    border: 1px solid ${(p) => (p.$variant === "code" ? "rgba(59, 130, 246, 0.45)" : "rgba(16, 185, 129, 0.45)")};
    color: ${(p) => (p.$variant === "code" ? "#93c5fd" : "#6ee7b7")};
`;

const NodeTagRow = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
`;

const NodeTag = styled.span`
    font-size: ${typography.xs};
    padding: 3px 8px;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.12);
    border: 1px solid rgba(148, 163, 184, 0.28);
    color: rgba(226, 232, 240, 0.9);
`;

const StatusPill = styled.span<{ $tone: "ok" | "warn" | "error" }>`
    font-size: ${typography.xs};
    padding: 3px 8px;
    border-radius: 999px;
    background: ${(p) =>
        p.$tone === "error"
            ? "rgba(248, 113, 113, 0.18)"
            : p.$tone === "warn"
            ? "rgba(251, 191, 36, 0.18)"
            : "rgba(110, 231, 183, 0.18)"};
    color: ${(p) =>
        p.$tone === "error"
            ? "#fecaca"
            : p.$tone === "warn"
            ? "#fde68a"
            : "#bbf7d0"};
    border: 1px solid
        ${(p) =>
            p.$tone === "error"
                ? "rgba(248, 113, 113, 0.4)"
                : p.$tone === "warn"
                ? "rgba(251, 191, 36, 0.4)"
                : "rgba(16, 185, 129, 0.4)"};
`;

const PurposeBlock = styled.div`
    display: grid;
    gap: 6px;
`;

const PurposeText = styled.div`
    font-size: ${typography.sm};
    line-height: 1.5;
    color: rgba(226, 232, 240, 0.9);
    background: rgba(15, 23, 42, 0.35);
    border: 1px solid rgba(71, 85, 105, 0.35);
    border-radius: 8px;
    padding: 8px 10px;
`;

const ConnectionSummary = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
`;

const ConnectionBadge = styled.span`
    font-size: ${typography.xs};
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(30, 41, 59, 0.65);
    border: 1px solid rgba(71, 85, 105, 0.45);
    color: rgba(226, 232, 240, 0.82);
`;

const ActionBar = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 6px;
`;

const ActionButton = styled.button<{ $variant?: "primary" | "secondary" | "ghost" }>`
    padding: 6px 12px;
    border-radius: 8px;
    font-size: ${typography.xs};
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid transparent;
    cursor: pointer;
    background: ${(p) =>
        p.$variant === "primary"
            ? "linear-gradient(135deg, #2563eb, #1d4ed8)"
            : p.$variant === "secondary"
            ? "rgba(59, 130, 246, 0.12)"
            : "rgba(148, 163, 184, 0.12)"};
    border-color: ${(p) =>
        p.$variant === "primary"
            ? "rgba(37, 99, 235, 0.9)"
            : p.$variant === "secondary"
            ? "rgba(59, 130, 246, 0.45)"
            : "rgba(148, 163, 184, 0.35)"};
    color: ${(p) =>
        p.$variant === "primary"
            ? "#ffffff"
            : p.$variant === "secondary"
            ? "#bfdbfe"
            : "#e2e8f0"};
    transition: transform 0.15s ease, opacity 0.2s ease, border-color 0.2s ease;

    &:hover:not(:disabled) {
        transform: translateY(-1px);
    }

    &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
`;

const NodeHeaderContent = styled.div`
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
`;

const HeaderActions = styled.div`
    display: flex;
    align-items: center;
    gap: 6px;
`;

const CARD_WIDTH = 280;
const CARD_HEIGHT = 210;
const BASE_LEFT = 120;
const BASE_TOP = 80;
const COLUMN_SPACING = 700;
const SIBLING_SPACING = 340;
const LEVEL_VERTICAL_SPACING = 320;
const ROW_SPACING = 280;
const MAX_PER_ROW = 3;
const MAX_DISPLAY_INPUT_ITEMS = 6;
const MAX_DISPLAY_OUTPUT_ITEMS = 6;

const SvgOverlay = styled.svg`
	position: absolute;
	inset: 0;
	pointer-events: none;
	overflow: visible;
`;

const CommandPanel = styled.div`
	position: absolute;
	top: 18px;
	right: 18px;
	width: 340px;
	max-width: calc(100% - 48px);
	background: rgba(18, 18, 18, 0.92);
	border: 1px solid rgba(64, 64, 64, 0.6);
	border-radius: 14px;
	padding: 18px;
	display: flex;
	flex-direction: column;
	gap: 12px;
	z-index: 4;
	backdrop-filter: blur(14px);
	box-shadow: 0 22px 48px rgba(0, 0, 0, 0.46);
	pointer-events: auto;
`;

const CommandHeader = styled.div`
	display: flex;
	flex-direction: column;
	gap: 4px;
`;

const CommandTitle = styled.div`
	font-size: ${typography.sm};
	font-weight: 600;
	color: #f3f4f6;
`;

const CommandDescription = styled.div`
	font-size: ${typography.xs};
	color: rgba(226, 232, 240, 0.72);
	line-height: 1.5;
`;

const CommandForm = styled.form`
	display: flex;
	align-items: stretch;
	gap: 8px;
`;

const CommandInput = styled.input`
	flex: 1;
	background: rgba(12, 12, 12, 0.92);
	border: 1px solid #2d2d2d;
	border-radius: 10px;
	padding: 9px 12px;
	font-size: ${typography.sm};
	color: #f8fafc;
	outline: none;
	transition: border-color 0.2s ease;

	&:focus {
		border-color: #3b82f6;
	}
`;

const CommandSubmitButton = styled.button`
	min-width: 76px;
	background: linear-gradient(135deg, #2563eb, #1d4ed8);
	border: 1px solid rgba(37, 99, 235, 0.9);
	color: #ffffff;
	border-radius: 10px;
	font-size: 12px;
	font-weight: 600;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: 0 12px;
	cursor: pointer;
	transition: transform 0.15s ease, opacity 0.2s ease;

	&:hover:not(:disabled) {
		transform: translateY(-1px);
	}

	&:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
`;

const CommandHint = styled.div`
	font-size: ${typography.xs};
	color: rgba(148, 163, 184, 0.72);
`;

const QuickActionRow = styled.div`
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
`;

const QuickActionChip = styled.button`
	border: 1px solid rgba(59, 130, 246, 0.35);
	background: rgba(37, 99, 235, 0.15);
	color: #dbeafe;
	border-radius: 999px;
	padding: 6px 12px;
	font-size: 11px;
	font-weight: 500;
	cursor: pointer;
	transition: border-color 0.2s ease, background 0.2s ease;

	&:hover:not(:disabled) {
		border-color: rgba(59, 130, 246, 0.65);
		background: rgba(37, 99, 235, 0.3);
	}

	&:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
`;

const CommandFeedback = styled.div<{ $tone: CommandOutcome }>`
	border-radius: 10px;
	padding: 10px 12px;
	font-size: ${typography.xs};
	line-height: 1.4;
	background: ${(p) =>
		p.$tone === "success"
			? "rgba(34, 197, 94, 0.12)"
			: p.$tone === "error"
			? "rgba(248, 113, 113, 0.12)"
			: "rgba(148, 163, 184, 0.12)"};
	color: ${(p) =>
		p.$tone === "success"
			? "#bbf7d0"
			: p.$tone === "error"
			? "#fecaca"
			: "#e2e8f0"};
	border: 1px solid
		${(p) =>
			p.$tone === "success"
				? "rgba(34, 197, 94, 0.35)"
				: p.$tone === "error"
				? "rgba(248, 113, 113, 0.35)"
				: "rgba(148, 163, 184, 0.28)"};
`;

const CommandHistoryList = styled.ul`
	margin: 0;
	padding: 0;
	list-style: none;
	display: flex;
	flex-direction: column;
	gap: 6px;
`;

const CommandHistoryItem = styled.li<{ $tone: CommandOutcome }>`
	display: flex;
	align-items: baseline;
	gap: 8px;
	font-size: 11px;
	color: ${(p) =>
		p.$tone === "success"
			? "#bbf7d0"
			: p.$tone === "error"
			? "#fecaca"
			: "#cbd5f5"};
`;

const HistoryMessage = styled.span`
	flex: 1;
	color: rgba(226, 232, 240, 0.78);
`;

const HistoryTimestamp = styled.span`
	font-size: 10px;
	color: rgba(226, 232, 240, 0.55);
`;

const PY_KEYWORDS = new Set([
	"False",
	"None",
	"True",
	"and",
	"as",
	"assert",
	"async",
	"await",
	"break",
	"class",
	"continue",
	"def",
	"del",
	"elif",
	"else",
	"except",
	"finally",
	"for",
	"from",
	"global",
	"if",
	"import",
	"in",
	"is",
	"lambda",
	"nonlocal",
	"not",
	"or",
	"pass",
	"raise",
	"return",
	"try",
	"while",
	"with",
	"yield",
]);

const PY_BUILTINS = new Set([
	"abs",
	"all",
	"any",
	"ascii",
	"bin",
	"bool",
	"breakpoint",
	"bytearray",
	"bytes",
	"callable",
	"chr",
	"classmethod",
	"compile",
	"complex",
	"delattr",
	"dict",
	"dir",
	"divmod",
	"enumerate",
	"eval",
	"exec",
	"filter",
	"float",
	"format",
	"frozenset",
	"getattr",
	"globals",
	"hasattr",
	"hash",
	"help",
	"hex",
	"id",
	"input",
	"int",
	"isinstance",
	"issubclass",
	"iter",
	"len",
	"list",
	"locals",
	"map",
	"max",
	"memoryview",
	"min",
	"next",
	"object",
	"oct",
	"open",
	"ord",
	"pow",
	"print",
	"property",
	"range",
	"repr",
	"reversed",
	"round",
	"set",
	"setattr",
	"slice",
	"sorted",
	"staticmethod",
	"str",
	"sum",
	"super",
	"tuple",
	"type",
	"vars",
	"zip",
]);

const DEFAULT_SUMMARY_MARKDOWN = "## Summary\n\n- ";

function stripWrappingQuotes(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) return trimmed;
	const first = trimmed[0];
	const last = trimmed[trimmed.length - 1];
	if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

function parseCellIndexToken(token: string): number | null {
	const digits = token.replace(/[^0-9]/g, "");
	if (!digits) return null;
	const value = Number.parseInt(digits, 10);
	if (Number.isNaN(value) || value <= 0) return null;
	return value - 1;
}

function interpretCommand(raw: string): ParsedCommand {
	const trimmed = raw.trim();
	if (!trimmed) return { kind: "unknown", reason: "No command provided" };
	const normalized = trimmed.toLowerCase().replace(/\s+/g, " ").trim();

	if (
		normalized === "help" ||
		normalized === "commands" ||
		normalized.includes("help me") ||
		normalized.includes("what can i do")
	) {
		return { kind: "help" };
	}

	if (/^(?:clear|reset)\s+(?:selection|highlight)/.test(normalized)) {
		return { kind: "clear-selection" };
	}

	if (/zoom\s+in/.test(normalized)) {
		return { kind: "zoom", direction: "in" };
	}

	if (/zoom\s+out/.test(normalized)) {
		return { kind: "zoom", direction: "out" };
	}

	if (/reset\s+zoom/.test(normalized)) {
		return { kind: "zoom", direction: "reset" };
	}

	if (/(?:run|execute)\s+(?:selected|this|current)\s+(?:cell|step)/.test(normalized)) {
		return { kind: "run-selected" };
	}

	if (/(?:stop|cancel)\s+(?:selected|this|current)\s+(?:cell|step)/.test(normalized)) {
		return { kind: "stop-cell", scope: "selected" };
	}

	if (/(?:stop|cancel)\s+(?:all|everything|notebook)/.test(normalized)) {
		return { kind: "stop-cell", scope: "all" };
	}

	const stopSpecificMatch = normalized.match(/(?:stop|cancel)\s+(?:cell|step)\s*#?(\d+)/);
	if (stopSpecificMatch) {
		const idx = parseCellIndexToken(stopSpecificMatch[1]);
		if (idx != null) {
			return { kind: "stop-cell", scope: "index", index: idx };
		}
	}

	if (
		/(?:run|execute)\s+(?:all|entire|whole)\s*(?:notebook|cells|workflow|steps)?/.test(normalized) ||
		normalized === "run everything"
	) {
		return { kind: "run-all" };
	}

	const rangeMatch = normalized.match(
		/(?:run|execute)\s+cells?\s*(?:from\s*)?#?(\d+)\s*(?:-|to|through|thru|until|up\s+to)\s*#?(\d+)/
	);
	if (rangeMatch) {
		const startIdx = parseCellIndexToken(rangeMatch[1]);
		const endIdx = parseCellIndexToken(rangeMatch[2]);
		if (startIdx != null && endIdx != null) {
			return { kind: "run-range", start: startIdx, end: endIdx };
		}
	}

	const runMatch = normalized.match(/(?:run|execute)\s+(?:cell|step)\s*#?(\d+)/);
	if (runMatch) {
		const idx = parseCellIndexToken(runMatch[1]);
		if (idx != null) {
			return { kind: "run-cell", index: idx };
		}
	}

	const selectMatch = normalized.match(/(?:select|focus|highlight)\s+(?:cell|step)\s*#?(\d+)/);
	if (selectMatch) {
		const idx = parseCellIndexToken(selectMatch[1]);
		if (idx != null) {
			return { kind: "select-cell", index: idx };
		}
	}

	const openMatch = normalized.match(/(?:open|view|show|inspect)\s+(?:cell|step)\s*#?(\d+)/);
	if (openMatch) {
		const idx = parseCellIndexToken(openMatch[1]);
		if (idx != null) {
			return { kind: "open-cell", index: idx };
		}
	}

	if (/(?:add|create)\s+(?:a\s+)?summary/.test(normalized)) {
		const summaryMatch = raw.match(
			/(?:add|create)[^\n]*summary(?:\s+(?:called|named|titled|with|containing|that\s+says|saying)\s+(.+))?/i
		);
		const content = summaryMatch?.[1]
			? stripWrappingQuotes(summaryMatch[1])
			: DEFAULT_SUMMARY_MARKDOWN;
		return { kind: "add-cell", cellType: "markdown", content };
	}

	const addMatch = raw.match(/add\s+(markdown|code)\s+(?:cell|step)(.*)$/i);
	if (addMatch) {
		const cellType = addMatch[1].toLowerCase() as "code" | "markdown";
		const tail = addMatch[2]?.trim() ?? "";
		let content: string | undefined;
		if (tail) {
			const contentMatch = tail.match(
				/^(?:called|named|titled|with|containing|that\s+says|saying|filled\s+with)\s+(.+)$/i
			);
			content = contentMatch ? stripWrappingQuotes(contentMatch[1]) : stripWrappingQuotes(tail);
		}
		return { kind: "add-cell", cellType, content };
	}

	return { kind: "unknown", reason: "Command not recognized" };
}

function buildFollowUpCode(node: NodeData): string {
    const lines: string[] = [];
    lines.push(`# Follow-up analysis for cell #${node.index + 1}`);
    if (node.summary) {
        lines.push(`# ${node.summary}`);
    }
    lines.push("");
    if (node.outputVars.length > 0) {
        lines.push("# Available outputs from the upstream cell:");
        node.outputVars.slice(0, 4).forEach((variable) => {
            lines.push(`# - ${variable}`);
        });
        lines.push("");
        const primary = node.outputVars[0];
        lines.push(`${primary}  # TODO: replace with your next analysis step`);
    } else if (node.resourceWrites.length > 0) {
        lines.push("# Files produced by the upstream cell:");
        node.resourceWrites.slice(0, 3).forEach((path) => {
            lines.push(`# - ${path}`);
        });
        lines.push("");
        lines.push("# Example: load the generated artifact");
        const path = node.resourceWrites[0];
        lines.push(`import pandas as pd  # adjust loader to match ${path}`);
        lines.push(`df = pd.read_csv("${path}")  # replace with appropriate loader`);
    } else {
        lines.push("# TODO: branch from the previous step");
    }
    lines.push("");
    lines.push("# Add your analysis below");
    return lines.join("\n");
}

function buildOutputExplorationSnippet(node: NodeData, value: string): string {
    const lines: string[] = [];
    lines.push(`# Explore '${value}' from cell #${node.index + 1}`);
    lines.push("");
    lines.push(`if hasattr(${value}, "head"):`);
    lines.push(`    display(${value}.head())`);
    lines.push("else:");
    lines.push(`    print(${value})`);
    lines.push("");
    lines.push("# Continue the analysis below");
    return lines.join("\n");
}

function buildMarkdownSummary(node: NodeData): string {
    return [
        `## Next steps after cell #${node.index + 1}`,
        "",
        `- Summarise the outcome: ${node.summary || "describe what this step produced"}`,
        "- Highlight insights or questions that surfaced",
        "- List the follow-up analysis you want to run",
        "",
    ].join("\n");
}

function extractCode(cell: NotebookCell, state?: CellState): string {
	if (state?.code && state.code.trim()) return state.code;
	if (Array.isArray(cell.source)) return cell.source.join("");
	return String(cell.source ?? "");
}

function extractOutputs(code: string): string[] {
	const outputs = new Set<string>();
	const lines = code.split(/\r?\n/);
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;

		const func = line.match(/^def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
		if (func) {
			outputs.add(func[1]);
			continue;
		}

		const clazz = line.match(/^class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*[(:]/);
		if (clazz) {
			outputs.add(clazz[1]);
			continue;
		}

		if (/^import\s+/.test(line)) {
			const rest = line.replace(/^import\s+/, "");
			for (const part of rest.split(",")) {
				const seg = part.trim();
				if (!seg) continue;
				const match = seg.match(
					/^([a-zA-Z_][\w\.]*)(?:\s+as\s+([a-zA-Z_][\w]*))?$/
				);
				if (match) {
					const alias = match[2] || match[1];
					outputs.add(alias.split(".")[0]);
				}
			}
			continue;
		}

		if (/^from\s+/.test(line)) {
			const match = line.match(/^from\s+[a-zA-Z_][\w\.]*\s+import\s+(.+)/);
			if (match) {
				const targets = match[1].trim();
				if (targets !== "*") {
					for (const item of targets.split(",")) {
						const trimmed = item.trim();
						if (!trimmed) continue;
						const mi = trimmed.match(
							/^([a-zA-Z_][\w]*)(?:\s+as\s+([a-zA-Z_][\w]*))?$/
						);
						if (mi) outputs.add(mi[2] || mi[1]);
					}
				}
			}
			continue;
		}

		const tupleAssign = line.match(
			/^([a-zA-Z_][a-zA-Z0-9_]*(?:\s*,\s*[a-zA-Z_][a-zA-Z0-9_]*)*)\s*=\s*.+/
		);
		if (tupleAssign) {
			for (const name of tupleAssign[1].split(/\s*,\s*/)) {
				if (name && !PY_KEYWORDS.has(name)) outputs.add(name);
			}
			continue;
		}

		const subAssign = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\[.+\]\s*=\s*.+/);
		if (subAssign) {
			outputs.add(subAssign[1]);
			continue;
		}

		const attrAssign = line.match(
			/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\.[a-zA-Z_][a-zA-Z0-9_]*\s*=\s*.+/
		);
		if (attrAssign) {
			outputs.add(attrAssign[1]);
			continue;
		}

		const augAssign = line.match(
			/^([a-zA-Z_][a-zA-Z0-9_]*)\s*[+\-*/%&|^]=\s*.+/
		);
		if (augAssign) {
			outputs.add(augAssign[1]);
			continue;
		}
	}
	return Array.from(outputs);
}

function extractInputs(code: string, outputs: Set<string>): string[] {
	const tokens = code.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
	const dotted = code.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*\./g) || [];
	const inputs = new Set<string>();

	for (const token of tokens) {
		if (PY_KEYWORDS.has(token)) continue;
		if (PY_BUILTINS.has(token)) continue;
		if (outputs.has(token)) continue;
		inputs.add(token);
	}

	for (const entry of dotted) {
		const root = entry.replace(/\s*\./, "").trim();
		if (root && !outputs.has(root) && !PY_KEYWORDS.has(root)) {
			inputs.add(root);
		}
	}

	return Array.from(inputs);
}

function extractImportAliases(code: string): string[] {
	const aliases = new Set<string>();
	const lines = code.split(/\r?\n/);
	for (const rawLine of lines) {
		const line = rawLine.split("#")[0].trim();
		if (!line) continue;
		if (line.startsWith("import ")) {
			const rest = line.replace(/^import\s+/, "");
			for (const segment of rest.split(",")) {
				const part = segment.trim();
				if (!part) continue;
				const match = part.match(
					/^([a-zA-Z_][\w\.]*)\s*(?:as\s+([a-zA-Z_][\w]*))?$/
				);
				if (match) {
					const alias = match[2] || match[1].split(".").pop() || match[1];
					aliases.add(alias);
				}
			}
			continue;
		}
		if (line.startsWith("from ")) {
			const match = line.match(/^from\s+[a-zA-Z_][\w\.]*\s+import\s+(.+)/);
			if (match) {
				const imported = match[1].trim();
				if (imported === "*") continue;
				for (const segment of imported.split(",")) {
					const part = segment.trim();
					if (!part) continue;
					const mi = part.match(
						/^([a-zA-Z_][\w]*)(?:\s+as\s+([a-zA-Z_][\w]*))?$/
					);
					if (mi) aliases.add(mi[2] || mi[1]);
				}
			}
		}
	}
	return Array.from(aliases);
}

function extractResourceUsage(code: string): { reads: string[]; writes: string[] } {
	const reads = new Set<string>();
	const writes = new Set<string>();

	const push = (bucket: Set<string>, value: string) => {
		const normalized = value
			.replace(/\\/g, "/")
			.replace(/^\.\/+/, "")
			.replace(/\/\/+/, "/")
			.trim();
		if (!normalized) return;
		bucket.add(normalized);
	};

	const pathRegex = /(['"])([^'"\n]*[\\/][^'"\n]+|[^'"\n]+\.(?:csv|tsv|txt|json|parquet|feather|h5|hdf5|pkl|pickle|npz|npy|pt|pth|xlsx|xls|png|jpg|jpeg|tif|tiff|h5ad))\1/gi;
	let match: RegExpExecArray | null;
	while ((match = pathRegex.exec(code)) !== null) {
		const path = match[2];
		const before = code.slice(Math.max(0, match.index - 60), match.index).toLowerCase();
		const after = code.slice(match.index, Math.min(code.length, match.index + 80)).toLowerCase();

		const isWrite =
			/(to_|write|save|dump|writelines|to_excel|to_json|to_parquet|to_csv|to_hdf)/.test(
				before
			) ||
			/open\s*\([^\)]*,\s*['"]a/.test(after) ||
			/open\s*\([^\)]*,\s*['"]w/.test(after) ||
			/os\.makedirs|os\.mkdir|shutil\.copy|shutil\.move|torch\.save|np\.save/.test(
				before
			);

		if (isWrite) {
			push(writes, path);
		} else {
			push(reads, path);
		}
	}

	const pathCallRegex = /Path\s*\(\s*(['"])([^'"\n]+)\1\s*\)/gi;
	while ((match = pathCallRegex.exec(code)) !== null) {
		const path = match[2];
		const before = code.slice(Math.max(0, match.index - 60), match.index).toLowerCase();
		const after = code.slice(match.index, Math.min(code.length, match.index + 80)).toLowerCase();
		const isWrite =
			/(mkdir|mkdirs|write_text|write_bytes|touch|save)/.test(before) ||
			/(write_text|write_bytes)/.test(after);
		if (isWrite) {
			push(writes, path);
		} else {
			push(reads, path);
		}
	}

	return { reads: Array.from(reads), writes: Array.from(writes) };
}

function formatResourceLabel(path: string): string {
	const trimmed = path.replace(/^\.\/?/, "");
	if (trimmed.length <= 36) return trimmed;
	return `…${trimmed.slice(-35)}`;
}

function canonicalResourceKey(path: string): string {
	return path.replace(/^\.\/+/, "").toLowerCase();
}

function inferAimSummary(
    cell: NotebookCell,
    code: string,
    inputs: string[],
    outputs: string[],
    reads: string[],
    writes: string[],
    prevMarkdownText?: string
): string {
    // Markdown cells: use heading or first line as section/aim
    if (cell.cell_type === "markdown") {
        const text = extractCode(cell);
        const heading = text.match(/^\s*#{1,6}\s+(.+)/m);
        if (heading) return heading[1].trim();
        const first = text.split(/\r?\n/).find((line) => line.trim());
        return first ? first.trim() : "Markdown cell";
    }

    const codeText = code.trim();
    if (!codeText) return "Empty code cell";

    const lower = codeText.toLowerCase();

    // If a preceding markdown cell exists, treat it as the explicit aim
    if (prevMarkdownText && prevMarkdownText.trim()) {
        const heading = prevMarkdownText.match(/^\s*#{1,6}\s+(.+)/m);
        const mdFirst = heading
            ? heading[1].trim()
            : (prevMarkdownText.split(/\r?\n/).find((l) => l.trim()) || "").trim();
        if (mdFirst) {
            // Keep it concise
            const concise = mdFirst.length > 140 ? mdFirst.slice(0, 137) + "…" : mdFirst;
            return concise;
        }
    }

    // 1) Environment/package setup
    if (/(^|\n)\s*(%pip|%conda|pip\s+install|conda\s+install)\b/.test(lower)) {
        return "Install packages";
    }

    // 2) Visualization intent
    const isViz = /\b(plt\.|sns\.|seaborn|plotly|px\.|bokeh|alt\.chart|hvplot|ggplot)\b/i.test(
        codeText
    );
    if (isViz) {
        const kinds: string[] = [];
        if (/scatter(plot)?\s*\(/i.test(codeText) || /\.scatter\(/i.test(codeText))
            kinds.push("scatter");
        if (/(^|\.)plot\(/i.test(codeText) || /lineplot\s*\(/i.test(codeText))
            kinds.push("line");
        if (/bar(plot)?\s*\(/i.test(codeText)) kinds.push("bar");
        if (/hist(ogram)?\s*\(/i.test(codeText)) kinds.push("hist");
        if (/heatmap\s*\(/i.test(codeText)) kinds.push("heatmap");
        const suffix = kinds.length ? ` (${kinds.slice(0, 3).join(", ")}${
            kinds.length > 3 ? ", …" : ""
        })` : "";
        return `Create visualization${suffix}`;
    }

    // 3) Model training intent
    const mentionsSklearn = /sklearn|scikit-learn/i.test(codeText);
    const mentionsTorch = /torch\./i.test(codeText);
    const mentionsTF = /tensorflow|keras/i.test(codeText);
    const hasFitCalls = /(^|\W)fit\s*\(/i.test(codeText) || /trainer\.(fit|train)\s*\(/i.test(codeText) || /model\.fit\s*\(/i.test(codeText);
    if (hasFitCalls || (mentionsTorch && /optimizer|loss|backward\s*\(/i.test(codeText))) {
        const libs: string[] = [];
        if (mentionsSklearn) libs.push("scikit-learn");
        if (mentionsTorch) libs.push("PyTorch");
        if (mentionsTF) libs.push("TensorFlow/Keras");
        const suffix = libs.length ? ` (${libs.join(", ")})` : "";
        return `Train model${suffix}`;
    }

    // 4) Data IO intent
    if (reads.length > 0 && writes.length > 0) {
        const out = writes.map((p) => formatResourceLabel(p));
        const short = out.slice(0, 2).join(", ");
        return `Transform and save data → ${short}${writes.length > 2 ? ", …" : ""}`;
    }
    if (writes.length > 0) {
        const out = writes.map((p) => formatResourceLabel(p));
        const short = out.slice(0, 2).join(", ");
        return `Write data → ${short}${writes.length > 2 ? ", …" : ""}`;
    }
    if (reads.length > 0) {
        const inp = reads.map((p) => formatResourceLabel(p));
        const short = inp.slice(0, 2).join(", ");
        return `Load data ← ${short}${reads.length > 2 ? ", …" : ""}`;
    }

    // 5) Data transformation intent (pandas/numpy common ops)
    if (
        /(groupby|merge|join|concat|pivot|melt|assign|rename|drop|fillna|astype|apply|agg|map|filter|select)/i.test(
            codeText
        )
    ) {
        return "Transform data";
    }

    // 6) Definitions
    const funcDefs = Array.from(codeText.matchAll(/^\s*def\s+([a-zA-Z_][\w]*)\s*\(/gm)).map(
        (m) => m[1]
    );
    if (funcDefs.length > 0) {
        const short = funcDefs.slice(0, 2).join(", ");
        return `Define function${funcDefs.length > 1 ? "s" : ""}: ${short}${
            funcDefs.length > 2 ? ", …" : ""
        }`;
    }
    const classDefs = Array.from(codeText.matchAll(/^\s*class\s+([a-zA-Z_][\w]*)\s*[(:]/gm)).map(
        (m) => m[1]
    );
    if (classDefs.length > 0) {
        const short = classDefs.slice(0, 2).join(", ");
        return `Define class${classDefs.length > 1 ? "es" : ""}: ${short}${
            classDefs.length > 2 ? ", …" : ""
        }`;
    }

    // 7) Computations producing variables
    if (outputs.length > 0) {
        const short = outputs.slice(0, 3).join(", ");
        return `Compute: ${short}${outputs.length > 3 ? ", …" : ""}`;
    }

    // 8) Exploration/printing
    if (/(print\s*\(|display\s*\(|head\s*\(|describe\s*\()/i.test(codeText)) {
        return "Inspect/display data";
    }

    // 9) Fallback: first meaningful line
    const first = codeText.split(/\r?\n/).find((l) => l.trim() && !/^\s*#/.test(l));
    return first ? first.trim() : "Code cell";
}

function computeGraph(
	cells: NotebookCell[],
	cellStates: CellState[]
): { nodes: NodeData[]; edges: EdgeData[] } {
	const nodes: NodeData[] = cells.map((cell, index) => {
		const code =
			cell.cell_type === "code" ? extractCode(cell, cellStates[index]) : "";
		const importAliases = cell.cell_type === "code" ? extractImportAliases(code) : [];
		const importAliasSet = new Set(importAliases);
		const outputs = cell.cell_type === "code"
			? extractOutputs(code)
					.filter((name) => !importAliasSet.has(name))
					.sort()
			: [];
		const exclusionSet = new Set<string>([...outputs, ...importAliasSet]);
		const inputsRaw = cell.cell_type === "code"
			? extractInputs(code, exclusionSet)
					.filter((name) => !importAliasSet.has(name))
					.sort()
			: [];
		const { reads, writes } = cell.cell_type === "code"
			? extractResourceUsage(code)
			: { reads: [] as string[], writes: [] as string[] };
		const hasError = !!(cell.outputs || []).some(
			(o: any) => o?.output_type === "error"
		);
        const label = cell.cell_type === "markdown" ? "MARKDOWN" : "CODE";
        const prevMarkdownText =
            index > 0 && cells[index - 1]?.cell_type === "markdown"
                ? extractCode(cells[index - 1])
                : undefined;
        const summary = inferAimSummary(
            cell,
            code,
            inputsRaw,
            outputs,
            reads,
            writes,
            prevMarkdownText
        );

		return {
			index,
			x: 0,
			y: 0,
			width: CARD_WIDTH,
			height: CARD_HEIGHT,
			inputsRaw,
			inputVars: [],
			outputVars: outputs,
			resourceReads: reads,
			resourceWrites: writes,
			hasError,
			isMarkdown: cell.cell_type === "markdown",
			label,
			summary,
		};
	});

	const lastProducer = new Map<string, number>();
	const resourceWriter = new Map<string, number>();
	const resourceEdgeMap = new Map<string, { source: number; target: number; paths: Set<string> }>();
	const edges: EdgeData[] = [];
	for (const node of nodes) {
		const inbound = new Map<number, string[]>();
		for (const v of node.inputsRaw) {
			const src = lastProducer.get(v);
			if (src != null && src < node.index) {
				const arr = inbound.get(src) || [];
				arr.push(v);
				inbound.set(src, arr);
			}
		}
		for (const [src, vars] of inbound) {
			edges.push({
				source: src,
				target: node.index,
				vars: Array.from(new Set(vars)),
				kind: "data",
			});
		}
		for (const v of node.outputVars) lastProducer.set(v, node.index);

		for (const path of node.resourceReads) {
			const writer = resourceWriter.get(canonicalResourceKey(path));
			if (writer != null && writer !== node.index) {
				const key = `${writer}->${node.index}`;
				let entry = resourceEdgeMap.get(key);
				if (!entry) {
					entry = { source: writer, target: node.index, paths: new Set<string>() };
					resourceEdgeMap.set(key, entry);
				}
				entry.paths.add(path);
			}
		}

		for (const path of node.resourceWrites) {
			resourceWriter.set(canonicalResourceKey(path), node.index);
		}
	}

	for (const entry of resourceEdgeMap.values()) {
		edges.push({
			source: entry.source,
			target: entry.target,
			vars: Array.from(entry.paths).sort(),
			kind: "resource",
		});
	}

	// Simple hierarchical placement by dependency depth
	const indeg = new Map<number, number>();
	nodes.forEach((n) => indeg.set(n.index, 0));
	edges.forEach((edge) => {
		if (edge.kind === "data") {
			indeg.set(edge.target, (indeg.get(edge.target) || 0) + 1);
		}
	});
	const queue: number[] = [];
	nodes.forEach((n) => {
		if ((indeg.get(n.index) || 0) === 0) queue.push(n.index);
	});
	const order: number[] = [];
	const adjacency = new Map<number, number[]>();
	edges.forEach((edge) => {
		if (edge.kind === "data") {
			const arr = adjacency.get(edge.source) || [];
			arr.push(edge.target);
			adjacency.set(edge.source, arr);
		}
	});
	while (queue.length) {
		const current = queue.shift()!;
		order.push(current);
		for (const next of adjacency.get(current) || []) {
			indeg.set(next, (indeg.get(next) || 0) - 1);
			if ((indeg.get(next) || 0) === 0) queue.push(next);
		}
	}

	const levelUses = new Map<number, number>();
	const levels: number[] = [];
	for (const node of nodes) {
		let lvl = 0;
		edges.forEach((edge) => {
			if (edge.kind === "data" && edge.target === node.index) {
				const srcLvl = levels[edge.source] ?? 0;
				lvl = Math.max(lvl, srcLvl + 1);
			}
		});
		levels[node.index] = lvl;
		const countInLevel = levelUses.get(lvl) || 0;
		const colOffset = countInLevel % MAX_PER_ROW;
		const rowOffset = Math.floor(countInLevel / MAX_PER_ROW);
		levelUses.set(lvl, countInLevel + 1);

		node.x = BASE_LEFT + lvl * COLUMN_SPACING + colOffset * SIBLING_SPACING;
		node.y = BASE_TOP + lvl * LEVEL_VERTICAL_SPACING + rowOffset * ROW_SPACING;
	}

	const inboundVarsByNode = new Map<number, Set<string>>();
	edges.forEach((edge) => {
		if (edge.kind !== "data") return;
		const set = inboundVarsByNode.get(edge.target) || new Set<string>();
		edge.vars.forEach((v) => set.add(v));
		inboundVarsByNode.set(edge.target, set);
	});

	for (const node of nodes) {
		node.inputVars = Array.from(inboundVarsByNode.get(node.index) || new Set<string>()).sort();
	}

	return { nodes, edges };

}

export const NotebookCanvas: React.FC<NotebookCanvasProps> = ({
	filePath,
	cells,
	cellStates,
	onOpenCell,
}) => {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [translate, setTranslate] = useState({ x: 0, y: 0 });
	const [scale, setScale] = useState(1);
	const [dragging, setDragging] = useState<null | {
		id: number;
		offsetX: number;
		offsetY: number;
	}>(null);
	const [panning, setPanning] = useState<null | {
		startX: number;
		startY: number;
		originX: number;
		originY: number;
	}>(null);
	const [selected, setSelected] = useState<number | null>(null);
	const [positions, setPositions] = useState<
		Record<number, { x: number; y: number }>
	>({});
	const [runningCells, setRunningCells] = useState<Set<number>>(
		() => new Set()
	);
	const [commandText, setCommandText] = useState("");
	const [commandFeedback, setCommandFeedback] = useState<
		{ tone: CommandOutcome; message: string } | null
	>(null);
	const [commandHistory, setCommandHistory] = useState<CommandHistoryEntry[]>([]);
	const historyIdRef = useRef(0);
	const commandInputRef = useRef<HTMLInputElement | null>(null);

	const { nodes, edges } = useMemo(
		() => computeGraph(cells, cellStates),
		[cells, cellStates]
	);

	const placedNodes = useMemo(() => {
		return nodes.map((node) => ({
			...node,
			x: positions[node.index]?.x ?? node.x,
			y: positions[node.index]?.y ?? node.y,
		}));
	}, [nodes, positions]);

	const totalCells = nodes.length;

	const connectionInfo = useMemo(() => {
		const incoming = new Map<number, { data: Set<number>; resource: Set<number> }>();
		const outgoing = new Map<number, { data: Set<number>; resource: Set<number> }>();

		edges.forEach((edge) => {
			const sourceEntry = outgoing.get(edge.source) || { data: new Set<number>(), resource: new Set<number>() };
			const targetEntry = incoming.get(edge.target) || { data: new Set<number>(), resource: new Set<number>() };
			if (edge.kind === "resource") {
				sourceEntry.resource.add(edge.target);
				targetEntry.resource.add(edge.source);
			} else if (edge.kind === "data") {
				sourceEntry.data.add(edge.target);
				targetEntry.data.add(edge.source);
			}
			outgoing.set(edge.source, sourceEntry);
			incoming.set(edge.target, targetEntry);
		});

		return { incoming, outgoing };
	}, [edges]);

	useEffect(() => {
		const completeCleanup = EventManager.createManagedListener(
			"notebook-cell-run-complete",
			(event) => {
				const { filePath: eventPath, cellIndex } = event.detail || {};
				if (eventPath === filePath && typeof cellIndex === "number") {
					setRunningCells((prev) => {
						const next = new Set(prev);
						next.delete(cellIndex);
						return next;
					});
				}
			}
		);

		const stopCleanup = EventManager.createManagedListener(
			"notebook-cell-run-stopped",
			(event) => {
				const { filePath: eventPath, cellIndex } = event.detail || {};
				if (eventPath === filePath && typeof cellIndex === "number") {
					setRunningCells((prev) => {
						const next = new Set(prev);
						next.delete(cellIndex);
						return next;
					});
				}
			}
		);

		return () => {
			completeCleanup();
			stopCleanup();
		};
	}, [filePath]);

	useEffect(() => {
		if (!commandFeedback) return;
		const timer = window.setTimeout(() => setCommandFeedback(null), 5000);
		return () => window.clearTimeout(timer);
	}, [commandFeedback]);

	useEffect(() => {
		commandInputRef.current?.focus();
	}, []);

	const toWorld = useCallback(
		(clientX: number, clientY: number) => {
			const rect = containerRef.current?.getBoundingClientRect();
			const x = (clientX - (rect?.left || 0) - translate.x) / scale;
			const y = (clientY - (rect?.top || 0) - translate.y) / scale;
			return { x, y };
		},
		[translate, scale]
	);

	const onWheel = useCallback(
		(event: WheelEvent) => {
			event.preventDefault();
			const MIN_SCALE = 0.6;
			const MAX_SCALE = 2.4;
			const delta = -event.deltaY;
			const factor = Math.exp(delta * 0.001);
			const rect = containerRef.current?.getBoundingClientRect();
			const cx = (event.clientX - (rect?.left || 0) - translate.x) / scale;
			const cy = (event.clientY - (rect?.top || 0) - translate.y) / scale;
			const nextScale = Math.min(
				MAX_SCALE,
				Math.max(MIN_SCALE, scale * factor)
			);
			const nx = event.clientX - (rect?.left || 0) - cx * nextScale;
			const ny = event.clientY - (rect?.top || 0) - cy * nextScale;
			setScale(nextScale);
			setTranslate({ x: nx, y: ny });
		},
		[scale, translate]
	);

	const zoomCanvas = useCallback(
		(direction: ZoomDirection) => {
			const MIN_SCALE = 0.6;
			const MAX_SCALE = 2.4;
			if (direction === "reset") {
				setScale(1);
				setTranslate({ x: 0, y: 0 });
				return;
			}
			setScale((prev) => {
				const factor = direction === "in" ? 1.2 : 1 / 1.2;
				return Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * factor));
			});
		},
		[]
	);

	const centerOnCell = useCallback(
		(index: number) => {
			const node = placedNodes[index];
			const container = containerRef.current;
			if (!node || !container) return;
			const rect = container.getBoundingClientRect();
			const targetX = node.x + node.width / 2;
			const targetY = node.y + node.height / 2;
			const nextX = rect.width / 2 - targetX * scale;
			const nextY = rect.height / 2 - targetY * scale;
			setTranslate({ x: nextX, y: nextY });
		},
		[placedNodes, scale]
	);

	const recordCommand = useCallback(
		(command: string, outcome: CommandOutcome, message: string) => {
			historyIdRef.current += 1;
			const entry: CommandHistoryEntry = {
				id: historyIdRef.current,
				command,
				message,
				outcome,
				timestamp: Date.now(),
			};
			setCommandHistory((prev) => [entry, ...prev].slice(0, 5));
			setCommandFeedback({ tone: outcome, message });
		},
		[]
	);

	const dispatchAddCell = useCallback(
		(cellType: "code" | "markdown", content?: string, options: AddCellOptions = {}) => {
			const payload = {
				filePath,
				cellType,
				content:
					typeof content === "string"
						? content
						: cellType === "markdown"
						? DEFAULT_SUMMARY_MARKDOWN
						: "",
				insertAfter:
					typeof options.insertAfter === "number" ? options.insertAfter : undefined,
			};
			EventManager.dispatchEvent("add-notebook-cell", payload);
		},
		[filePath]
	);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const handler = (event: WheelEvent) => onWheel(event);
		el.addEventListener("wheel", handler, { passive: false });
		return () => {
			el.removeEventListener("wheel", handler);
		};
	}, [onWheel]);

	const onBackgroundMouseDown = useCallback(
		(event: React.MouseEvent) => {
			if (event.button === 0 || event.button === 1 || event.shiftKey) {
				setPanning({
					startX: event.clientX,
					startY: event.clientY,
					originX: translate.x,
					originY: translate.y,
				});
			}
		},
		[translate]
	);

	const onMouseMove = useCallback(
		(event: React.MouseEvent) => {
			if (panning) {
				const dx = event.clientX - panning.startX;
				const dy = event.clientY - panning.startY;
				setTranslate({ x: panning.originX + dx, y: panning.originY + dy });
			} else if (dragging) {
				const { x, y } = toWorld(event.clientX, event.clientY);
				setPositions((prev) => ({
					...prev,
					[dragging.id]: { x: x - dragging.offsetX, y: y - dragging.offsetY },
				}));
			}
		},
		[panning, dragging, toWorld]
	);

	const onMouseUp = useCallback(() => {
		setPanning(null);
		setDragging(null);
	}, []);

	const handleNodeMouseDown = (
		index: number,
		event: React.MouseEvent,
		node: { x: number; y: number }
	) => {
		setSelected(index);
		const { x, y } = toWorld(event.clientX, event.clientY);
		setDragging({ id: index, offsetX: x - node.x, offsetY: y - node.y });
		event.stopPropagation();
	};

	const handleRunCell = useCallback(
		(index: number, isMarkdown: boolean) => {
			if (isMarkdown) return;
			setRunningCells((prev) => {
				const next = new Set(prev);
				next.add(index);
				return next;
			});
			try {
				EventManager.dispatchEvent("run-notebook-cell", {
					filePath,
					cellIndex: index,
				});
			} catch (error) {
				console.error("Failed to run notebook cell from canvas", error);
				setRunningCells((prev) => {
					const next = new Set(prev);
					next.delete(index);
					return next;
				});
			}
		},
		[filePath]
	);

	const handleStopCell = useCallback(
		(index: number) => {
			setRunningCells((prev) => {
				const next = new Set(prev);
				next.delete(index);
				return next;
			});
			try {
				EventManager.dispatchEvent("stop-notebook-cell", {
					filePath,
					cellIndex: index,
				});
			} catch (error) {
				console.error("Failed to stop notebook cell from canvas", error);
			}
		},
		[filePath]
	);

	const runCellsRange = useCallback(
		(start: number, end: number) => {
			if (totalCells === 0) {
				return { executed: 0, skipped: 0, from: 0, to: 0 };
			}
			let from = Math.max(0, Math.min(start, totalCells - 1));
			let to = Math.max(0, Math.min(end, totalCells - 1));
			if (from > to) {
				[from, to] = [to, from];
			}
			let executed = 0;
			let skipped = 0;
			for (let idx = from; idx <= to; idx += 1) {
				const node = nodes[idx];
				if (!node || node.isMarkdown) {
					skipped += 1;
					continue;
				}
				handleRunCell(idx, node.isMarkdown);
				executed += 1;
			}
			return { executed, skipped, from, to };
		},
		[handleRunCell, nodes, totalCells]
	);

	const stopCellsByScope = useCallback(
		(scope: "selected" | "index" | "all", index?: number) => {
			if (scope === "selected") {
				if (selected == null) {
					return {
						success: false,
						message: "No cell is currently selected.",
					};
				}
				handleStopCell(selected);
				return {
					success: true,
					message: `Stopped cell #${selected + 1}.`,
				};
			}
			if (scope === "index" && typeof index === "number") {
				if (index < 0 || index >= totalCells) {
					return {
						success: false,
						message: "That cell number is outside the notebook range.",
					};
				}
				handleStopCell(index);
				return {
					success: true,
					message: `Stopped cell #${index + 1}.`,
				};
			}
			if (scope === "all") {
				const indices = Array.from(runningCells);
				indices.forEach((idx) => handleStopCell(idx));
				if (indices.length === 0) {
					return {
						success: false,
						message: "No cells are running right now.",
					};
				}
				return {
					success: true,
					message: `Stopped ${indices.length} running cell${indices.length === 1 ? "" : "s"}.`,
				};
			}
			return {
				success: false,
				message: "Unable to match that stop command.",
			};
		},
		[handleStopCell, runningCells, selected, totalCells]
	);

	const selectCellByIndex = useCallback(
		(index: number, options: { center?: boolean } = {}) => {
			if (index < 0 || index >= totalCells) {
				return false;
			}
			setSelected(index);
			if (options.center) {
				centerOnCell(index);
			}
			return true;
		},
		[centerOnCell, totalCells]
	);

	const handleAddFollowUpCell = useCallback(
		(node: NodeData) => {
			const template = buildFollowUpCode(node);
			dispatchAddCell("code", template, { insertAfter: node.index });
			setCommandFeedback({
				tone: "success",
				message: `Added a follow-up code cell after #${node.index + 1}.`,
			});
		},
		[dispatchAddCell]
	);

	const handleAddSummaryCell = useCallback(
		(node: NodeData) => {
			const summaryMarkdown = buildMarkdownSummary(node);
			dispatchAddCell("markdown", summaryMarkdown, { insertAfter: node.index });
			setCommandFeedback({
				tone: "success",
				message: `Added a markdown summary after cell #${node.index + 1}.`,
			});
		},
		[dispatchAddCell]
	);

	const handleCreateCellFromOutput = useCallback(
		(node: NodeData, outputName: string) => {
			const snippet = buildOutputExplorationSnippet(node, outputName);
			dispatchAddCell("code", snippet, { insertAfter: node.index });
			setCommandFeedback({
				tone: "success",
				message: `Added a new code cell to explore '${outputName}'.`,
			});
		},
		[dispatchAddCell]
	);

	const executeCommand = useCallback(
		(raw: string) => {
			const parsed = interpretCommand(raw);
			switch (parsed.kind) {
				case "run-all": {
					if (totalCells === 0) {
						recordCommand(raw, "info", "This notebook does not have any cells yet.");
						return;
					}
					const { executed, skipped } = runCellsRange(0, totalCells - 1);
					const msg = executed > 0
						? `Running all ${totalCells} cells (${executed} code, ${skipped} skipped).`
						: "Nothing to run — every cell in that range is markdown.";
					recordCommand(raw, executed > 0 ? "success" : "info", msg);
					return;
				}
				case "run-range": {
					if (totalCells === 0) {
						recordCommand(raw, "info", "This notebook does not have any cells yet.");
						return;
					}
					const { executed, skipped, from, to } = runCellsRange(parsed.start, parsed.end);
					const label = `cells ${from + 1}–${to + 1}`;
					const msg = executed > 0
						? `Running ${label}: ${executed} code cell${executed === 1 ? "" : "s"}${
								 skipped ? `, ${skipped} markdown skipped` : ""
							}`
						: `No runnable code found in ${label}.`;
					recordCommand(raw, executed > 0 ? "success" : "info", msg);
					return;
				}
				case "run-cell": {
					if (parsed.index < 0 || parsed.index >= totalCells) {
						recordCommand(raw, "error", "That cell number is outside the notebook range.");
						return;
					}
					const node = nodes[parsed.index];
					if (!node || node.isMarkdown) {
						recordCommand(raw, "error", "Markdown cells cannot be executed.");
						return;
					}
					handleRunCell(parsed.index, node.isMarkdown);
					recordCommand(raw, "success", `Running cell #${parsed.index + 1}.`);
					return;
				}
				case "run-selected": {
					if (selected == null) {
						recordCommand(raw, "error", "Select a cell first, then try again.");
						return;
					}
					const node = nodes[selected];
					if (!node || node.isMarkdown) {
						recordCommand(raw, "error", "The selected cell is markdown and cannot run.");
						return;
					}
					handleRunCell(selected, node.isMarkdown);
					recordCommand(raw, "success", `Running selected cell #${selected + 1}.`);
					return;
				}
				case "stop-cell": {
					const result = stopCellsByScope(parsed.scope, parsed.index);
					recordCommand(raw, result.success ? "success" : "info", result.message);
					return;
				}
				case "open-cell": {
					if (parsed.index < 0 || parsed.index >= totalCells) {
						recordCommand(raw, "error", "That cell number is outside the notebook range.");
						return;
					}
					setSelected(parsed.index);
					centerOnCell(parsed.index);
					onOpenCell?.(parsed.index);
					recordCommand(raw, "success", `Opened cell #${parsed.index + 1} in developer view.`);
					return;
				}
				case "select-cell": {
					if (selectCellByIndex(parsed.index, { center: true })) {
						recordCommand(raw, "success", `Selected cell #${parsed.index + 1}.`);
					} else {
						recordCommand(raw, "error", "That cell number is outside the notebook range.");
					}
					return;
				}
				case "clear-selection": {
					if (selected == null) {
						recordCommand(raw, "info", "No cell was selected.");
					} else {
						setSelected(null);
						recordCommand(raw, "success", "Cleared the selected cell.");
					}
					return;
				}
				case "add-cell": {
					dispatchAddCell(parsed.cellType, parsed.content);
					const label = parsed.cellType === "markdown" ? "markdown" : "code";
					recordCommand(
						raw,
						"success",
						`Added a new ${label} cell at the end of the notebook.`
					);
					return;
				}
				case "zoom": {
					zoomCanvas(parsed.direction);
					const directionLabel =
						parsed.direction === "in"
							? "Zooming in."
						: parsed.direction === "out"
						? "Zooming out."
						: "Resetting zoom.";
					recordCommand(raw, "info", directionLabel);
					return;
				}
				case "help": {
					recordCommand(
						raw,
						"info",
						"Try commands like: run all cells, add markdown summary, select cell 3, zoom in, stop all."
					);
					return;
				}
				case "unknown":
				default: {
					recordCommand(
						raw,
						"error",
						"I did not understand that. Type 'help' to see examples."
					);
					return;
				}
			}
		},
		[
			centerOnCell,
			dispatchAddCell,
			handleRunCell,
			nodes,
			onOpenCell,
			recordCommand,
			runCellsRange,
			selectCellByIndex,
			selected,
			stopCellsByScope,
			totalCells,
			zoomCanvas,
		]
	);

	const handleCommandSubmit = useCallback(
		(event?: React.FormEvent<HTMLFormElement>) => {
			event?.preventDefault();
			const value = commandText.trim();
			if (!value) {
				setCommandFeedback({
					tone: "info",
					message: "Type a command like 'run all cells' or 'add markdown summary'.",
				});
				return;
			}
			executeCommand(value);
			setCommandText("");
			commandInputRef.current?.focus();
		},
		[commandText, executeCommand]
	);

	const handleCommandChange = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			setCommandText(event.target.value);
		},
		[]
	);

	const handleQuickCommand = useCallback(
		(command: string) => {
			executeCommand(command);
			commandInputRef.current?.focus();
		},
		[executeCommand]
	);

	const quickActions = useMemo(
		() => {
			const entries: Array<{
				label: string;
				command: string;
				disabled?: boolean;
				title?: string;
			}> = [];
			const selectedNode = selected != null ? nodes[selected] : undefined;
			entries.push({
				label:
					selected != null
						? `Run cell #${selected + 1}`
						: "Run selected cell",
				command: "run selected cell",
				disabled: selected == null || !!selectedNode?.isMarkdown,
				title:
					selected == null
						? "Click any cell to select it first"
						: selectedNode?.isMarkdown
						? "Markdown cells cannot run"
						: undefined,
			});
			entries.push({
				label: "Run all cells",
				command: "run all cells",
				disabled: totalCells === 0,
				title: totalCells === 0 ? "This notebook does not have any cells yet" : undefined,
			});
			entries.push({
				label: "Add markdown summary",
				command: "add markdown summary",
			});
			entries.push({
				label: "Reset zoom",
				command: "reset zoom",
			});
			return entries;
		},
		[nodes, selected, totalCells]
	);

	const renderEdges = () => {
		return edges.map((edge, idx) => {
			const source = placedNodes[edge.source];
			const target = placedNodes[edge.target];
			if (!source || !target) return null;
			const sx = source.x + source.width;
			const sy = source.y + source.height / 2;
			const tx = target.x;
			const ty = target.y + target.height / 2;
			const dx = Math.max(60, Math.abs(tx - sx) * 0.45);
			const c1x = sx + dx;
			const c1y = sy;
			const c2x = tx - dx;
			const c2y = ty;
			const label = (() => {
				if (edge.kind === "data") {
					const vars = edge.vars.slice(0, 3).join(", ");
					return vars + (edge.vars.length > 3 ? ", …" : "");
				}
				if (edge.kind === "resource") {
					const formatted = edge.vars
						.map((p) => `📁 ${formatResourceLabel(p)}`)
						.slice(0, 2)
						.join(", ");
					return formatted + (edge.vars.length > 2 ? ", …" : "");
				}
				return "";
			})();
			const midX = (sx + tx) / 2;
			const midY = (sy + ty) / 2;
			const labelWidth = Math.max(48, label.length * 6.2);
			const labelHeight = 16;

			return (
				<g key={`edge-${idx}`}>
					<path
						d={`M ${sx},${sy} C ${c1x},${c1y} ${c2x},${c2y} ${tx},${ty}`}
						stroke={
							edge.kind === "data"
								? "#66b3ff"
							: edge.kind === "resource"
								? "#facc15"
								: "#7a7a7a"
						}
						strokeWidth={edge.kind === "data" ? 2 : edge.kind === "resource" ? 2 : 1.1}
						fill="none"
						opacity={edge.kind === "data" ? 0.92 : edge.kind === "resource" ? 0.88 : 0.6}
						markerEnd={
							edge.kind === "data"
								? "url(#canvas-arrow)"
							: edge.kind === "resource"
								? "url(#canvas-arrow-resource)"
								: undefined
						}
					/>
					{label && (
						<g>
							<rect
								x={midX - labelWidth / 2}
								y={midY - labelHeight - 2}
								width={labelWidth}
								height={labelHeight}
								rx={6}
								ry={6}
								fill={
									edge.kind === "resource"
										? "rgba(70, 48, 5, 0.85)"
										: "rgba(17, 32, 48, 0.8)"
								}
								stroke={
									edge.kind === "resource"
										? "rgba(250, 204, 21, 0.7)"
										: "rgba(102, 179, 255, 0.6)"
								}
								strokeWidth={0.6}
							/>
							<text
								x={midX}
								y={midY - labelHeight / 2}
								fill={edge.kind === "resource" ? "#fff6d6" : "#d4ebff"}
								fontSize={10}
								textAnchor="middle"
							>
								{label}
							</text>
						</g>
					)}
				</g>
			);
		});
	};

	return (
		<CanvasWrapper
			ref={containerRef}
			onMouseMove={onMouseMove}
			onMouseUp={onMouseUp}
			onMouseLeave={onMouseUp}
			onMouseDown={onBackgroundMouseDown}
		>
			<CommandPanel
				onMouseDown={(event) => event.stopPropagation()}
				onClick={(event) => event.stopPropagation()}
			>
				<CommandHeader>
					<CommandTitle>Notebook Command Center</CommandTitle>
					<CommandDescription>
						Control execution, add new context, or adjust the canvas using everyday
						language.
					</CommandDescription>
				</CommandHeader>
				<CommandForm onSubmit={handleCommandSubmit}>
					<CommandInput
						ref={commandInputRef}
						value={commandText}
						onChange={handleCommandChange}
						placeholder="e.g. Run cells 2 to 5"
						spellCheck={false}
					/>
					<CommandSubmitButton type="submit" disabled={!commandText.trim()}>
						Run
					</CommandSubmitButton>
				</CommandForm>
				<CommandHint>
					Try commands like "Run all cells", "Add markdown summary", "Select cell 3", or "Reset zoom" — and click
					an output badge on any card to spawn a connected cell.
				</CommandHint>
				<QuickActionRow>
					{quickActions.map((action) => (
						<QuickActionChip
							type="button"
							key={action.label}
							disabled={action.disabled}
							title={action.title}
							onClick={() => !action.disabled && handleQuickCommand(action.command)}
						>
							{action.label}
						</QuickActionChip>
					))}
				</QuickActionRow>
				{commandFeedback && (
					<CommandFeedback $tone={commandFeedback.tone}>
						{commandFeedback.message}
					</CommandFeedback>
				)}
				{commandHistory.length > 0 && (
					<CommandHistoryList>
						{commandHistory.map((entry) => (
							<CommandHistoryItem key={entry.id} $tone={entry.outcome}>
								<span>{entry.command}</span>
								<HistoryMessage>{entry.message}</HistoryMessage>
								<HistoryTimestamp>
									{new Date(entry.timestamp).toLocaleTimeString([], {
										hour: "2-digit",
										minute: "2-digit",
										second: "2-digit",
									})}
								</HistoryTimestamp>
							</CommandHistoryItem>
						))}
					</CommandHistoryList>
				)}
			</CommandPanel>
			<Grid
				style={{
					transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
					transformOrigin: "0 0",
				}}
			/>
			<SvgOverlay>
				<defs>
					<marker
						id="canvas-arrow"
						viewBox="0 0 16 16"
						refX="14"
						refY="8"
						markerUnits="userSpaceOnUse"
						markerWidth="16"
						markerHeight="16"
						orient="auto-start-reverse"
					>
						<path d="M 0 0 L 16 8 L 0 16 z" fill="#66b3ff" />
					</marker>
					<marker
						id="canvas-arrow-resource"
						viewBox="0 0 16 16"
						refX="14"
						refY="8"
						markerUnits="userSpaceOnUse"
						markerWidth="16"
						markerHeight="16"
						orient="auto-start-reverse"
					>
						<path d="M 0 0 L 16 8 L 0 16 z" fill="#facc15" />
					</marker>
				</defs>
				<g
					transform={`translate(${translate.x}, ${translate.y}) scale(${scale})`}
				>
					{renderEdges()}
				</g>
			</SvgOverlay>
			<Viewport
				style={{
					transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
				}}
			>
				{placedNodes.map((node) => {
					const running = runningCells.has(node.index);
					const outputText = cellStates[node.index]?.output || "";
					const orderedResourceReads = [...node.resourceReads].sort();
					const orderedResourceWrites = [...node.resourceWrites].sort();
					const inputVarDisplay = node.inputVars.slice(0, MAX_DISPLAY_INPUT_ITEMS);
					const remainingInputSlots = Math.max(
						0,
						MAX_DISPLAY_INPUT_ITEMS - inputVarDisplay.length
					);
					const inputResourceDisplay = orderedResourceReads.slice(0, remainingInputSlots);
					const totalInputCount =
						node.inputVars.length + orderedResourceReads.length;
					const displayedInputCount =
						inputVarDisplay.length + inputResourceDisplay.length;
					const extraInputCount = Math.max(
						0,
						totalInputCount - displayedInputCount
					);

					const outputVarDisplay = node.outputVars.slice(0, MAX_DISPLAY_OUTPUT_ITEMS);
					const remainingOutputSlots = Math.max(
						0,
						MAX_DISPLAY_OUTPUT_ITEMS - outputVarDisplay.length
					);
					const outputResourceDisplay = orderedResourceWrites.slice(
						0,
						remainingOutputSlots
					);
			const totalOutputCount =
				node.outputVars.length + orderedResourceWrites.length;
			const displayedOutputCount =
				outputVarDisplay.length + outputResourceDisplay.length;
			const extraOutputCount = Math.max(
				0,
				totalOutputCount - displayedOutputCount
			);
			const upstreamInfo = connectionInfo.incoming.get(node.index);
			const downstreamInfo = connectionInfo.outgoing.get(node.index);
			const upstreamCount =
				(upstreamInfo?.data.size ?? 0) + (upstreamInfo?.resource.size ?? 0);
			const downstreamCount =
				(downstreamInfo?.data.size ?? 0) + (downstreamInfo?.resource.size ?? 0);
			const statusTone: "ok" | "warn" | "error" = node.hasError
				? "error"
				: running
				? "warn"
				: "ok";
			const statusLabel = node.hasError
				? "Needs attention"
				: running
				? "Running…"
				: "Ready";
			const moduleLabel = node.isMarkdown ? "Markdown module" : "Code module";
			const summaryText = node.summary || (node.isMarkdown ? "Markdown cell" : "Code cell");
			const inputLabel = totalInputCount === 1 ? "input" : "inputs";
			const outputLabel = totalOutputCount === 1 ? "output" : "outputs";
			const upstreamLabel = upstreamCount === 1 ? "upstream link" : "upstream links";
			const downstreamLabel = downstreamCount === 1 ? "downstream target" : "downstream targets";
			return (
						<NodeContainer
							key={node.index}
							$selected={selected === node.index}
							$error={node.hasError}
							style={{ left: node.x, top: node.y }}
							onMouseDown={(event) =>
								handleNodeMouseDown(node.index, event, node)
							}
							onDoubleClick={() => onOpenCell?.(node.index)}
						>
							<NodeHeader>
						<NodeHeaderContent>
							<NodeTopRow>
								<NumberBadge title="Cell number">#{node.index + 1}</NumberBadge>
								<NodeTypeIcon $variant={node.isMarkdown ? "markdown" : "code"}>
									{node.isMarkdown ? <FiFileText size={14} /> : <FiCpu size={14} />}
								</NodeTypeIcon>
								<NodeSummary>{summaryText}</NodeSummary>
							</NodeTopRow>
							<NodeTagRow>
								<NodeTag>
									<FiLayers size={11} /> {moduleLabel}
								</NodeTag>
								<NodeTag>
									<FiArrowRightCircle size={11} /> {totalInputCount} {inputLabel}
								</NodeTag>
								<NodeTag>
									<FiGitBranch size={11} /> {totalOutputCount} {outputLabel}
								</NodeTag>
								<StatusPill $tone={statusTone}>{statusLabel}</StatusPill>
							</NodeTagRow>
						</NodeHeaderContent>
						<HeaderActions>
							<ControlButton
								$variant="run"
								onMouseDown={(event) => event.stopPropagation()}
								onClick={() => handleRunCell(node.index, node.isMarkdown)}
								disabled={node.isMarkdown || running}
								title={
									node.isMarkdown ? "Markdown cells do not run" : "Run cell"
								}
							>
								<FiPlay size={12} /> Run
							</ControlButton>
							{running && (
								<ControlButton
									$variant="stop"
									onMouseDown={(event) => event.stopPropagation()}
									onClick={() => handleStopCell(node.index)}
									title="Stop cell"
								>
									<FiSquare size={12} /> Stop
								</ControlButton>
							)}
							<ActionButton
								$variant="ghost"
								type="button"
								onMouseDown={(event) => event.stopPropagation()}
								onClick={(event) => {
									event.stopPropagation();
									onOpenCell?.(node.index);
								}}
							>
								<FiExternalLink size={12} /> Open
							</ActionButton>
						</HeaderActions>
					</NodeHeader>
					<NodeBody>
						<PurposeBlock>
							<SectionLabel>Purpose</SectionLabel>
							<PurposeText>{summaryText}</PurposeText>
						</PurposeBlock>
						<div>
							<SectionLabel>Connections</SectionLabel>
							<ConnectionSummary>
								<ConnectionBadge>
									<FiGitBranch size={11} /> {upstreamCount} {upstreamLabel}
								</ConnectionBadge>
								<ConnectionBadge>
									<FiArrowRightCircle size={11} /> {downstreamCount} {downstreamLabel}
								</ConnectionBadge>
							</ConnectionSummary>
						</div>
						<div>
							<SectionLabel>Inputs</SectionLabel>
							<IOList>
								{inputVarDisplay.map((input) => (
									<IOBadge key={`in-${node.index}-${input}`}>
										{input}
									</IOBadge>
								))}
								{inputResourceDisplay.map((path) => (
									<IOBadge key={`in-res-${node.index}-${path}`}>
										R: {formatResourceLabel(path)}
									</IOBadge>
								))}
								{displayedInputCount === 0 && <span>No inputs</span>}
								{extraInputCount > 0 && (
									<IOBadge key={`in-extra-${node.index}`}>
										+{extraInputCount}
									</IOBadge>
								)}
							</IOList>
						</div>
						<div>
							<SectionLabel>Outputs</SectionLabel>
							<IOList>
								{outputVarDisplay.map((output) => (
									<IOBadgeButton
										type="button"
										title={`Create a follow-up cell using ${output}`}
										onMouseDown={(event) => event.stopPropagation()}
										onClick={(event) => {
										event.stopPropagation();
										handleCreateCellFromOutput(node, output);
									}}
									>
										{output}
									</IOBadgeButton>
								))}
								{outputResourceDisplay.map((path) => (
									<IOBadge key={`out-res-${node.index}-${path}`}>
										W: {formatResourceLabel(path)}
									</IOBadge>
								))}
								{displayedOutputCount === 0 && <span>No outputs</span>}
								{extraOutputCount > 0 && (
									<IOBadge key={`out-extra-${node.index}`}>
										+{extraOutputCount}
									</IOBadge>
								)}
							</IOList>
						</div>
						<ActionBar>
							<ActionButton
								$variant="primary"
								type="button"
								onMouseDown={(event) => event.stopPropagation()}
								onClick={(event) => {
									event.stopPropagation();
									handleAddFollowUpCell(node);
								}}
							>
								<FiPlus size={12} /> Follow-up cell
							</ActionButton>
							<ActionButton
								$variant="secondary"
								type="button"
								onMouseDown={(event) => event.stopPropagation()}
								onClick={(event) => {
									event.stopPropagation();
									handleAddSummaryCell(node);
								}}
							>
								<FiFileText size={12} /> Summary note
							</ActionButton>
						</ActionBar>
						{outputText && (
							<div>
								<SectionLabel>Recent Output</SectionLabel>
								<OutputPreview>
									{outputText.trim().split(/\r?\n/).slice(0, 6).join("\n")}
									{outputText.trim().split(/\r?\n/).length > 6 ? "\n…" : ""}
								</OutputPreview>
							</div>
						)}
					</NodeBody>

						</NodeContainer>
					);
				})}
			</Viewport>
		</CanvasWrapper>
	);
};

export default NotebookCanvas;
