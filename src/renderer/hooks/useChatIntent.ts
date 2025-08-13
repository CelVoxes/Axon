import {
	ANALYSIS_KEYWORDS,
	AMBIGUOUS_KEYWORDS,
	DATA_HINT_WORDS,
	SEARCH_KEYWORDS,
	SUGGESTION_KEYWORDS,
} from "../config/SearchConfig";
import { BackendClient } from "../services/BackendClient";
import { ConfigManager } from "../services/ConfigManager";

export interface ChatIntentAPI {
	isSuggestionsRequest: (message: string) => boolean;
	shouldSearchForDatasets: (message: string) => Promise<boolean> | boolean;
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

	const shouldSearchForDatasets = async (message: string): Promise<boolean> => {
		const msg = normalize(message);

		// If analysis-related terms are present, prefer analysis path
		if (ANALYSIS_KEYWORDS.some((kw) => msg.includes(kw))) {
			return false;
		}

		// Explicit search phrases
		if (SEARCH_KEYWORDS.some((kw) => msg.includes(kw))) {
			return true;
		}

		// Pattern-based detection: search verbs + dataset/data nouns
		const hasSearchVerb =
			/(\bsearch\b|\bfind\b|\blook for\b|\bdiscover\b|\blocate\b)/i.test(msg);
		const mentionsDataset = /(\bdataset\b|\bdatasets\b|\bdata\b)/i.test(msg);
		if (hasSearchVerb && mentionsDataset) {
			return true;
		}

		// Ambiguous short queries that look like search
		const hasAmbiguous = AMBIGUOUS_KEYWORDS.some((kw) => msg.includes(kw));
		if (hasAmbiguous && msg.length < 120) {
			if (DATA_HINT_WORDS.some((hint) => msg.includes(hint))) {
				return true;
			}
		}

		// Fallback to LLM classification if enabled
		const { enableLlmIntent, llmIntentTimeoutMs } =
			ConfigManager.getInstance().getSection("features");
		if (!enableLlmIntent) return false;

		try {
			const backendUrl = await (window as any).electronAPI?.getBioragUrl?.();
			const client = new BackendClient(backendUrl || "http://localhost:8000");
			const classifyPromise = client.classifyIntent(message);
			const result = await Promise.race<Promise<any>>([
				classifyPromise,
				new Promise((_, reject) =>
					setTimeout(
						() => reject(new Error("llm_intent_timeout")),
						llmIntentTimeoutMs
					)
				),
			]);
			const intent = String(result?.intent || "unknown").toLowerCase();
			if (intent.includes("search")) return true;
			return false;
		} catch (_) {
			// On failure/timeout, default to non-search
			return false;
		}
	};

	return { isSuggestionsRequest, shouldSearchForDatasets, isAnalysisRequest };
}
