"""Centralized configuration for search settings."""

from typing import Optional
import os

# Search Limits
DEFAULT_SEARCH_LIMIT = 20
MAX_SEARCH_LIMIT = 100
MIN_SEARCH_LIMIT = 5

# Batch Processing
DEFAULT_BATCH_SIZE = 2
MAX_BATCH_SIZE = 5

# API Rate Limiting
DEFAULT_REQUEST_INTERVAL = 0.5  # seconds
MIN_REQUEST_INTERVAL = 0.1  # seconds

# Search Multipliers
RETMAX_MULTIPLIER = 1  # retmax = limit * this

# Progress Update Intervals
PROGRESS_UPDATE_INTERVAL = 0.1  # seconds

# Search Strategy
MAX_SEARCH_ATTEMPTS = 2
DEFAULT_ORGANISM = "Homo sapiens"

# LLM Configuration
DEFAULT_LLM_MODEL = "gpt-5-mini"  # Uses Chain-of-Thought reasoning internally
_DEFAULT_AVAILABLE_LLM_MODELS = [
    "gpt-5-mini",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4o",
    "gpt-4o-mini",
]
_AVAILABLE_MODELS_ENV = os.getenv("AXON_AVAILABLE_MODELS") or os.getenv("OPENAI_AVAILABLE_MODELS") or ""
AVAILABLE_LLM_MODELS = (
    [m.strip() for m in _AVAILABLE_MODELS_ENV.split(",") if m.strip()] if _AVAILABLE_MODELS_ENV else _DEFAULT_AVAILABLE_LLM_MODELS
)
DEFAULT_OPENAI_TIMEOUT_SECONDS = int(os.getenv("AXON_OPENAI_TIMEOUT_SECONDS", "900"))
# Preferred: set AXON_OPENAI_SERVICE_TIER to "flex" to enable Flex processing globally
# Fallback: respect OPENAI_SERVICE_TIER if provided
DEFAULT_OPENAI_SERVICE_TIER = os.getenv("AXON_OPENAI_SERVICE_TIER") or os.getenv("OPENAI_SERVICE_TIER") or ""

# Caching
CACHE_SEARCH_TTL_SECONDS = 15 * 60  # 15 minutes
CACHE_METADATA_TTL_SECONDS = 24 * 60 * 60  # 24 hours
CACHE_MAX_SEARCH_ENTRIES = 256

class SearchConfig:
    """Centralized search configuration."""
    
    @staticmethod
    def get_search_limit(limit: Optional[int] = None) -> int:
        """Get the search limit, ensuring it's within bounds."""
        if limit is None:
            return DEFAULT_SEARCH_LIMIT
        return max(MIN_SEARCH_LIMIT, min(limit, MAX_SEARCH_LIMIT))
    
    @staticmethod
    def get_batch_size(batch_size: Optional[int] = None) -> int:
        """Get the batch size, ensuring it's within bounds."""
        if batch_size is None:
            return DEFAULT_BATCH_SIZE
        return max(1, min(batch_size, MAX_BATCH_SIZE))
    
    @staticmethod
    def get_retmax(limit: int) -> int:
        """Calculate retmax based on limit."""
        return limit * RETMAX_MULTIPLIER
    
    @staticmethod
    def get_request_interval() -> float:
        """Get the request interval for rate limiting."""
        return DEFAULT_REQUEST_INTERVAL
    
    @staticmethod
    def get_default_llm_model() -> str:
        """Get the default LLM model."""
        return DEFAULT_LLM_MODEL 

    @staticmethod
    def get_available_llm_models() -> list[str]:
        """Get the list of available LLM models for UI selection."""
        # Ensure default is present at least once and first
        unique = []
        seen = set()
        for m in [DEFAULT_LLM_MODEL] + AVAILABLE_LLM_MODELS:
            if m and m not in seen:
                unique.append(m)
                seen.add(m)
        return unique

    @staticmethod
    def get_openai_timeout_seconds() -> int:
        """Default OpenAI client timeout in seconds (defaults to 900s)."""
        return DEFAULT_OPENAI_TIMEOUT_SECONDS

    @staticmethod
    def get_openai_service_tier() -> str:
        """Return configured OpenAI service tier ("flex" to enable Flex processing)."""
        return DEFAULT_OPENAI_SERVICE_TIER

    # ---------------- LLM context window configuration ----------------
    # Token limits are best-effort defaults and can be overridden via env vars.
    # Fallback applies when the model is unknown.
    _MODEL_CONTEXT_TOKEN_DEFAULT = int(os.getenv("AXON_DEFAULT_CONTEXT_TOKENS", "128000"))
    _MODEL_CONTEXT_TOKENS = {
        # Allow env overrides per model; fall back to default when unset
        "gpt-5-mini": int(os.getenv("AXON_CTX_GPT5_MINI", str("272000"))),
        "gpt-4o": int(os.getenv("AXON_CTX_GPT4O", "128000")),
        "gpt-4o-mini": int(os.getenv("AXON_CTX_GPT4O_MINI", "128000")),
        "gpt-4.1": int(os.getenv("AXON_CTX_GPT41", "128000")),
        "gpt-4.1-mini": int(os.getenv("AXON_CTX_GPT41_MINI", "128000")),
    }

    @staticmethod
    def get_model_context_tokens(model: Optional[str]) -> int:
        """Return the approximate context window tokens for a given model.

        - Matches by exact or prefix (to handle versioned model names)
        - Falls back to env default or 128k
        """
        try:
            if not model:
                return SearchConfig._MODEL_CONTEXT_TOKEN_DEFAULT
            key = model.lower()
            # Try exact match first
            if key in SearchConfig._MODEL_CONTEXT_TOKENS:
                return int(SearchConfig._MODEL_CONTEXT_TOKENS[key])
            # Then try prefix match to accommodate versioned names
            for name, limit in SearchConfig._MODEL_CONTEXT_TOKENS.items():
                if key.startswith(name):
                    return int(limit)
        except Exception:
            pass
        return SearchConfig._MODEL_CONTEXT_TOKEN_DEFAULT

    # Caching helpers
    @staticmethod
    def get_cache_search_ttl_seconds() -> int:
        """TTL for cached search results in seconds."""
        return CACHE_SEARCH_TTL_SECONDS

    @staticmethod
    def get_cache_metadata_ttl_seconds() -> int:
        """TTL for cached metadata (CellxCensus datasets listing) in seconds."""
        return CACHE_METADATA_TTL_SECONDS

    @staticmethod
    def get_cache_max_search_entries() -> int:
        """Maximum number of cached search entries to retain in memory."""
        return CACHE_MAX_SEARCH_ENTRIES
