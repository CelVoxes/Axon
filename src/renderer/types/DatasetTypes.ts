/**
 * Centralized dataset type definitions
 */

export interface BaseDataset {
	id: string;
	title: string;
	description: string;
	organism: string;
	samples: number;
	platform: string;
}

export interface Dataset extends BaseDataset {
	source: string;
	url?: string;
	dataType?: string;
	fileFormat?: string;
	columns?: string[];
	dimensions?: number[];
}

export interface GEODataset extends BaseDataset {
	gse_id?: string;
	sample_count?: number | string;
	type?: string;
	publication_date?: string;
	similarity_score?: number;
	url?: string;
	source?: string;
	summary?: string;
	overall_design?: string;
}

export interface DatasetAnalysis {
	dataTypes: string[];
	recommendedTools: string[];
	sampleInfo: {
		totalSamples: number;
		hasMetadata: boolean;
		hasExpressionData: boolean;
	};
}

export interface DatasetSearchResult {
	datasets: Dataset[];
	query: string;
	suggestions: string[];
	searchType: string;
	formattedQuery?: string;
	extractedGenes?: string[];
	extractedDiseases?: string[];
	extractedIds?: string[];
	searchTerms?: string[];
	queryTransformation?: string;
	searchSteps?: string[];
}
