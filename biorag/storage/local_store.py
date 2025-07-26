"""Local storage system for processing downloaded biological data files."""

import os
import json
import pandas as pd
import numpy as np
from pathlib import Path
from typing import Dict, List, Any, Optional
from datetime import datetime

from .download_manager import DownloadManager
from ..embeddings import BioEmbeddingService
from ..data_sources import GEOClient, PubMedClient, UniProtClient


class LocalStore:
    """Local storage and processing for downloaded biological data."""
    
    def __init__(
        self, 
        base_dir: str = None,
        workspace_dir: str = None,
        embedding_service: BioEmbeddingService = None
    ):
        """Initialize local store.
        
        Args:
            base_dir: Base directory for downloads (deprecated)
            workspace_dir: User's workspace directory where downloads should go
            embedding_service: Embedding service for vectorizing documents
        """
        if workspace_dir:
            # Use workspace directory for downloads
            download_path = str(Path(workspace_dir) / "biorag_downloads")
        else:
            # Fallback to relative path in current directory
            download_path = base_dir or "biorag_downloads"
            
        self.download_manager = DownloadManager(download_path)
        self.embedding_service = embedding_service or BioEmbeddingService()
        
        # Data source clients for fetching
        self.geo_client = GEOClient()
        self.pubmed_client = PubMedClient()
        self.uniprot_client = UniProtClient()
        
        # Current session data (processed from downloaded files)
        self.session_documents = []
        self.session_embeddings = []
    
    async def fetch_and_download(
        self, 
        query: str,
        source_types: List[str] = None,
        max_items_per_source: int = 3
    ) -> List[Dict[str, Any]]:
        """Fetch data from external sources and download to local files.
        
        Args:
            query: Search query
            source_types: List of source types to search
            max_items_per_source: Maximum items to download per source
            
        Returns:
            List of processed documents from downloaded files
        """
        self.session_documents = []
        self.session_embeddings = []
        
        if source_types is None:
            source_types = ["PubMed", "GEO", "UniProt"]
        
        downloaded_files = []
        
        # Download from each source
        for source_type in source_types:
            try:
                if source_type == "PubMed":
                    files = await self._download_pubmed_data(query, max_items_per_source)
                elif source_type == "GEO":
                    files = await self._download_geo_data(query, max_items_per_source)
                elif source_type == "UniProt":
                    files = await self._download_uniprot_data(query, max_items_per_source)
                else:
                    continue
                
                downloaded_files.extend(files)
                
            except Exception as e:
                print(f"Error downloading from {source_type}: {e}")
                continue
        
        # Process downloaded files into documents
        if downloaded_files:
            self.session_documents = await self._process_downloaded_files(downloaded_files)
            
            # Create embeddings for search
            if self.session_documents:
                embedded_docs = await self.embedding_service.encode_biological_documents(
                    self.session_documents
                )
                self.session_documents = embedded_docs
                
                # Extract embeddings for similarity search
                self.session_embeddings = []
                for doc in embedded_docs:
                    if "embedding" in doc:
                        self.session_embeddings.append(doc["embedding"])
        
        return self.session_documents
    
    async def _download_pubmed_data(self, query: str, limit: int) -> List[str]:
        """Download PubMed articles for query.
        
        Args:
            query: Search query
            limit: Maximum articles to download
            
        Returns:
            List of downloaded file paths
        """
        try:
            # Search PubMed for articles
            articles = await self.pubmed_client.search(query, limit=limit)
            
            downloaded_files = []
            for article in articles:
                pmid = article.get("id") or article.get("pmid")
                if pmid:
                    file_path = await self.download_manager.download_pubmed_article(
                        pmid, article
                    )
                    if file_path:
                        downloaded_files.append(file_path)
            
            return downloaded_files
            
        except Exception as e:
            print(f"Error downloading PubMed data: {e}")
            return []
    
    async def _download_geo_data(self, query: str, limit: int) -> List[str]:
        """Download GEO datasets for query - now gets actual expression data.
        
        Args:
            query: Search query
            limit: Maximum datasets to download
            
        Returns:
            List of downloaded file paths
        """
        try:
            # Import the specialized GEO downloader
            from .geo_data_downloader import GEODataDownloader
            
            # Search GEO for datasets
            datasets = await self.geo_client.search(query, limit=limit)
            
            # Initialize GEO data downloader
            geo_downloader = GEODataDownloader(str(self.download_manager.base_dir))
            
            downloaded_files = []
            for dataset in datasets:
                geo_id = dataset.get("id") or dataset.get("geo_id")
                if geo_id and geo_id.startswith("GSE"):
                    print(f"📊 Downloading expression data for {geo_id}")
                    
                    # Download actual gene expression data
                    result = await geo_downloader.download_geo_expression_data(geo_id, dataset)
                    
                    if result and result.get("files_downloaded", {}).get("processed_data"):
                        # Add the processed data files
                        processed_data = result["files_downloaded"]["processed_data"]
                        if processed_data.get("expression_matrix"):
                            downloaded_files.append(processed_data["expression_matrix"])
                        if processed_data.get("sample_info"):
                            downloaded_files.append(processed_data["sample_info"])
                        if processed_data.get("analysis_info"):
                            downloaded_files.append(processed_data["analysis_info"])
            
            return downloaded_files
            
        except Exception as e:
            print(f"Error downloading GEO data: {e}")
            return []
    
    async def _download_uniprot_data(self, query: str, limit: int) -> List[str]:
        """Download UniProt entries for query.
        
        Args:
            query: Search query
            limit: Maximum entries to download
            
        Returns:
            List of downloaded file paths
        """
        try:
            # Search UniProt for proteins
            proteins = await self.uniprot_client.search(query, limit=limit)
            
            downloaded_files = []
            for protein in proteins:
                uniprot_id = protein.get("id") or protein.get("accession")
                if uniprot_id:
                    file_path = await self.download_manager.download_uniprot_entry(
                        uniprot_id, protein
                    )
                    if file_path:
                        downloaded_files.append(file_path)
            
            return downloaded_files
            
        except Exception as e:
            print(f"Error downloading UniProt data: {e}")
            return []
    
    async def _process_downloaded_files(self, file_paths: List[str]) -> List[Dict[str, Any]]:
        """Process downloaded files into searchable documents.
        
        Args:
            file_paths: List of downloaded file paths
            
        Returns:
            List of processed document objects
        """
        documents = []
        
        for file_path in file_paths:
            try:
                file_path_obj = Path(file_path)
                
                # Determine file type and process accordingly
                if "pubmed_articles" in str(file_path):
                    doc = await self._process_pubmed_file(file_path_obj)
                elif "geo_datasets" in str(file_path):
                    doc = await self._process_geo_file(file_path_obj)
                elif "uniprot_data" in str(file_path):
                    doc = await self._process_uniprot_file(file_path_obj)
                else:
                    continue
                
                if doc:
                    documents.append(doc)
                    
            except Exception as e:
                print(f"Error processing file {file_path}: {e}")
                continue
        
        return documents
    
    async def _process_pubmed_file(self, file_path: Path) -> Optional[Dict[str, Any]]:
        """Process a downloaded PubMed article file.
        
        Args:
            file_path: Path to article file
            
        Returns:
            Document object
        """
        try:
            # Read article content
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Load metadata
            metadata_path = file_path.parent / "metadata.json"
            metadata = {}
            if metadata_path.exists():
                with open(metadata_path, 'r') as f:
                    metadata = json.load(f)
            
            article_info = metadata.get("article_info", {})
            
            return {
                "id": metadata.get("pmid", file_path.stem),
                "title": article_info.get("title", ""),
                "description": content,
                "source": "PubMed",
                "type": "article",
                "file_path": str(file_path),
                "download_date": metadata.get("download_date"),
                "mesh_terms": article_info.get("mesh_terms", []),
                "keywords": article_info.get("keywords", []),
                "publication_date": article_info.get("publication_date"),
                "embedding_text": content
            }
            
        except Exception as e:
            print(f"Error processing PubMed file {file_path}: {e}")
            return None
    
    async def _process_geo_file(self, file_path: Path) -> Optional[Dict[str, Any]]:
        """Process a downloaded GEO dataset file.
        
        Args:
            file_path: Path to dataset file
            
        Returns:
            Document object
        """
        try:
            # Load metadata
            metadata_path = file_path.parent / "metadata.json"
            metadata = {}
            if metadata_path.exists():
                with open(metadata_path, 'r') as f:
                    metadata = json.load(f)
            
            dataset_info = metadata.get("dataset_info", {})
            
            # Try to read and summarize data file content
            content_summary = ""
            if file_path.suffix == ".txt":
                try:
                    # Try to read as tab-delimited data
                    df = pd.read_csv(file_path, sep='\t', nrows=5)
                    content_summary = f"Dataset contains {len(df.columns)} columns. Sample columns: {', '.join(df.columns[:5])}."
                except:
                    # Read as text
                    with open(file_path, 'r', encoding='utf-8') as f:
                        lines = f.readlines()[:10]
                    content_summary = f"Dataset contains {len(lines)} lines (showing first 10):\n" + "".join(lines)
            
            description = f"{dataset_info.get('title', '')} {dataset_info.get('summary', '')} {content_summary}".strip()
            
            return {
                "id": metadata.get("geo_id", file_path.stem),
                "title": dataset_info.get("title", ""),
                "description": description,
                "source": "GEO",
                "type": "dataset",
                "file_path": str(file_path),
                "download_date": metadata.get("download_date"),
                "organism": dataset_info.get("organism"),
                "platform": dataset_info.get("platform"),
                "series_type": dataset_info.get("series_type"),
                "embedding_text": description
            }
            
        except Exception as e:
            print(f"Error processing GEO file {file_path}: {e}")
            return None
    
    async def _process_uniprot_file(self, file_path: Path) -> Optional[Dict[str, Any]]:
        """Process a downloaded UniProt entry file.
        
        Args:
            file_path: Path to protein file
            
        Returns:
            Document object
        """
        try:
            # Read protein information
            content = ""
            if file_path.suffix == ".txt":
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
            
            # Load metadata
            metadata_path = file_path.parent / "metadata.json"
            metadata = {}
            if metadata_path.exists():
                with open(metadata_path, 'r') as f:
                    metadata = json.load(f)
            
            entry_info = metadata.get("entry_info", {})
            
            return {
                "id": metadata.get("uniprot_id", file_path.stem),
                "title": entry_info.get("protein_name", ""),
                "description": content,
                "source": "UniProt",
                "type": "protein",
                "file_path": str(file_path),
                "download_date": metadata.get("download_date"),
                "organism": entry_info.get("organism"),
                "gene_names": entry_info.get("gene_names", []),
                "function": entry_info.get("function", ""),
                "embedding_text": content
            }
            
        except Exception as e:
            print(f"Error processing UniProt file {file_path}: {e}")
            return None
    
    async def search_local(self, query_text: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search within downloaded and processed documents.
        
        Args:
            query_text: Query text
            limit: Maximum results
            
        Returns:
            List of similar documents with scores
        """
        if not self.session_documents:
            return []
        
        # Get query embedding
        query_embedding_result = await self.embedding_service.encode(query_text)
        query_embedding = query_embedding_result[0] if len(query_embedding_result.shape) > 1 else query_embedding_result
        
        # Calculate similarities
        similarities = []
        for i, doc_embedding in enumerate(self.session_embeddings):
            if doc_embedding:
                # Convert to numpy arrays
                query_vec = np.array(query_embedding)
                doc_vec = np.array(doc_embedding)
                
                # Calculate cosine similarity
                similarity = np.dot(query_vec, doc_vec) / (
                    np.linalg.norm(query_vec) * np.linalg.norm(doc_vec)
                )
                similarities.append((i, float(similarity)))
        
        # Sort by similarity and return top results
        similarities.sort(key=lambda x: x[1], reverse=True)
        top_indices = similarities[:limit]
        
        results = []
        for idx, score in top_indices:
            doc = self.session_documents[idx].copy()
            doc["similarity_score"] = score
            results.append(doc)
        
        return results
    
    def get_download_summary(self) -> Dict[str, Any]:
        """Get summary of all downloaded data.
        
        Returns:
            Download summary with file counts and sizes
        """
        return self.download_manager.get_download_summary()
    
    def clear_downloads(self, older_than_days: int = None):
        """Clear downloaded files.
        
        Args:
            older_than_days: Only clear files older than this many days
        """
        self.download_manager.clear_downloads(older_than_days)
        self.session_documents = []
        self.session_embeddings = [] 