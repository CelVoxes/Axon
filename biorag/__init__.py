"""
BioRAG - Biological Retrieval-Augmented Generation System

A comprehensive RAG system for biological data retrieval and analysis.
"""

__version__ = "0.1.0"
__author__ = "BioRAG Team"

from .client import BioRAGClient
from .config import Settings

__all__ = ["BioRAGClient", "Settings"] 