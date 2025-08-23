import { useState, useCallback, useMemo } from 'react';
import { SearchService } from '../../../services/SearchService';
import { BackendClient } from '../../../services/backend/BackendClient';
import { SearchConfig } from '../../../config/SearchConfig';

export interface DatasetSearchResult {
	datasets: any[];
	totalFound: number;
	searchQuery: string;
}

export interface DatasetSearchState {
	availableDatasets: any[];
	selectedDatasets: any[];
	isSearching: boolean;
	searchProgress: any;
	showSearchDetails: boolean;
	showDatasetModal: boolean;
}

export interface DatasetSearchActions {
	searchForDatasets: (query: string, options?: { limit?: number }) => Promise<DatasetSearchResult>;
	selectDatasets: (datasets: any[]) => void;
	mergeSelectedDatasets: (existing: any[], added: any[]) => any[];
	clearSearch: () => void;
	clearSelectedDatasets: () => void;
	clearAvailableDatasets: () => void;
	setSearchProgress: (progress: any) => void;
	setShowSearchDetails: (show: boolean) => void;
	setShowDatasetModal: (show: boolean) => void;
}

export function useDatasetSearch(
	backendClient: BackendClient | null,
	onProgressUpdate?: (progress: any) => void
): [DatasetSearchState, DatasetSearchActions] {
	// State
	const [availableDatasets, setAvailableDatasets] = useState<any[]>([]);
	const [selectedDatasets, setSelectedDatasets] = useState<any[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [searchProgress, setSearchProgress] = useState<any>(null);
	const [showSearchDetails, setShowSearchDetails] = useState(false);
	const [showDatasetModal, setShowDatasetModal] = useState(false);

	// Create search service
	const searchService = useMemo(() => {
		return backendClient ? new SearchService(backendClient) : null;
	}, [backendClient]);

	// Merge datasets by id to avoid duplicates
	const mergeSelectedDatasets = useCallback((existing: any[], added: any[]) => {
		const byId = new Map<string, any>();
		existing.forEach((d) => d?.id && byId.set(d.id, d));
		added.forEach((d) => d?.id && byId.set(d.id, d));
		return Array.from(byId.values());
	}, []);

	// Main search function
	const searchForDatasets = useCallback(async (
		query: string, 
		options: { limit?: number } = {}
	): Promise<DatasetSearchResult> => {
		if (!backendClient || !searchService) {
			throw new Error('Backend client not available');
		}

		setIsSearching(true);
		setShowSearchDetails(true);

		try {
			// Set up progress callback
			if (searchService && onProgressUpdate) {
				searchService.setProgressCallback((progress: any) => {
					setSearchProgress(progress);
					onProgressUpdate(progress);
				});
			} else if (backendClient && onProgressUpdate) {
				backendClient.setProgressCallback((progress: any) => {
					setSearchProgress(progress);
					onProgressUpdate(progress);
				});
			}

			// Initialize search progress
			setSearchProgress({
				message: "Initializing search...",
				progress: 0,
				step: "init",
				datasetsFound: 0,
			});

			console.log("🔍 Starting search with query:", query);
			console.log("🔍 BackendClient baseUrl:", backendClient.getBaseUrl());

			// Perform the search
			const response = await searchService.discoverDatasets(query, {
				limit: SearchConfig.getSearchLimit(options.limit),
			});

			const result: DatasetSearchResult = {
				datasets: response.datasets || [],
				totalFound: response.datasets?.length || 0,
				searchQuery: query,
			};

			// Update state with results
			if (result.datasets.length > 0) {
				setAvailableDatasets(result.datasets);
				setShowDatasetModal(true);
			}

			// Clear progress after a delay
			setTimeout(() => {
				setSearchProgress(null);
				setShowSearchDetails(false);
			}, 2000);

			return result;
		} finally {
			setIsSearching(false);
		}
	}, [backendClient, searchService, onProgressUpdate]);

	// Select datasets and merge with existing
	const selectDatasets = useCallback((datasets: any[]) => {
		setSelectedDatasets((prev) => mergeSelectedDatasets(prev, datasets));
		setShowDatasetModal(false);
	}, [mergeSelectedDatasets]);

	// Clear search state
	const clearSearch = useCallback(() => {
		setAvailableDatasets([]);
		setIsSearching(false);
		setSearchProgress(null);
		setShowSearchDetails(false);
		setShowDatasetModal(false);
	}, []);

	// Clear selected datasets
	const clearSelectedDatasets = useCallback(() => {
		setSelectedDatasets([]);
	}, []);

	// Clear available datasets
	const clearAvailableDatasets = useCallback(() => {
		setAvailableDatasets([]);
	}, []);

	const state: DatasetSearchState = {
		availableDatasets,
		selectedDatasets,
		isSearching,
		searchProgress,
		showSearchDetails,
		showDatasetModal,
	};

	const actions: DatasetSearchActions = {
		searchForDatasets,
		selectDatasets,
		mergeSelectedDatasets,
		clearSearch,
		clearSelectedDatasets,
		clearAvailableDatasets,
		setSearchProgress,
		setShowSearchDetails,
		setShowDatasetModal,
	};

	return [state, actions];
}