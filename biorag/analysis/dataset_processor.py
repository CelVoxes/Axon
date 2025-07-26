"""Dataset download and preprocessing pipeline."""

import os
import asyncio
import subprocess
import pandas as pd
import numpy as np
from typing import Dict, Any, Optional, List
from pathlib import Path
import httpx
import gzip
import tarfile
from datetime import datetime
import sqlite3
from contextlib import asynccontextmanager

from ..config import settings

class DatasetProcessor:
    """Handles dataset download, processing, and storage."""
    
    def __init__(self, workspace_dir: str = None):
        """Initialize dataset processor.
        
        Args:
            workspace_dir: User's workspace directory where data should be stored
        """
        if workspace_dir:
            self.data_dir = Path(workspace_dir) / "biorag_downloads" / "datasets"
        else:
            self.data_dir = Path(settings.data_directory) if hasattr(settings, 'data_directory') else Path("./data")
        
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.data_dir / "datasets.db"
        self._init_database()
    
    def _init_database(self):
        """Initialize SQLite database for tracking dataset status."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS dataset_status (
                    dataset_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    progress REAL DEFAULT 0.0,
                    error_message TEXT,
                    file_paths TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS dataset_metadata (
                    dataset_id TEXT PRIMARY KEY,
                    title TEXT,
                    organism TEXT,
                    platform TEXT,
                    samples INTEGER,
                    conditions TEXT,
                    raw_metadata TEXT
                )
            """)
    
    async def download_dataset(self, dataset_id: str) -> Dict[str, str]:
        """Download a GEO dataset."""
        await self.set_status(dataset_id, "downloading", 0.0)
        
        try:
            dataset_dir = self.data_dir / dataset_id
            dataset_dir.mkdir(exist_ok=True)
            
            # Download series matrix file
            matrix_url = f"https://ftp.ncbi.nlm.nih.gov/geo/series/{dataset_id[:-3]}nnn/{dataset_id}/matrix/{dataset_id}_series_matrix.txt.gz"
            
            await self.set_status(dataset_id, "downloading", 0.2)
            
            # Download with httpx
            async with httpx.AsyncClient(timeout=300.0) as client:
                response = await client.get(matrix_url)
                if response.status_code == 200:
                    matrix_file = dataset_dir / f"{dataset_id}_series_matrix.txt.gz"
                    with open(matrix_file, "wb") as f:
                        f.write(response.content)
                else:
                    raise Exception(f"Failed to download matrix file: {response.status_code}")
            
            await self.set_status(dataset_id, "downloading", 0.6)
            
            # Try to download raw data (optional)
            try:
                await self._download_raw_data(dataset_id, dataset_dir)
            except Exception as e:
                print(f"Raw data download failed (continuing with matrix): {e}")
            
            await self.set_status(dataset_id, "downloaded", 1.0)
            
            # Update file paths
            file_paths = {
                "matrix": str(matrix_file),
                "directory": str(dataset_dir)
            }
            await self._update_file_paths(dataset_id, file_paths)
            
            return file_paths
            
        except Exception as e:
            await self.set_status(dataset_id, "error", error_message=str(e))
            raise
    
    async def _download_raw_data(self, dataset_id: str, dataset_dir: Path):
        """Attempt to download raw data files."""
        # This is a simplified version - in production you'd use GEOparse or similar
        raw_url = f"https://ftp.ncbi.nlm.nih.gov/geo/series/{dataset_id[:-3]}nnn/{dataset_id}/suppl/"
        
        # For now, we'll just note that raw data could be downloaded here
        print(f"Raw data would be downloaded from: {raw_url}")
    
    async def process_dataset(self, dataset_id: str) -> Dict[str, Any]:
        """Process downloaded dataset into analysis-ready format."""
        await self.set_status(dataset_id, "processing", 0.0)
        
        try:
            dataset_dir = self.data_dir / dataset_id
            matrix_file = dataset_dir / f"{dataset_id}_series_matrix.txt.gz"
            
            if not matrix_file.exists():
                raise Exception("Matrix file not found")
            
            # Parse series matrix file
            await self.set_status(dataset_id, "processing", 0.2)
            expression_data, metadata = await self._parse_series_matrix(matrix_file)
            
            # Save processed data
            await self.set_status(dataset_id, "processing", 0.6)
            processed_files = await self._save_processed_data(
                dataset_id, dataset_dir, expression_data, metadata
            )
            
            # Store metadata in database
            await self._store_metadata(dataset_id, metadata)
            
            await self.set_status(dataset_id, "completed", 1.0)
            
            # Update file paths
            await self._update_file_paths(dataset_id, processed_files)
            
            return processed_files
            
        except Exception as e:
            await self.set_status(dataset_id, "error", error_message=str(e))
            raise
    
    async def _parse_series_matrix(self, matrix_file: Path) -> tuple:
        """Parse GEO series matrix file."""
        expression_data = None
        metadata = {}
        
        with gzip.open(matrix_file, 'rt') as f:
            lines = f.readlines()
        
        # Parse metadata and expression data
        data_start = None
        sample_info = {}
        
        for i, line in enumerate(lines):
            line = line.strip()
            
            if line.startswith('!Series_title'):
                metadata['title'] = line.split('\t')[1].strip('"')
            elif line.startswith('!Series_summary'):
                metadata['summary'] = line.split('\t')[1].strip('"')
            elif line.startswith('!Series_overall_design'):
                metadata['design'] = line.split('\t')[1].strip('"')
            elif line.startswith('!Sample_title'):
                sample_titles = line.split('\t')[1:]
                sample_info['titles'] = [t.strip('"') for t in sample_titles]
            elif line.startswith('!Sample_geo_accession'):
                sample_ids = line.split('\t')[1:]
                sample_info['ids'] = [s.strip('"') for s in sample_ids]
            elif line.startswith('!Sample_characteristics_ch1'):
                if 'characteristics' not in sample_info:
                    sample_info['characteristics'] = []
                chars = line.split('\t')[1:]
                sample_info['characteristics'].append([c.strip('"') for c in chars])
            elif line.startswith('!series_matrix_table_begin'):
                data_start = i + 1
                break
        
        # Read expression data
        if data_start:
            data_lines = []
            for line in lines[data_start:]:
                if line.startswith('!series_matrix_table_end'):
                    break
                data_lines.append(line.strip())
            
            # Convert to DataFrame
            if data_lines:
                # First line should be sample IDs
                header = data_lines[0].split('\t')
                data_rows = []
                for line in data_lines[1:]:
                    data_rows.append(line.split('\t'))
                
                expression_data = pd.DataFrame(data_rows, columns=header)
                expression_data = expression_data.set_index(expression_data.columns[0])
                
                # Convert to numeric
                for col in expression_data.columns:
                    expression_data[col] = pd.to_numeric(expression_data[col], errors='coerce')
        
        metadata['samples'] = sample_info
        metadata['num_samples'] = len(sample_info.get('ids', []))
        metadata['num_genes'] = len(expression_data) if expression_data is not None else 0
        
        return expression_data, metadata
    
    async def _save_processed_data(self, dataset_id: str, dataset_dir: Path, 
                                 expression_data: pd.DataFrame, metadata: Dict) -> Dict[str, str]:
        """Save processed data to files."""
        files = {}
        
        # Save expression data
        expr_file = dataset_dir / "expression_data.csv"
        expression_data.to_csv(expr_file)
        files['expression'] = str(expr_file)
        
        # Save metadata
        metadata_file = dataset_dir / "metadata.json"
        with open(metadata_file, 'w') as f:
            # Convert to JSON-serializable format
            json_metadata = {}
            for k, v in metadata.items():
                if isinstance(v, (str, int, float, bool, list, dict)):
                    json_metadata[k] = v
                else:
                    json_metadata[k] = str(v)
            
            import json
            json.dump(json_metadata, f, indent=2)
        files['metadata'] = str(metadata_file)
        
        # Create sample metadata if available
        if 'samples' in metadata:
            sample_df = pd.DataFrame(metadata['samples'])
            sample_file = dataset_dir / "sample_metadata.csv"
            sample_df.to_csv(sample_file, index=False)
            files['samples'] = str(sample_file)
        
        return files
    
    async def get_download_status(self, dataset_id: str) -> str:
        """Get current download/processing status."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                "SELECT status FROM dataset_status WHERE dataset_id = ?",
                (dataset_id,)
            )
            result = cursor.fetchone()
            return result[0] if result else "not_started"
    
    async def get_progress(self, dataset_id: str) -> float:
        """Get current progress (0.0 to 1.0)."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                "SELECT progress FROM dataset_status WHERE dataset_id = ?",
                (dataset_id,)
            )
            result = cursor.fetchone()
            return result[0] if result else 0.0
    
    async def get_file_paths(self, dataset_id: str) -> Optional[Dict[str, str]]:
        """Get file paths for a dataset."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                "SELECT file_paths FROM dataset_status WHERE dataset_id = ?",
                (dataset_id,)
            )
            result = cursor.fetchone()
            if result and result[0]:
                import json
                return json.loads(result[0])
            return None
    
    async def set_status(self, dataset_id: str, status: str, progress: float = None, error_message: str = None):
        """Update dataset status."""
        with sqlite3.connect(self.db_path) as conn:
            # Check if record exists
            cursor = conn.execute(
                "SELECT dataset_id FROM dataset_status WHERE dataset_id = ?",
                (dataset_id,)
            )
            exists = cursor.fetchone()
            
            if exists:
                conn.execute("""
                    UPDATE dataset_status 
                    SET status = ?, progress = COALESCE(?, progress), 
                        error_message = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE dataset_id = ?
                """, (status, progress, error_message, dataset_id))
            else:
                conn.execute("""
                    INSERT INTO dataset_status (dataset_id, status, progress, error_message)
                    VALUES (?, ?, ?, ?)
                """, (dataset_id, status, progress or 0.0, error_message))
    
    async def _update_file_paths(self, dataset_id: str, file_paths: Dict[str, str]):
        """Update file paths in database."""
        import json
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                UPDATE dataset_status 
                SET file_paths = ?, updated_at = CURRENT_TIMESTAMP
                WHERE dataset_id = ?
            """, (json.dumps(file_paths), dataset_id))
    
    async def _store_metadata(self, dataset_id: str, metadata: Dict[str, Any]):
        """Store dataset metadata."""
        import json
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                INSERT OR REPLACE INTO dataset_metadata 
                (dataset_id, title, organism, platform, samples, conditions, raw_metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                dataset_id,
                metadata.get('title', ''),
                metadata.get('organism', ''),
                metadata.get('platform', ''),
                metadata.get('num_samples', 0),
                json.dumps(metadata.get('conditions', [])),
                json.dumps(metadata)
            )) 