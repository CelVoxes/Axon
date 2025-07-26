"""Download manager for saving biological data files to user's computer."""

import os
import shutil
import aiofiles
import asyncio
from pathlib import Path
from typing import Dict, List, Any, Optional
from datetime import datetime
import hashlib
import json


class DownloadManager:
    """Manages downloading and organizing biological data files."""
    
    def __init__(self, base_dir: str = "biorag_downloads"):
        """Initialize download manager.
        
        Args:
            base_dir: Base directory for all downloads
        """
        self.base_dir = Path(base_dir).resolve()
        self.ensure_directory_structure()
    
    def ensure_directory_structure(self):
        """Create the directory structure for organizing downloads."""
        directories = [
            self.base_dir,
            self.base_dir / "geo_datasets",
            self.base_dir / "pubmed_articles", 
            self.base_dir / "uniprot_data",
            self.base_dir / "processed",
            self.base_dir / "metadata"
        ]
        
        for directory in directories:
            directory.mkdir(parents=True, exist_ok=True)
    
    async def download_geo_dataset(
        self, 
        geo_id: str, 
        dataset_info: Dict[str, Any],
        download_type: str = "series_matrix"
    ) -> Optional[str]:
        """Download GEO dataset files.
        
        Args:
            geo_id: GEO accession ID (e.g., GSE12345)
            dataset_info: Dataset metadata
            download_type: Type of file to download (series_matrix, soft, etc.)
            
        Returns:
            Path to downloaded file or None if failed
        """
        try:
            # Create dataset-specific directory
            dataset_dir = self.base_dir / "geo_datasets" / geo_id
            dataset_dir.mkdir(exist_ok=True)
            
            # Determine download URL based on type
            if download_type == "series_matrix":
                # Download series matrix file
                filename = f"{geo_id}_series_matrix.txt.gz"
                url = f"https://ftp.ncbi.nlm.nih.gov/geo/series/{geo_id[:-3]}nnn/{geo_id}/matrix/{filename}"
            elif download_type == "soft":
                # Download SOFT format file  
                filename = f"{geo_id}_family.soft.gz"
                url = f"https://ftp.ncbi.nlm.nih.gov/geo/series/{geo_id[:-3]}nnn/{geo_id}/soft/{filename}"
            else:
                print(f"Unsupported download type: {download_type}")
                return None
            
            file_path = dataset_dir / filename
            
            # Check if file already exists
            if file_path.exists():
                print(f"File already exists: {file_path}")
                return str(file_path)
            
            # Download the file
            print(f"Downloading {geo_id} data to {file_path}")
            success = await self._download_file(url, file_path)
            
            if success:
                # Save metadata
                await self._save_metadata(dataset_dir / "metadata.json", {
                    "geo_id": geo_id,
                    "download_type": download_type,
                    "download_date": datetime.utcnow().isoformat(),
                    "file_path": str(file_path),
                    "dataset_info": dataset_info,
                    "url": url
                })
                
                # Extract if compressed
                if filename.endswith('.gz'):
                    extracted_path = await self._extract_gz(file_path)
                    if extracted_path:
                        return str(extracted_path)
                
                return str(file_path)
            
            return None
            
        except Exception as e:
            print(f"Error downloading GEO dataset {geo_id}: {e}")
            return None
    
    async def download_pubmed_article(
        self, 
        pmid: str, 
        article_info: Dict[str, Any]
    ) -> Optional[str]:
        """Download PubMed article data.
        
        Args:
            pmid: PubMed ID
            article_info: Article metadata
            
        Returns:
            Path to saved article file
        """
        try:
            # Create article-specific directory
            article_dir = self.base_dir / "pubmed_articles" / pmid
            article_dir.mkdir(parents=True, exist_ok=True)
            
            # Save article text/abstract
            article_file = article_dir / f"{pmid}_article.txt"
            
            # Combine title, abstract, and available text
            content_parts = []
            if article_info.get("title"):
                content_parts.append(f"Title: {article_info['title']}")
            if article_info.get("abstract"):
                content_parts.append(f"Abstract: {article_info['abstract']}")
            if article_info.get("mesh_terms"):
                content_parts.append(f"MeSH Terms: {', '.join(article_info['mesh_terms'])}")
            if article_info.get("keywords"):
                content_parts.append(f"Keywords: {', '.join(article_info['keywords'])}")
            
            content = "\n\n".join(content_parts)
            
            # Save article content
            async with aiofiles.open(article_file, 'w', encoding='utf-8') as f:
                await f.write(content)
            
            # Save metadata
            await self._save_metadata(article_dir / "metadata.json", {
                "pmid": pmid,
                "download_date": datetime.utcnow().isoformat(),
                "file_path": str(article_file),
                "article_info": article_info
            })
            
            print(f"Saved PubMed article {pmid} to {article_file}")
            return str(article_file)
            
        except Exception as e:
            print(f"Error saving PubMed article {pmid}: {e}")
            return None
    
    async def download_uniprot_entry(
        self, 
        uniprot_id: str, 
        entry_info: Dict[str, Any]
    ) -> Optional[str]:
        """Download UniProt protein data.
        
        Args:
            uniprot_id: UniProt accession ID
            entry_info: Protein entry metadata
            
        Returns:
            Path to saved protein file
        """
        try:
            # Create protein-specific directory
            protein_dir = self.base_dir / "uniprot_data" / uniprot_id
            protein_dir.mkdir(parents=True, exist_ok=True)
            
            # Download FASTA sequence
            fasta_file = protein_dir / f"{uniprot_id}.fasta"
            fasta_url = f"https://rest.uniprot.org/uniprotkb/{uniprot_id}.fasta"
            
            fasta_success = await self._download_file(fasta_url, fasta_file)
            
            # Save protein information as text
            info_file = protein_dir / f"{uniprot_id}_info.txt"
            
            info_parts = []
            if entry_info.get("protein_name"):
                info_parts.append(f"Protein Name: {entry_info['protein_name']}")
            if entry_info.get("function"):
                info_parts.append(f"Function: {entry_info['function']}")
            if entry_info.get("organism"):
                info_parts.append(f"Organism: {entry_info['organism']}")
            if entry_info.get("gene_names"):
                info_parts.append(f"Gene Names: {', '.join(entry_info['gene_names'])}")
            
            info_content = "\n\n".join(info_parts)
            
            async with aiofiles.open(info_file, 'w', encoding='utf-8') as f:
                await f.write(info_content)
            
            # Save metadata
            await self._save_metadata(protein_dir / "metadata.json", {
                "uniprot_id": uniprot_id,
                "download_date": datetime.utcnow().isoformat(),
                "fasta_file": str(fasta_file) if fasta_success else None,
                "info_file": str(info_file),
                "entry_info": entry_info
            })
            
            print(f"Saved UniProt entry {uniprot_id} to {protein_dir}")
            return str(info_file)
            
        except Exception as e:
            print(f"Error saving UniProt entry {uniprot_id}: {e}")
            return None
    
    async def _download_file(self, url: str, file_path: Path) -> bool:
        """Download a file from URL to local path.
        
        Args:
            url: Download URL
            file_path: Local file path
            
        Returns:
            True if successful, False otherwise
        """
        try:
            import httpx
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url)
                response.raise_for_status()
                
                async with aiofiles.open(file_path, 'wb') as f:
                    await f.write(response.content)
                
                return True
                
        except Exception as e:
            print(f"Error downloading {url}: {e}")
            return False
    
    async def _extract_gz(self, gz_path: Path) -> Optional[Path]:
        """Extract a gzipped file.
        
        Args:
            gz_path: Path to .gz file
            
        Returns:
            Path to extracted file or None
        """
        try:
            import gzip
            
            extracted_path = gz_path.with_suffix('')
            
            with gzip.open(gz_path, 'rb') as f_in:
                async with aiofiles.open(extracted_path, 'wb') as f_out:
                    await f_out.write(f_in.read())
            
            print(f"Extracted {gz_path} to {extracted_path}")
            return extracted_path
            
        except Exception as e:
            print(f"Error extracting {gz_path}: {e}")
            return None
    
    async def _save_metadata(self, metadata_path: Path, metadata: Dict[str, Any]):
        """Save metadata to JSON file.
        
        Args:
            metadata_path: Path to metadata file
            metadata: Metadata dictionary
        """
        try:
            async with aiofiles.open(metadata_path, 'w', encoding='utf-8') as f:
                await f.write(json.dumps(metadata, indent=2))
        except Exception as e:
            print(f"Error saving metadata to {metadata_path}: {e}")
    
    def get_download_summary(self) -> Dict[str, Any]:
        """Get summary of downloaded files.
        
        Returns:
            Summary of downloads
        """
        summary = {
            "base_directory": str(self.base_dir),
            "geo_datasets": len(list((self.base_dir / "geo_datasets").glob("*/"))),
            "pubmed_articles": len(list((self.base_dir / "pubmed_articles").glob("*/"))),
            "uniprot_entries": len(list((self.base_dir / "uniprot_data").glob("*/"))),
            "total_size_mb": self._get_directory_size(self.base_dir) / (1024 * 1024)
        }
        return summary
    
    def _get_directory_size(self, directory: Path) -> int:
        """Get total size of directory in bytes.
        
        Args:
            directory: Directory path
            
        Returns:
            Size in bytes
        """
        try:
            total_size = 0
            for dirpath, dirnames, filenames in os.walk(directory):
                for filename in filenames:
                    file_path = os.path.join(dirpath, filename)
                    if os.path.exists(file_path):
                        total_size += os.path.getsize(file_path)
            return total_size
        except Exception:
            return 0
    
    def clear_downloads(self, older_than_days: int = None):
        """Clear downloaded files.
        
        Args:
            older_than_days: Only clear files older than this many days
        """
        try:
            if older_than_days is None:
                # Clear everything
                if self.base_dir.exists():
                    shutil.rmtree(self.base_dir)
                    self.ensure_directory_structure()
                    print("Cleared all downloads")
            else:
                # Clear files older than specified days
                cutoff_time = datetime.utcnow().timestamp() - (older_than_days * 24 * 3600)
                
                for item in self.base_dir.rglob("*"):
                    if item.is_file() and item.stat().st_mtime < cutoff_time:
                        item.unlink()
                        print(f"Deleted old file: {item}")
                
        except Exception as e:
            print(f"Error clearing downloads: {e}") 