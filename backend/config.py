"""Centralized configuration for search settings."""

from typing import Optional

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
DEFAULT_LLM_MODEL = "gpt-4.1"  # Uses Chain-of-Thought reasoning internally

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