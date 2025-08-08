import React, { useState, useEffect } from "react";
import styled from "styled-components";
import {
	FiDownload,
	FiInfo,
	FiCheck,
	FiX,
	FiExternalLink,
} from "react-icons/fi";
import { typography } from "../../styles/design-system";
import { GEODataset as Dataset } from "../../types/DatasetTypes";

const ModalOverlay = styled.div`
	position: fixed;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	background: rgba(0, 0, 0, 0.7);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 1000;
`;

const ModalContent = styled.div`
	background: #1a1a1a;
	border-radius: 12px;
	width: 90%;
	max-width: 800px;
	max-height: 80vh;
	overflow: hidden;
	border: 1px solid #333;
`;

const ModalHeader = styled.div`
	padding: 20px;
	border-bottom: 1px solid #333;
	display: flex;
	align-items: center;
	justify-content: space-between;
`;

const ModalTitle = styled.h2`
	color: #fff;
	margin: 0;
	font-size: ${typography.xl};
	font-weight: 600;
`;

const CloseButton = styled.button`
	background: transparent;
	border: none;
	color: #888;
	cursor: pointer;
	padding: 4px;
	border-radius: 4px;
	display: flex;
	align-items: center;

	&:hover {
		color: #fff;
		background: rgba(255, 255, 255, 0.1);
	}
`;

const ModalBody = styled.div`
	padding: 20px;
	max-height: 50vh;
	overflow-y: auto;

	&::-webkit-scrollbar {
		width: 6px;
	}

	&::-webkit-scrollbar-track {
		background: transparent;
	}

	&::-webkit-scrollbar-thumb {
		background: rgba(255, 255, 255, 0.1);
		border-radius: 3px;
	}
`;

const DatasetCard = styled.div<{ selected: boolean }>`
	background: #2a2a2a;
	border: 2px solid ${(props) => (props.selected ? "#007acc" : "#404040")};
	border-radius: 8px;
	padding: 16px;
	margin-bottom: 12px;
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover {
		border-color: ${(props) => (props.selected ? "#007acc" : "#666")};
		background: #333;
	}
`;

const DatasetHeader = styled.div`
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	margin-bottom: 8px;
`;

const DatasetTitle = styled.h3`
	color: #fff;
	margin: 0;
	font-size: ${typography.lg};
	font-weight: 600;
	flex: 1;
	margin-right: 12px;
`;

const DatasetId = styled.span`
	background: #007acc;
	color: #fff;
	padding: 4px 8px;
	border-radius: 4px;
	font-size: ${typography.sm};
	font-weight: 600;
`;

const DatasetMeta = styled.div`
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	margin-bottom: 8px;
`;

const MetaItem = styled.div`
	color: #aaa;
	font-size: ${typography.base};
`;

const DatasetDescription = styled.p`
	color: #ccc;
	margin: 0;
	font-size: ${typography.base};
	line-height: 1.4;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
`;

const DatasetActions = styled.div`
	display: flex;
	align-items: center;
	gap: 8px;
	margin-top: 12px;
`;

const InfoButton = styled.button`
	background: transparent;
	border: 1px solid #666;
	color: #aaa;
	padding: 6px 12px;
	border-radius: 4px;
	font-size: ${typography.sm};
	cursor: pointer;
	display: flex;
	align-items: center;
	gap: 4px;

	&:hover {
		border-color: #888;
		color: #fff;
	}
`;

const ModalFooter = styled.div`
	padding: 20px;
	border-top: 1px solid #333;
	display: flex;
	align-items: center;
	justify-content: space-between;
`;

const SelectionInfo = styled.div`
	color: #aaa;
	font-size: ${typography.base};
`;

const ActionButtons = styled.div`
	display: flex;
	gap: 12px;
`;

const Button = styled.button<{ $variant?: "primary" | "secondary" }>`
	background: ${(props) =>
		props.$variant === "primary" ? "#007acc" : "transparent"};
	border: 1px solid
		${(props) => (props.$variant === "primary" ? "#007acc" : "#666")};
	color: #fff;
	padding: 10px 20px;
	border-radius: 6px;
	font-size: ${typography.base};
	font-weight: 500;
	cursor: pointer;
	display: flex;
	align-items: center;
	gap: 8px;

	&:hover {
		background: ${(props) =>
			props.$variant === "primary" ? "#005a9e" : "rgba(255, 255, 255, 0.1)"};
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`;

const PaginationContainer = styled.div`
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	margin: 20px 0;
	padding: 16px;
	border-top: 1px solid #333;
`;

const PaginationButton = styled.button<{ $active?: boolean }>`
	background: ${(props) => (props.$active ? "#007acc" : "transparent")};
	border: 1px solid ${(props) => (props.$active ? "#007acc" : "#666")};
	color: ${(props) => (props.$active ? "#fff" : "#aaa")};
	padding: 8px 12px;
	border-radius: 4px;
	font-size: ${typography.sm};
	cursor: pointer;
	min-width: 32px;
	display: flex;
	align-items: center;
	justify-content: center;

	&:hover {
		background: ${(props) =>
			props.$active ? "#005a9e" : "rgba(255, 255, 255, 0.1)"};
		color: #fff;
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`;

const PaginationInfo = styled.div`
	color: #aaa;
	font-size: ${typography.sm};
	margin: 0 16px;
`;

// Using shared GEODataset type as Dataset

interface DatasetSelectionModalProps {
	isOpen: boolean;
	datasets: Dataset[];
	onClose: () => void;
	onConfirm: (selectedDatasets: Dataset[]) => void;
	isLoading?: boolean;
}

export const DatasetSelectionModal: React.FC<DatasetSelectionModalProps> = ({
	isOpen,
	datasets,
	onClose,
	onConfirm,
	isLoading = false,
}) => {
	const [selectedDatasets, setSelectedDatasets] = useState<Set<string>>(
		new Set()
	);
	const [wasOpen, setWasOpen] = useState(false);
	const [currentPage, setCurrentPage] = useState(1);
	const [datasetsPerPage] = useState(10); // Show 10 datasets per page

	// Ensure datasets is always an array
	const safeDatasets = Array.isArray(datasets) ? datasets : [];

	useEffect(() => {
		if (isOpen && !wasOpen && safeDatasets.length > 0) {
			// Auto-select first 2 datasets only when modal is first opened
			const initialSelection = new Set(
				safeDatasets.slice(0, 2).map((d) => d.id)
			);
			setSelectedDatasets(initialSelection);
		}
		setWasOpen(isOpen);
	}, [isOpen, wasOpen, safeDatasets]);

	// Handle dataset changes while modal is open - optimize to prevent infinite re-renders
	useEffect(() => {
		if (!isOpen || safeDatasets.length === 0) return;

		// Remove any selected datasets that no longer exist in the current dataset list
		const validDatasetIds = new Set(safeDatasets.map((d) => d.id));
		const currentSelectionArray = Array.from(selectedDatasets);
		const filteredSelectionArray = currentSelectionArray.filter((id) =>
			validDatasetIds.has(id)
		);

		// Only update if there's a meaningful change
		if (filteredSelectionArray.length !== currentSelectionArray.length) {
			if (filteredSelectionArray.length === 0) {
				// If no valid selections remain, auto-select first 2 datasets
				const initialSelection = new Set(
					safeDatasets.slice(0, 2).map((d) => d.id)
				);
				setSelectedDatasets(initialSelection);
			} else {
				// Update with filtered selection
				setSelectedDatasets(new Set(filteredSelectionArray));
			}
		}
	}, [safeDatasets, isOpen]); // Remove selectedDatasets from deps to prevent infinite loop

	const toggleDataset = (datasetId: string) => {
		if (!datasetId) return;

		const newSelection = new Set(selectedDatasets);
		if (newSelection.has(datasetId)) {
			newSelection.delete(datasetId);
		} else {
			newSelection.add(datasetId);
		}
		setSelectedDatasets(newSelection);
	};

	const handleConfirm = () => {
		if (!safeDatasets || safeDatasets.length === 0) {
			console.warn("No datasets available for selection");
			return;
		}

		const selected = safeDatasets.filter(
			(d) => d && d.id && selectedDatasets.has(d.id)
		);
		onConfirm(selected);
	};

	const openDatasetUrl = (dataset: Dataset) => {
		if (!dataset || !dataset.id) {
			console.warn("Invalid dataset for URL opening");
			return;
		}

		// Handle different dataset sources with appropriate URLs
		let url = dataset.url || "";
		if (!url) {
			if (
				(dataset as any).source === "CellxCensus" ||
				(dataset.id && dataset.id.includes("-"))
			) {
				// CellxCensus datasets: link to interactive dataset viewer
				url = `https://cellxgene.cziscience.com/e/${dataset.id}.cxg`;
			} else {
				// GEO datasets typically have GSE/GSM format IDs
				url = `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${dataset.id}`;
			}
		}
		window.open(url, "_blank");
	};

	// Pagination logic
	const totalPages = Math.ceil(safeDatasets.length / datasetsPerPage);
	const startIndex = (currentPage - 1) * datasetsPerPage;
	const endIndex = startIndex + datasetsPerPage;
	const currentDatasets = safeDatasets.slice(startIndex, endIndex);

	const goToPage = (page: number) => {
		setCurrentPage(Math.max(1, Math.min(page, totalPages)));
	};

	const goToNextPage = () => {
		if (currentPage < totalPages) {
			setCurrentPage(currentPage + 1);
		}
	};

	const goToPrevPage = () => {
		if (currentPage > 1) {
			setCurrentPage(currentPage - 1);
		}
	};

	// Reset to first page when datasets change
	useEffect(() => {
		setCurrentPage(1);
	}, [safeDatasets]);

	if (!isOpen) return null;

	return (
		<ModalOverlay onClick={onClose}>
			<ModalContent onClick={(e) => e.stopPropagation()}>
				<ModalHeader>
					<ModalTitle>Select Datasets for Analysis</ModalTitle>
					<CloseButton onClick={onClose}>
						<FiX size={20} />
					</CloseButton>
				</ModalHeader>

				<ModalBody>
					{safeDatasets.length === 0 ? (
						<div
							style={{ textAlign: "center", color: "#888", padding: "40px" }}
						>
							No datasets found for your query. Try refining your search terms.
						</div>
					) : (
						<>
							{currentDatasets.map((dataset, index) => (
								<DatasetCard
									key={dataset.id}
									selected={selectedDatasets.has(dataset.id)}
									onClick={() => toggleDataset(dataset.id)}
								>
									<DatasetHeader>
										<DatasetTitle>
											{dataset.title || `Dataset ${dataset.id}`}
										</DatasetTitle>
										<DatasetId>{dataset.id}</DatasetId>
									</DatasetHeader>

									<DatasetMeta>
										<MetaItem>
											<strong>Organism:</strong> {dataset.organism || "Unknown"}
										</MetaItem>
										<MetaItem>
											{(dataset as any).source === "CellxCensus" ? (
												<>
													<strong>Cells:</strong>{" "}
													{(() => {
														const count = dataset.sample_count;
														if (typeof count === "number") {
															return count.toLocaleString();
														}
														if (
															typeof count === "string" &&
															!isNaN(Number(count))
														) {
															return Number(count).toLocaleString();
														}
														return count || "Unknown";
													})()}
												</>
											) : (
												<>
													<strong>Samples:</strong>{" "}
													{dataset.samples || dataset.sample_count || "Unknown"}
												</>
											)}
										</MetaItem>
										<MetaItem>
											<strong>Platform:</strong> {dataset.platform || "Unknown"}
										</MetaItem>
										{dataset.similarity_score !== undefined && (
											<MetaItem>
												<strong>Similarity:</strong>{" "}
												{(dataset.similarity_score * 100).toFixed(1)}%
											</MetaItem>
										)}
										{dataset.publication_date && (
											<MetaItem>
												<strong>Date:</strong> {dataset.publication_date}
											</MetaItem>
										)}
										{(dataset as any).source && (
											<MetaItem>
												<strong>Source:</strong> {(dataset as any).source}
											</MetaItem>
										)}
										{((dataset as any).source === "CellxCensus" ||
											(dataset.id && dataset.id.includes("-"))) &&
											dataset.sample_count && (
												<MetaItem>
													<strong>Est. Size:</strong>{" "}
													{(() => {
														const count =
															typeof dataset.sample_count === "number"
																? dataset.sample_count
																: parseInt(String(dataset.sample_count)) || 0;
														const sizeEstimateMB = Math.round(
															(count / 1000) * 5
														); // ~5MB per 1000 cells
														return sizeEstimateMB < 1000
															? `~${Math.max(1, sizeEstimateMB)}MB`
															: `~${(sizeEstimateMB / 1000).toFixed(1)}GB`;
													})()}
												</MetaItem>
											)}
									</DatasetMeta>

									<DatasetDescription>
										{dataset.description || "No description available"}
										{((dataset as any).source === "CellxCensus" ||
											(dataset.id && dataset.id.includes("-"))) && (
											<div
												style={{
													marginTop: "8px",
													fontSize: "12px",
													color: "#666",
													fontFamily: "monospace",
												}}
											>
												📁 https://datasets.cellxgene.cziscience.com/
												{dataset.id}.h5ad
											</div>
										)}
									</DatasetDescription>

									<DatasetActions onClick={(e) => e.stopPropagation()}>
										<InfoButton onClick={() => openDatasetUrl(dataset)}>
											<FiExternalLink size={12} />
											{(dataset as any).source === "CellxCensus" ||
											(dataset.id && dataset.id.includes("-"))
												? "Explore Dataset"
												: "View on GEO"}
										</InfoButton>
									</DatasetActions>
								</DatasetCard>
							))}

							{/* Pagination */}
							{totalPages > 1 && (
								<PaginationContainer>
									<PaginationButton
										onClick={goToPrevPage}
										disabled={currentPage === 1}
									>
										←
									</PaginationButton>

									{Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
										let pageNum;
										if (totalPages <= 5) {
											pageNum = i + 1;
										} else if (currentPage <= 3) {
											pageNum = i + 1;
										} else if (currentPage >= totalPages - 2) {
											pageNum = totalPages - 4 + i;
										} else {
											pageNum = currentPage - 2 + i;
										}

										return (
											<PaginationButton
												key={pageNum}
												$active={currentPage === pageNum}
												onClick={() => goToPage(pageNum)}
											>
												{pageNum}
											</PaginationButton>
										);
									})}

									<PaginationButton
										onClick={goToNextPage}
										disabled={currentPage === totalPages}
									>
										→
									</PaginationButton>

									<PaginationInfo>
										Page {currentPage} of {totalPages} • {safeDatasets.length}{" "}
										total datasets
									</PaginationInfo>
								</PaginationContainer>
							)}
						</>
					)}
				</ModalBody>

				<ModalFooter>
					<SelectionInfo>
						{selectedDatasets.size} of {safeDatasets.length} datasets selected
					</SelectionInfo>

					<ActionButtons>
						<Button $variant="secondary" onClick={onClose}>
							Cancel
						</Button>
						<Button
							$variant="primary"
							onClick={handleConfirm}
							disabled={selectedDatasets.size === 0 || isLoading}
						>
							<FiDownload size={16} />
							Select & Analyze ({selectedDatasets.size})
						</Button>
					</ActionButtons>
				</ModalFooter>
			</ModalContent>
		</ModalOverlay>
	);
};
