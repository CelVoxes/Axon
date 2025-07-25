"""Base client for biological data sources."""

import time
import asyncio
from abc import ABC, abstractmethod
from typing import Dict, List, Any, Optional
import httpx
from ..config import settings
import asyncio


class BaseDataSource(ABC):
    """Base class for all biological data source clients."""
    
    def __init__(self, base_url: str, rate_limit: float = None):
        """Initialize the data source client.
        
        Args:
            base_url: Base URL for the API
            rate_limit: Rate limit in requests per second
        """
        self.base_url = base_url
        self.rate_limit = rate_limit or settings.rate_limit_per_second
        self.last_request_time = 0
        self.client = httpx.AsyncClient(timeout=30.0)
    
    async def _make_request(
        self, 
        method: str, 
        url: str, 
        **kwargs
    ) -> httpx.Response:
        """Make an HTTP request with rate limiting.
        
        Args:
            method: HTTP method (GET, POST, etc.)
            url: Request URL
            **kwargs: Additional request parameters
            
        Returns:
            HTTP response
        """
        # Rate limiting
        current_time = time.time()
        time_since_last = current_time - self.last_request_time
        min_interval = 1.0 / self.rate_limit
        
        if time_since_last < min_interval:
            await asyncio.sleep(min_interval - time_since_last)
        
        self.last_request_time = time.time()
        
        # Make request
        response = await self.client.request(method, url, **kwargs)
        response.raise_for_status()
        return response
    
    @abstractmethod
    async def search(
        self, 
        query: str, 
        limit: int = 10, 
        **kwargs
    ) -> List[Dict[str, Any]]:
        """Search for data using the given query.
        
        Args:
            query: Search query
            limit: Maximum number of results
            **kwargs: Additional search parameters
            
        Returns:
            List of search results
        """
        pass
    
    @abstractmethod
    async def get_details(self, identifier: str) -> Dict[str, Any]:
        """Get detailed information for a specific identifier.
        
        Args:
            identifier: Unique identifier for the data
            
        Returns:
            Detailed information dictionary
        """
        pass
    
    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()
    
    async def __aenter__(self):
        """Async context manager entry."""
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.close() 