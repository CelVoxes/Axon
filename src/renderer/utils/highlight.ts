import hljs from "highlight.js";

const DEFAULT_LANGUAGE = "plaintext";

const LANGUAGE_ALIASES: Record<string, string> = {
	plan: DEFAULT_LANGUAGE,
	text: DEFAULT_LANGUAGE,
	plaintext: DEFAULT_LANGUAGE,
	py: "python",
	sh: "bash",
	shell: "bash",
	console: "bash",
	js: "javascript",
};

export interface ResolvedHighlightLanguage {
	language: string;
	didFallback: boolean;
}

export function resolveHighlightLanguage(
	language?: string | null
): ResolvedHighlightLanguage {
	const normalized = (language || "").trim().toLowerCase();

	if (normalized && hljs.getLanguage(normalized)) {
		return { language: normalized, didFallback: false };
	}

	if (normalized) {
		const alias = LANGUAGE_ALIASES[normalized];
		if (alias) {
			const aliasNormalized = alias.toLowerCase();
			if (hljs.getLanguage(aliasNormalized)) {
				return {
					language: aliasNormalized,
					didFallback: aliasNormalized !== normalized,
				};
			}
		}
	}

	return {
		language: DEFAULT_LANGUAGE,
		didFallback: normalized !== DEFAULT_LANGUAGE && normalized.length > 0,
	};
}

