import React, { useState, useEffect } from "react";
import styled from "styled-components";
import {
	FiDownload,
	FiInfo,
	FiCheck,
	FiX,
	FiExternalLink,
} from "react-icons/fi";

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
	font-size: 18px;
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
	font-size: 16px;
	font-weight: 600;
	flex: 1;
	margin-right: 12px;
`;

const DatasetId = styled.span`
	background: #007acc;
	color: #fff;
	padding: 4px 8px;
	border-radius: 4px;
	font-size: 12px;
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
	font-size: 13px;
`;

const DatasetDescription = styled.p`
	color: #ccc;
	margin: 0;
	font-size: 14px;
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
	font-size: 12px;
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
	font-size: 14px;
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
	font-size: 14px;
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

interface Dataset {
	id: string;
	title: string;
	description: string;
	organism: string;
	samples: number;
	sample_count?: string;
	type?: string;
	platform: string;
	publication_date?: string;
	similarity_score?: number;
	source?: string;
	url?: string;
}

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
	console.log(
		`DatasetSelectionModal: isOpen=${isOpen}, datasets=${datasets.length}`
	);
	const [selectedDatasets, setSelectedDatasets] = useState<Set<string>>(
		new Set()
	);
	const [wasOpen, setWasOpen] = useState(false);

	useEffect(() => {
		if (isOpen && !wasOpen) {
			// Auto-select first 2 datasets only when modal is first opened
			const initialSelection = new Set(datasets.slice(0, 2).map((d) => d.id));
			setSelectedDatasets(initialSelection);
		}
		setWasOpen(isOpen);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isOpen]);

	const toggleDataset = (datasetId: string) => {
		const newSelection = new Set(selectedDatasets);
		if (newSelection.has(datasetId)) {
			newSelection.delete(datasetId);
		} else {
			newSelection.add(datasetId);
		}
		setSelectedDatasets(newSelection);
	};

	const handleConfirm = () => {
		const selected = datasets.filter((d) => selectedDatasets.has(d.id));
		onConfirm(selected);
	};

	const openDatasetUrl = (dataset: Dataset) => {
		const url =
			dataset.url ||
			`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${dataset.id}`;
		window.open(url, "_blank");
	};

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
					{datasets.length === 0 ? (
						<div
							style={{ textAlign: "center", color: "#888", padding: "40px" }}
						>
							No datasets found for your query. Try refining your search terms.
						</div>
					) : (
						datasets.map((dataset, index) => (
							<DatasetCard
								key={`${dataset.id}-${index}`}
								selected={selectedDatasets.has(dataset.id)}
								onClick={() => toggleDataset(dataset.id)}
							>
								<DatasetHeader>
									<DatasetTitle>{dataset.title}</DatasetTitle>
									<DatasetId>{dataset.id}</DatasetId>
								</DatasetHeader>

								<DatasetMeta>
									<MetaItem>
										<strong>Organism:</strong> {dataset.organism || "Unknown"}
									</MetaItem>
									<MetaItem>
										<strong>Samples:</strong>{" "}
										{dataset.sample_count || dataset.samples || "Unknown"}
									</MetaItem>
									<MetaItem>
										<strong>Platform:</strong> {dataset.platform || "Unknown"}
									</MetaItem>
									{dataset.similarity_score && (
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
								</DatasetMeta>

								<DatasetDescription>
									{dataset.description || "No description available"}
								</DatasetDescription>

								<DatasetActions onClick={(e) => e.stopPropagation()}>
									<InfoButton onClick={() => openDatasetUrl(dataset)}>
										<FiExternalLink size={12} />
										View on GEO
									</InfoButton>
								</DatasetActions>
							</DatasetCard>
						))
					)}
				</ModalBody>

				<ModalFooter>
					<SelectionInfo>
						{selectedDatasets.size} of {datasets.length} datasets selected
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
							Download & Analyze ({selectedDatasets.size})
						</Button>
					</ActionButtons>
				</ModalFooter>
			</ModalContent>
		</ModalOverlay>
	);
};
