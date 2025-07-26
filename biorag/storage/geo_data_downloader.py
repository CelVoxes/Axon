"""GEO data downloader for actual gene expression matrices and count data."""

import os
import gzip
import pandas as pd
import numpy as np
import aiofiles
import asyncio
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime
import json
import re


class GEODataDownloader:
    """Downloads and processes actual GEO gene expression data for analysis."""
    
    def __init__(self, base_dir: str = None, workspace_dir: str = None):
        """Initialize GEO data downloader.
        
        Args:
            base_dir: Base directory for downloads (deprecated)
            workspace_dir: User's workspace directory where downloads should go
        """
        if workspace_dir:
            # Use workspace directory for downloads
            self.base_dir = Path(workspace_dir) / "biorag_downloads"
        else:
            # Fallback to relative path in current directory
            self.base_dir = Path(base_dir or "biorag_downloads").resolve()
            
        self.geo_dir = self.base_dir / "geo_data"
        self.ensure_directory_structure()
    
    def ensure_directory_structure(self):
        """Create directory structure for GEO data."""
        directories = [
            self.geo_dir,
            self.geo_dir / "raw_data",
            self.geo_dir / "processed_data", 
            self.geo_dir / "metadata"
        ]
        
        for directory in directories:
            directory.mkdir(parents=True, exist_ok=True)
    
    async def download_geo_expression_data(
        self, 
        geo_id: str,
        dataset_info: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Download and process GEO gene expression data.
        
        Args:
            geo_id: GEO accession (e.g., GSE12345)
            dataset_info: Dataset metadata
            
        Returns:
            Information about downloaded data files
        """
        try:
            print(f"📊 Downloading gene expression data for {geo_id}")
            
            # Create dataset-specific directory
            dataset_dir = self.geo_dir / "raw_data" / geo_id
            dataset_dir.mkdir(parents=True, exist_ok=True)
            
            # Download series matrix file (main expression data)
            matrix_file = await self._download_series_matrix(geo_id, dataset_dir)
            
            # Download supplementary files if available
            suppl_files = await self._download_supplementary_files(geo_id, dataset_dir)
            
            # Process the data into analysis-ready format
            processed_data = await self._process_expression_data(
                geo_id, matrix_file, dataset_info
            )
            
            # Save metadata
            metadata = {
                "geo_id": geo_id,
                "download_date": datetime.utcnow().isoformat(),
                "files_downloaded": {
                    "matrix_file": str(matrix_file) if matrix_file else None,
                    "supplementary_files": [str(f) for f in suppl_files],
                    "processed_data": processed_data
                },
                "dataset_info": dataset_info,
                "analysis_ready": processed_data is not None
            }
            
            metadata_file = dataset_dir / "download_metadata.json"
            async with aiofiles.open(metadata_file, 'w') as f:
                await f.write(json.dumps(metadata, indent=2))
            
            print(f"✅ Downloaded {geo_id}: {len(suppl_files)} files, analysis-ready: {processed_data is not None}")
            
            return metadata
            
        except Exception as e:
            print(f"❌ Error downloading {geo_id}: {e}")
            return None
    
    async def _download_series_matrix(
        self, 
        geo_id: str, 
        dataset_dir: Path
    ) -> Optional[Path]:
        """Download GEO series matrix file."""
        try:
            # Construct FTP URL for series matrix
            series_prefix = geo_id[:-3] + "nnn"  # e.g., GSE123nnn
            matrix_filename = f"{geo_id}_series_matrix.txt.gz"
            
            ftp_url = f"https://ftp.ncbi.nlm.nih.gov/geo/series/{series_prefix}/{geo_id}/matrix/{matrix_filename}"
            
            matrix_path = dataset_dir / matrix_filename
            
            # Download the file
            success = await self._download_file(ftp_url, matrix_path)
            
            if success:
                # Extract if it's gzipped
                if matrix_filename.endswith('.gz'):
                    extracted_path = await self._extract_gz(matrix_path)
                    return extracted_path
                return matrix_path
            
            return None
            
        except Exception as e:
            print(f"Error downloading series matrix for {geo_id}: {e}")
            return None
    
    async def _download_supplementary_files(
        self, 
        geo_id: str, 
        dataset_dir: Path
    ) -> List[Path]:
        """Download supplementary files that might contain count data."""
        try:
            # Common supplementary file patterns
            file_patterns = [
                f"{geo_id}_RAW.tar",
                "*.txt.gz",
                "*.csv.gz", 
                "*counts*.txt",
                "*expression*.txt",
                "*fpkm*.txt",
                "*tpm*.txt"
            ]
            
            downloaded_files = []
            
            # Try to download common file types
            series_prefix = geo_id[:-3] + "nnn"
            suppl_base_url = f"https://ftp.ncbi.nlm.nih.gov/geo/series/{series_prefix}/{geo_id}/suppl/"
            
            # For now, try some common file names
            common_files = [
                f"{geo_id}_RAW.tar",
                f"{geo_id}_expression_data.txt.gz",
                f"{geo_id}_counts.txt.gz"
            ]
            
            for filename in common_files:
                try:
                    file_url = suppl_base_url + filename
                    file_path = dataset_dir / filename
                    
                    success = await self._download_file(file_url, file_path)
                    if success:
                        downloaded_files.append(file_path)
                        
                        # Extract if compressed
                        if filename.endswith('.gz') or filename.endswith('.tar'):
                            extracted = await self._extract_archive(file_path)
                            if extracted:
                                downloaded_files.extend(extracted)
                
                except Exception as e:
                    # Continue with other files if one fails
                    continue
            
            return downloaded_files
            
        except Exception as e:
            print(f"Error downloading supplementary files for {geo_id}: {e}")
            return []
    
    async def _process_expression_data(
        self, 
        geo_id: str, 
        matrix_file: Optional[Path],
        dataset_info: Dict[str, Any]
    ) -> Optional[Dict[str, str]]:
        """Process downloaded data into analysis-ready format."""
        try:
            if not matrix_file or not matrix_file.exists():
                return None
            
            print(f"🔄 Processing expression data for {geo_id}")
            
            processed_dir = self.geo_dir / "processed_data" / geo_id
            processed_dir.mkdir(parents=True, exist_ok=True)
            
            # Read and process the series matrix file
            expression_data, sample_info = await self._parse_series_matrix(matrix_file)
            
            if expression_data is not None:
                # Save processed expression data
                expression_file = processed_dir / f"{geo_id}_expression_matrix.csv"
                expression_data.to_csv(expression_file)
                
                # Save sample metadata
                if sample_info is not None:
                    sample_file = processed_dir / f"{geo_id}_sample_info.csv"
                    sample_info.to_csv(sample_file)
                
                # Create analysis info file
                analysis_info = {
                    "dataset_id": geo_id,
                    "files": {
                        "expression_matrix": str(expression_file),
                        "sample_info": str(sample_file) if sample_info is not None else None
                    },
                    "data_shape": list(expression_data.shape),
                    "sample_count": expression_data.shape[1],
                    "gene_count": expression_data.shape[0],
                    "analysis_type": self._determine_analysis_type(dataset_info),
                    "organism": dataset_info.get("organism", "Unknown"),
                    "platform": dataset_info.get("platform", "Unknown")
                }
                
                analysis_file = processed_dir / f"{geo_id}_analysis_info.json"
                async with aiofiles.open(analysis_file, 'w') as f:
                    await f.write(json.dumps(analysis_info, indent=2))
                
                print(f"✅ Processed {geo_id}: {expression_data.shape[0]} genes, {expression_data.shape[1]} samples")
                
                return {
                    "expression_matrix": str(expression_file),
                    "sample_info": str(sample_file) if sample_info is not None else None,
                    "analysis_info": str(analysis_file)
                }
            
            return None
            
        except Exception as e:
            print(f"Error processing expression data for {geo_id}: {e}")
            return None
    
    async def _parse_series_matrix(self, matrix_file: Path) -> Tuple[Optional[pd.DataFrame], Optional[pd.DataFrame]]:
        """Parse GEO series matrix file."""
        try:
            # Read the file
            with open(matrix_file, 'r') as f:
                lines = f.readlines()
            
            # Find the data section
            data_start = None
            sample_info_lines = []
            
            for i, line in enumerate(lines):
                if line.startswith('!Sample_'):
                    sample_info_lines.append(line)
                elif line.startswith('!series_matrix_table_begin'):
                    data_start = i + 1
                    break
            
            if data_start is None:
                return None, None
            
            # Extract data lines
            data_lines = []
            for i in range(data_start, len(lines)):
                line = lines[i].strip()
                if line.startswith('!series_matrix_table_end'):
                    break
                if line and not line.startswith('!'):
                    data_lines.append(line)
            
            if not data_lines:
                return None, None
            
            # Parse into DataFrame
            data_rows = []
            headers = None
            
            for i, line in enumerate(data_lines):
                parts = line.split('\t')
                if i == 0:
                    headers = parts
                else:
                    data_rows.append(parts)
            
            if not headers or not data_rows:
                return None, None
            
            # Create expression matrix
            df = pd.DataFrame(data_rows, columns=headers)
            
            # Set gene ID as index (usually first column)
            if len(df.columns) > 1:
                df.set_index(df.columns[0], inplace=True)
                
                # Convert to numeric
                for col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors='coerce')
            
            # Parse sample info
            sample_info = self._parse_sample_info(sample_info_lines, headers[1:] if len(headers) > 1 else [])
            
            return df, sample_info
            
        except Exception as e:
            print(f"Error parsing series matrix: {e}")
            return None, None
    
    def _parse_sample_info(self, sample_lines: List[str], sample_ids: List[str]) -> Optional[pd.DataFrame]:
        """Parse sample information from series matrix."""
        try:
            info_dict = {}
            
            for line in sample_lines:
                if '=' in line:
                    key_part, value_part = line.split('=', 1)
                    key = key_part.strip().replace('!Sample_', '')
                    
                    # Parse tab-separated values
                    values = value_part.strip().strip('"').split('\t')
                    if len(values) == len(sample_ids):
                        info_dict[key] = values
            
            if info_dict:
                sample_df = pd.DataFrame(info_dict, index=sample_ids)
                return sample_df
            
            return None
            
        except Exception as e:
            print(f"Error parsing sample info: {e}")
            return None
    
    def _determine_analysis_type(self, dataset_info: Dict[str, Any]) -> str:
        """Determine the type of analysis based on dataset info."""
        title = dataset_info.get("title", "").lower()
        summary = dataset_info.get("summary", "").lower()
        text = f"{title} {summary}"
        
        if any(term in text for term in ["cancer", "tumor", "carcinoma"]):
            return "cancer_analysis"
        elif any(term in text for term in ["differential", "comparison", "vs", "versus"]):
            return "differential_expression"
        elif any(term in text for term in ["time", "temporal", "development"]):
            return "time_series"
        elif any(term in text for term in ["treatment", "drug", "compound"]):
            return "treatment_response"
        else:
            return "general_expression"
    
    async def _download_file(self, url: str, file_path: Path) -> bool:
        """Download a file from URL."""
        try:
            import httpx
            
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.get(url)
                response.raise_for_status()
                
                async with aiofiles.open(file_path, 'wb') as f:
                    await f.write(response.content)
                
                return True
                
        except Exception as e:
            print(f"Download failed for {url}: {e}")
            return False
    
    async def _extract_gz(self, gz_path: Path) -> Optional[Path]:
        """Extract a gzipped file."""
        try:
            import gzip
            
            extracted_path = gz_path.with_suffix('')
            
            with gzip.open(gz_path, 'rb') as f_in:
                async with aiofiles.open(extracted_path, 'wb') as f_out:
                    await f_out.write(f_in.read())
            
            return extracted_path
            
        except Exception as e:
            print(f"Error extracting {gz_path}: {e}")
            return None
    
    async def _extract_archive(self, archive_path: Path) -> List[Path]:
        """Extract archive files (tar, gz)."""
        try:
            extracted_files = []
            
            if archive_path.suffix == '.tar':
                import tarfile
                with tarfile.open(archive_path, 'r') as tar:
                    tar.extractall(archive_path.parent)
                    extracted_files = [archive_path.parent / name for name in tar.getnames()]
            
            elif archive_path.suffix == '.gz':
                extracted = await self._extract_gz(archive_path)
                if extracted:
                    extracted_files = [extracted]
            
            return extracted_files
            
        except Exception as e:
            print(f"Error extracting archive {archive_path}: {e}")
            return []
    
    def get_downloaded_datasets(self) -> List[Dict[str, Any]]:
        """Get list of downloaded and processed datasets."""
        datasets = []
        
        try:
            processed_dir = self.geo_dir / "processed_data"
            if processed_dir.exists():
                for dataset_dir in processed_dir.iterdir():
                    if dataset_dir.is_dir():
                        analysis_file = dataset_dir / f"{dataset_dir.name}_analysis_info.json"
                        if analysis_file.exists():
                            with open(analysis_file, 'r') as f:
                                analysis_info = json.load(f)
                                datasets.append(analysis_info)
        
        except Exception as e:
            print(f"Error getting downloaded datasets: {e}")
        
        return datasets 