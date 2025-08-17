import React from "react";
import styled from "styled-components";
import { typography } from "../../styles/design-system";
import type { LocalDatasetEntry } from "../../services/LocalDatasetRegistry";
import { FiFolder, FiX } from "react-icons/fi";
import { getFileTypeIcon } from "../shared/utils";

const MenuContainer = styled.div`
	position: absolute; /* positioned by parent */
	width: 320px; /* default width */
	max-width: 480px; /* prevent overflows */
	max-height: 200px; /* shorter */
	box-sizing: border-box;
	overflow-y: auto;
	overflow-x: hidden;
	background: #1e1e1e;
	border: 1px solid #2a2a2a;
	border-radius: 6px;
	box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
	z-index: 50;
`;

const SectionTitle = styled.div`
	padding: 8px 12px;
	color: #aaa;
	font-size: ${typography.sm};
	border-bottom: 1px solid #2a2a2a;
`;

const Item = styled.div<{ $active?: boolean }>`
	padding: 6px 10px; /* denser */
	display: flex;
	align-items: center;
	gap: 6px;
	cursor: pointer;
	flex-wrap: nowrap;
	white-space: nowrap;
	overflow: hidden;
	background: ${(p) => (p.$active ? "#2b2f3a" : "transparent")};
	&:hover {
		background: #2b2f3a;
	}
`;

const Alias = styled.span`
	color: #fff;
	font-size: ${typography.sm}; /* smaller */
	font-weight: 600;
	flex: 1 1 auto;
	min-width: 0; /* allow flex child to shrink for ellipsis */
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
`;

const Meta = styled.span`
	color: #888;
	font-size: 11px; /* extra small */
	flex: 0 1 auto;
	min-width: 0;
	margin-left: auto;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
`;

const Footer = styled.div`
	padding: 8px 12px;
	display: flex;
	gap: 8px;
	border-top: 1px solid #2a2a2a;
`;

const ActionButton = styled.button`
	background: #2a2a2a;
	color: #ddd;
	border: 1px solid #3a3a3a;
	border-radius: 6px;
	padding: 6px 10px;
	font-size: ${typography.sm};
	cursor: pointer;
	&:hover {
		background: #333;
	}
`;

export interface MentionSuggestionsProps {
	isOpen: boolean;
	items: LocalDatasetEntry[]; // pre-filtered and sorted local
	workspaceItems?: LocalDatasetEntry[]; // pre-filtered and sorted workspace
	hideWorkspace?: boolean; // hide the workspace section (useful for # cell-only)
	// Optional: notebook cell items (e.g., from active .ipynb)
	cellItems?: Array<{
		id: string;
		alias: string;
		title: string;
		localPath: string; // full notebook path
		cellIndex?: number; // 1-based index for display
	}>;
	query: string;
	onSelect: (item: LocalDatasetEntry) => void;
	onRemoveLocal?: (item: LocalDatasetEntry) => void; // optional removal handler for local registry items
	onSelectWorkspace?: (item: LocalDatasetEntry) => void;
	onSelectCell?: (item: {
		id: string;
		alias: string;
		title: string;
		localPath: string;
		cellIndex?: number;
	}) => void;
	activeLocalIndex?: number;
	activeWorkspaceIndex?: number;
	activeCellIndex?: number;
	left?: number;
	bottom?: number;
	hideLocal?: boolean;
	hideFolders?: boolean;
}

export const MentionSuggestions: React.FC<MentionSuggestionsProps> = ({
	isOpen,
	items,
	workspaceItems = [],
	hideWorkspace = false,
	cellItems = [],
	query,
	onSelect,
	onRemoveLocal,
	onSelectWorkspace,
	onSelectCell,
	activeLocalIndex = -1,
	activeWorkspaceIndex = -1,
	activeCellIndex = -1,
	left = 16,
	bottom = 105,
	hideLocal = false,
	hideFolders = false,
}) => {
	const q = (query || "").toLowerCase();
	const sorted = items || [];
	const shorten = (text: string, max: number = 26): string => {
		if (!text) return "";
		if (text.length <= max) return text;
		const head = Math.ceil((max - 1) / 2);
		const tail = Math.floor((max - 1) / 2);
		return text.slice(0, head) + "…" + text.slice(-tail);
	};

	const localItemRefs = React.useRef<HTMLDivElement[]>([]);
	const workspaceItemRefs = React.useRef<HTMLDivElement[]>([]);
	const cellItemRefs = React.useRef<HTMLDivElement[]>([]);

	React.useEffect(() => {
		// Reset refs when data length changes
		localItemRefs.current = [];
	}, [sorted.length]);

	React.useEffect(() => {
		workspaceItemRefs.current = [];
	}, [workspaceItems.length]);

	React.useEffect(() => {
		cellItemRefs.current = [];
	}, [cellItems.length]);

	React.useEffect(() => {
		if (activeLocalIndex >= 0) {
			const el = localItemRefs.current[activeLocalIndex];
			if (el) {
				el.scrollIntoView({ block: "nearest" });
			}
		}
	}, [activeLocalIndex, localItemRefs]);

	React.useEffect(() => {
		if (activeWorkspaceIndex >= 0) {
			const el = workspaceItemRefs.current[activeWorkspaceIndex];
			if (el) {
				el.scrollIntoView({ block: "nearest" });
			}
		}
	}, [activeWorkspaceIndex, workspaceItemRefs]);

	React.useEffect(() => {
		if (activeCellIndex >= 0) {
			const el = cellItemRefs.current[activeCellIndex];
			if (el) {
				el.scrollIntoView({ block: "nearest" });
			}
		}
	}, [activeCellIndex, cellItemRefs]);

	return (
		<MenuContainer
			role="listbox"
			aria-label="Mention suggestions"
			style={{ left, bottom, display: isOpen ? "block" : "none" }}
		>
			<div
				data-section="local"
				style={{ display: hideLocal ? "none" : "block" }}
			>
				<SectionTitle>
					{q ? `Local data matching "${query}"` : "Local data available to @"}
				</SectionTitle>
				{sorted.length === 0 ? (
					<Item>
						<Meta>No indexed local data yet</Meta>
					</Item>
				) : (
					sorted.map((d, i) => (
						<Item
							key={d.id}
							onClick={() => onSelect(d)}
							$active={i === activeLocalIndex}
							ref={(el: HTMLDivElement | null) => {
								if (el) localItemRefs.current[i] = el;
							}}
						>
							<Alias>
								{shorten(
									(d.alias || (d.title || d.id).replace(/\s+/g, "_")).replace(
										/^.*\//,
										""
									),
									20
								)}
							</Alias>
							<Meta>{shorten((d.title || d.id).replace(/^.*\//, ""), 24)}</Meta>
							{typeof onRemoveLocal === "function" && (
								<span
									title="Remove from local mentions"
									onClick={(e) => {
										e.stopPropagation();
										onRemoveLocal(d);
									}}
									style={{
										marginLeft: 8,
										color: "#888",
										display: "inline-flex",
										alignItems: "center",
									}}
								>
									<FiX size={14} />
								</span>
							)}
						</Item>
					))
				)}
			</div>

			<div
				data-section="workspace"
				style={{ display: hideWorkspace ? "none" : "block" }}
			>
				<SectionTitle>Workspace files</SectionTitle>
				{(workspaceItems || []).length === 0 ? (
					<Item>
						<Meta>No workspace matches</Meta>
					</Item>
				) : (
					(workspaceItems || [])
						.filter((d) => (hideFolders ? !d.isLocalDirectory : true))
						.map((d, i) => (
							<Item
								key={`ws-${d.id}`}
								onClick={() => onSelectWorkspace && onSelectWorkspace(d)}
								$active={i === activeWorkspaceIndex}
								ref={(el: HTMLDivElement | null) => {
									if (el) workspaceItemRefs.current[i] = el;
								}}
							>
								<span
									className="icon"
									style={{
										width: 14,
										display: "inline-flex",
										alignItems: "center",
										justifyContent: "center",
										color: "#888",
									}}
								>
									{!hideFolders && (d as any).isLocalDirectory ? (
										<FiFolder size={12} />
									) : (
										<span style={{ fontSize: 11 }}>
											{getFileTypeIcon(d.title || "")}
										</span>
									)}
								</span>
								<Alias>
									{shorten(
										d.alias || (d.title || d.id).replace(/\s+/g, "_"),
										42
									)}
								</Alias>
								<Meta>
									{shorten((d.title || d.id).replace(/^.*\//, ""), 24)}
								</Meta>
							</Item>
						))
				)}
			</div>

			<div
				data-section="cells"
				style={{ display: cellItems.length > 0 ? "block" : "none" }}
			>
				<SectionTitle>Notebook cells</SectionTitle>
				{cellItems.map((c, i) => (
					<Item
						key={`cell-${c.id}`}
						onClick={() => onSelectCell && onSelectCell(c)}
						$active={i === activeCellIndex}
						ref={(el: HTMLDivElement | null) => {
							if (el) cellItemRefs.current[i] = el;
						}}
					>
						<Alias>{shorten(c.alias, 42)}</Alias>
						<Meta>{shorten(c.title, 28)}</Meta>
					</Item>
				))}
			</div>
		</MenuContainer>
	);
};
