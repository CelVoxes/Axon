import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { FiX, FiCheck, FiFileText, FiDownload, FiZap } from "react-icons/fi";
import { typography } from "../../styles/design-system";

const ModalOverlay = styled.div`
	position: fixed;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	background: rgba(0, 0, 0, 0.8);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 2000;
`;

const ModalContent = styled.div`
	background: #2d2d30;
	border: 1px solid #404040;
	border-radius: 8px;
	width: min(600px, 90vw);
	max-height: 80vh;
	overflow-y: auto;
	box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);
`;

const ModalHeader = styled.div`
	padding: 20px;
	border-bottom: 1px solid #404040;
	display: flex;
	align-items: center;
	justify-content: between;
`;

const ModalTitle = styled.h2`
	margin: 0;
	color: #ffffff;
	font-size: ${typography.lg};
	font-weight: 600;
	display: flex;
	align-items: center;
	gap: 8px;
	flex: 1;
`;

const CloseButton = styled.button`
	background: none;
	border: none;
	color: #999;
	cursor: pointer;
	padding: 4px;
	border-radius: 4px;
	display: flex;
	align-items: center;
	justify-content: center;

	&:hover {
		color: #fff;
		background: #404040;
	}
`;

const ModalBody = styled.div`
	padding: 20px;
`;

const Section = styled.div`
	margin-bottom: 24px;

	&:last-child {
		margin-bottom: 0;
	}
`;

const SectionTitle = styled.h3`
	margin: 0 0 12px 0;
	color: #e5e7eb;
	font-size: ${typography.base};
	font-weight: 500;
`;

const CellSelectionGrid = styled.div`
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
	gap: 8px;
	max-height: 300px;
	overflow-y: auto;
	border: 1px solid #404040;
	border-radius: 4px;
	padding: 12px;
	background: #1e1e1e;
`;

const CellItem = styled.label<{ selected: boolean }>`
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px;
	border-radius: 4px;
	cursor: pointer;
	font-size: ${typography.sm};
	color: ${(props) => (props.selected ? "#ffffff" : "#cccccc")};
	background: ${(props) => (props.selected ? "#6366f1" : "transparent")};
	border: 1px solid ${(props) => (props.selected ? "#6366f1" : "#404040")};
	transition: all 0.2s ease;

	&:hover {
		background: ${(props) => (props.selected ? "#5855f0" : "#333333")};
		border-color: ${(props) => (props.selected ? "#5855f0" : "#555555")};
	}
`;

const CellCheckbox = styled.input`
	margin: 0;
	cursor: pointer;
`;

const CellInfo = styled.div`
	flex: 1;
	min-width: 0;
`;

const CellType = styled.div`
	font-weight: 500;
	color: #a7f3d0;
	font-size: ${typography.xs};
	text-transform: uppercase;
	letter-spacing: 0.5px;
`;

const CellPreview = styled.div`
	color: #9ca3af;
	font-size: ${typography.xs};
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	margin-top: 2px;
`;

const OptionGroup = styled.div`
	display: flex;
	flex-direction: column;
	gap: 8px;
`;

const OptionRow = styled.div`
	display: flex;
	align-items: center;
	gap: 12px;
`;

const Select = styled.select`
	background: #1e1e1e;
	border: 1px solid #404040;
	border-radius: 4px;
	color: #ffffff;
	padding: 8px 12px;
	font-size: ${typography.sm};
	min-width: 200px;
	cursor: pointer;

	&:focus {
		outline: none;
		border-color: #6366f1;
		box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
	}

	option {
		background: #2d2d30;
		color: #ffffff;
	}
`;

const Label = styled.label`
	color: #e5e7eb;
	font-size: ${typography.sm};
	font-weight: 500;
	min-width: 120px;
`;

const SelectionSummary = styled.div`
	background: #374151;
	border-radius: 4px;
	padding: 12px;
	color: #d1d5db;
	font-size: ${typography.sm};
	display: flex;
	align-items: center;
	gap: 8px;
`;

const ModalFooter = styled.div`
	padding: 16px 20px;
	border-top: 1px solid #404040;
	display: flex;
	gap: 12px;
	justify-content: flex-end;
`;

const Button = styled.button<{ variant?: "primary" | "secondary" }>`
	padding: 8px 16px;
	border-radius: 4px;
	font-size: ${typography.sm};
	font-weight: 500;
	cursor: pointer;
	display: inline-flex;
	align-items: center;
	gap: 6px;
	transition: all 0.2s ease;

	${(props) =>
		props.variant === "primary"
			? `
		background: #6366f1;
		border: 1px solid #6366f1;
		color: white;
		
		&:hover {
			background: #5855f0;
			border-color: #5855f0;
		}
		
		&:disabled {
			background: #4b5563;
			border-color: #4b5563;
			color: #9ca3af;
			cursor: not-allowed;
		}
	`
			: `
		background: transparent;
		border: 1px solid #6b7280;
		color: #d1d5db;
		
		&:hover {
			background: #374151;
			border-color: #9ca3af;
			color: #ffffff;
		}
	`}
`;

export interface NotebookCell {
	cell_type: "code" | "markdown";
	source: string[];
	metadata?: any;
	execution_count?: number | null;
	outputs?: any[];
}

export interface SummaryOptions {
	selectedCells: number[];
	reportType: "quick-summary" | "research-report" | "technical-doc";
	outputFormat: "markdown" | "html" | "pdf";
	includeCode: boolean;
	includeOutputs: boolean;
	includeFigures: boolean;
	includeTables: boolean;
	summaryLength: "brief" | "medium" | "detailed" | "comprehensive";
}

interface SummaryOptionsModalProps {
	isOpen: boolean;
	onClose: () => void;
	onGenerate: (options: SummaryOptions) => void;
	cells: NotebookCell[];
	isGenerating?: boolean;
}

export const SummaryOptionsModal: React.FC<SummaryOptionsModalProps> = ({
	isOpen,
	onClose,
	onGenerate,
	cells = [],
	isGenerating = false,
}) => {
	const [selectedCells, setSelectedCells] = useState<number[]>([]);
	const [reportType, setReportType] =
		useState<SummaryOptions["reportType"]>("research-report");
	const [outputFormat, setOutputFormat] =
		useState<SummaryOptions["outputFormat"]>("markdown");
	const [includeCode, setIncludeCode] = useState(true);
	const [includeOutputs, setIncludeOutputs] = useState(true);
	const [includeFigures, setIncludeFigures] = useState(true);
	const [includeTables, setIncludeTables] = useState(true);
	const [summaryLength, setSummaryLength] = useState<SummaryOptions["summaryLength"]>("medium");

	// Initialize with all cells selected when modal opens
	useEffect(() => {
		if (isOpen && cells.length > 0) {
			setSelectedCells(cells.map((_, index) => index));
		}
	}, [isOpen, cells.length]);

	const handleCellToggle = (index: number) => {
		setSelectedCells((prev) =>
			prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
		);
	};

	const handleSelectAll = () => {
		setSelectedCells(cells.map((_, index) => index));
	};

	const handleSelectNone = () => {
		setSelectedCells([]);
	};

	const handleGenerate = () => {
		const options: SummaryOptions = {
			selectedCells,
			reportType,
			outputFormat,
			includeCode,
			includeOutputs,
			includeFigures,
			includeTables,
			summaryLength,
		};
		onGenerate(options);
	};

	const getCellPreview = (cell: NotebookCell) => {
		const content = Array.isArray(cell.source)
			? cell.source.join("")
			: cell.source;
		return (
			content.substring(0, 50).replace(/\n/g, " ") +
			(content.length > 50 ? "..." : "")
		);
	};

	if (!isOpen) return null;

	return (
		<ModalOverlay onClick={onClose}>
			<ModalContent onClick={(e) => e.stopPropagation()}>
				<ModalHeader>
					<ModalTitle>
						<FiZap size={20} />
						Generate AI Summary
					</ModalTitle>
					<CloseButton onClick={onClose}>
						<FiX size={18} />
					</CloseButton>
				</ModalHeader>

				<ModalBody>
					<Section>
						<SectionTitle>Select Cells to Include</SectionTitle>
						<div style={{ marginBottom: "12px", display: "flex", gap: "12px" }}>
							<Button variant="secondary" onClick={handleSelectAll}>
								<FiCheck size={14} /> Select All
							</Button>
							<Button variant="secondary" onClick={handleSelectNone}>
								<FiX size={14} /> Select None
							</Button>
						</div>

						<CellSelectionGrid>
							{cells.map((cell, index) => (
								<CellItem key={index} selected={selectedCells.includes(index)}>
									<CellCheckbox
										type="checkbox"
										checked={selectedCells.includes(index)}
										onChange={() => handleCellToggle(index)}
									/>
									<CellInfo>
										<CellType>
											{cell.cell_type === "code" ? "CODE" : "MARKDOWN"}
										</CellType>
										<CellPreview>{getCellPreview(cell)}</CellPreview>
									</CellInfo>
								</CellItem>
							))}
						</CellSelectionGrid>

						<SelectionSummary>
							<FiFileText size={16} />
							Selected {selectedCells.length} of {cells.length} cells
						</SelectionSummary>
					</Section>

					<Section>
						<SectionTitle>Report Options</SectionTitle>
						<OptionGroup>
							<OptionRow>
								<Label>Report Type:</Label>
								<Select
									value={reportType}
									onChange={(e) =>
										setReportType(
											e.target.value as SummaryOptions["reportType"]
										)
									}
								>
									<option value="quick-summary">Quick Summary</option>
									<option value="research-report">Research Report</option>
									<option value="technical-doc">Technical Documentation</option>
								</Select>
							</OptionRow>

							<OptionRow>
								<Label>Output Format:</Label>
								<Select
									value={outputFormat}
									onChange={(e) =>
										setOutputFormat(
											e.target.value as SummaryOptions["outputFormat"]
										)
									}
								>
									<option value="markdown">Markdown (.md)</option>
									<option value="html">HTML (.html)</option>
									<option value="pdf">PDF (.pdf)</option>
								</Select>
							</OptionRow>
						</OptionGroup>
					</Section>

					<Section>
						<SectionTitle>Content Options</SectionTitle>
						<OptionGroup>
							<OptionRow>
								<Label style={{ cursor: "pointer" }}>
									<input
										type="checkbox"
										checked={includeCode}
										onChange={(e) => setIncludeCode(e.target.checked)}
										style={{ marginRight: "8px" }}
									/>
									Include code snippets
								</Label>
							</OptionRow>
							<OptionRow>
								<Label style={{ cursor: "pointer" }}>
									<input
										type="checkbox"
										checked={includeOutputs}
										onChange={(e) => setIncludeOutputs(e.target.checked)}
										style={{ marginRight: "8px" }}
									/>
									Include cell outputs and results
								</Label>
							</OptionRow>
							<OptionRow>
								<Label style={{ cursor: "pointer" }}>
									<input
										type="checkbox"
										checked={includeFigures}
										onChange={(e) => setIncludeFigures(e.target.checked)}
										style={{ marginRight: "8px" }}
									/>
									Include figures and plots
								</Label>
							</OptionRow>
							<OptionRow>
								<Label style={{ cursor: "pointer" }}>
									<input
										type="checkbox"
										checked={includeTables}
										onChange={(e) => setIncludeTables(e.target.checked)}
										style={{ marginRight: "8px" }}
									/>
									Include tables and data frames
								</Label>
							</OptionRow>
						</OptionGroup>
					</Section>

					<Section>
						<SectionTitle>Summary Length</SectionTitle>
						<OptionGroup>
							<OptionRow>
								<Label>Length:</Label>
								<Select
									value={summaryLength}
									onChange={(e) =>
										setSummaryLength(e.target.value as SummaryOptions["summaryLength"])
									}
								>
									<option value="brief">Brief (~200 words)</option>
									<option value="medium">Medium (~500 words)</option>
									<option value="detailed">Detailed (~1000 words)</option>
									<option value="comprehensive">Comprehensive (~2000+ words)</option>
								</Select>
							</OptionRow>
						</OptionGroup>
					</Section>
				</ModalBody>

				<ModalFooter>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button
						variant="primary"
						onClick={handleGenerate}
						disabled={selectedCells.length === 0 || isGenerating}
					>
						<FiDownload size={14} />
						{isGenerating ? "Generating..." : "Generate Summary"}
					</Button>
				</ModalFooter>
			</ModalContent>
		</ModalOverlay>
	);
};
