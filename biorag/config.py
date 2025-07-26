"""Configuration management for BioRAG system."""

import os
from typing import Optional
try:
    from pydantic_settings import BaseSettings
except ImportError:
    from pydantic import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Application settings."""
    
    # OpenAI Configuration
    openai_api_key: str = Field(default="", env="OPENAI_API_KEY")
    openai_model: str = Field(default="gpt-4o-mini", env="OPENAI_MODEL")
    
    # Biological Database APIs
    geo_api_base: str = Field(
        default="https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi",
        env="GEO_API_BASE"
    )
    pubmed_api_base: str = Field(
        default="https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
        env="PUBMED_API_BASE"
    )
    uniprot_api_base: str = Field(
        default="https://rest.uniprot.org",
        env="UNIPROT_API_BASE"
    )
    ncbi_api_key: Optional[str] = Field(default=None, env="NCBI_API_KEY")
    
    # Download Configuration
    download_directory: str = Field(
        default="./biorag_downloads",
        env="DOWNLOAD_DIRECTORY"
    )
    
    # Embedding Configuration
    embedding_model: str = Field(
        default="all-MiniLM-L6-v2",
        env="EMBEDDING_MODEL"
    )
    embedding_dimension: int = Field(default=384, env="EMBEDDING_DIMENSION")
    
    # API Configuration
    api_host: str = Field(default="0.0.0.0", env="API_HOST")
    api_port: int = Field(default=8000, env="API_PORT")
    api_reload: bool = Field(default=True, env="API_RELOAD")
    
    # Logging
    log_level: str = Field(default="INFO", env="LOG_LEVEL")
    log_file: str = Field(default="biorag.log", env="LOG_FILE")
    
    # Rate Limiting
    rate_limit_per_second: int = Field(default=3, env="RATE_LIMIT_PER_SECOND")
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


# Global settings instance
settings = Settings() 