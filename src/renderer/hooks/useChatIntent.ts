import {
	ANALYSIS_KEYWORDS,
	AMBIGUOUS_KEYWORDS,
	DATA_HINT_WORDS,
	SEARCH_KEYWORDS,
	SUGGESTION_KEYWORDS,
} from "../config/SearchConfig";

export interface ChatIntentAPI {
	isSuggestionsRequest: (message: string) => boolean;
	shouldSearchForDatasets: (message: string) => boolean;
	isAnalysisRequest: (message: string) => boolean;
}

export function useChatIntent(): ChatIntentAPI {
	const normalize = (s: string) => s.toLowerCase();

	const isSuggestionsRequest = (message: string): boolean => {
		const msg = normalize(message);
		return SUGGESTION_KEYWORDS.some((kw) => msg.includes(kw));
	};

	const isAnalysisRequest = (message: string): boolean => {
		const msg = normalize(message);
		return ANALYSIS_KEYWORDS.some((kw) => msg.includes(kw));
	};

	const shouldSearchForDatasets = (message: string): boolean => {
		const msg = normalize(message);

		// Explicit search phrases
		if (SEARCH_KEYWORDS.some((kw) => msg.includes(kw))) {
			return true;
		}

		// If analysis-related terms are present, prefer analysis path
		if (ANALYSIS_KEYWORDS.some((kw) => msg.includes(kw))) {
			return false;
		}

		// Ambiguous short queries that look like search
		const hasAmbiguous = AMBIGUOUS_KEYWORDS.some((kw) => msg.includes(kw));
		if (hasAmbiguous) {
			if (msg.length < 50) {
				if (DATA_HINT_WORDS.some((hint) => msg.includes(hint))) {
					return true;
				}
			}
		}

		return false;
	};

	return { isSuggestionsRequest, shouldSearchForDatasets, isAnalysisRequest };
}
