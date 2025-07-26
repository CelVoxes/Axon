"""Storage for analysis results and metadata."""

import json
import sqlite3
import logging
from typing import Dict, Any, List, Optional
from pathlib import Path
from datetime import datetime

logger = logging.getLogger(__name__)

class AnalysisStorage:
    """Manages storage and retrieval of analysis results."""
    
    def __init__(self, db_path: str = "analysis_results.db"):
        """Initialize analysis storage.
        
        Args:
            db_path: Path to SQLite database
        """
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_database()
    
    def _init_database(self):
        """Initialize the database schema."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS analyses (
                    analysis_id TEXT PRIMARY KEY,
                    dataset_id TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    status TEXT NOT NULL,
                    results TEXT,
                    metadata TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_dataset_id ON analyses(dataset_id);
            """)
            
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_status ON analyses(status);
            """)
    
    async def store_analysis_results(
        self, 
        analysis_id: str, 
        results: Dict[str, Any]
    ):
        """Store analysis results.
        
        Args:
            analysis_id: Analysis identifier
            results: Analysis results dictionary
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("""
                    INSERT OR REPLACE INTO analyses 
                    (analysis_id, dataset_id, prompt, status, results, metadata, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    analysis_id,
                    results.get("dataset_id", ""),
                    results.get("prompt", ""),
                    results.get("status", "completed"),
                    json.dumps(results.get("results", {})),
                    json.dumps(results.get("metadata", {})),
                    datetime.utcnow().isoformat()
                ))
            
            logger.info(f"Stored analysis results for {analysis_id}")
            
        except Exception as e:
            logger.error(f"Failed to store analysis results for {analysis_id}: {e}")
            raise
    
    async def get_analysis_results(self, analysis_id: str) -> Optional[Dict[str, Any]]:
        """Get analysis results by ID.
        
        Args:
            analysis_id: Analysis identifier
            
        Returns:
            Analysis results or None if not found
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.execute("""
                    SELECT analysis_id, dataset_id, prompt, status, results, metadata, 
                           created_at, updated_at
                    FROM analyses
                    WHERE analysis_id = ?
                """, (analysis_id,))
                
                row = cursor.fetchone()
                if not row:
                    return None
                
                return {
                    "analysis_id": row[0],
                    "dataset_id": row[1],
                    "prompt": row[2],
                    "status": row[3],
                    "results": json.loads(row[4]) if row[4] else {},
                    "metadata": json.loads(row[5]) if row[5] else {},
                    "created_at": row[6],
                    "updated_at": row[7]
                }
                
        except Exception as e:
            logger.error(f"Failed to get analysis results for {analysis_id}: {e}")
            return None
    
    async def get_analyses_by_dataset(self, dataset_id: str) -> List[Dict[str, Any]]:
        """Get all analyses for a dataset.
        
        Args:
            dataset_id: Dataset identifier
            
        Returns:
            List of analyses for the dataset
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.execute("""
                    SELECT analysis_id, dataset_id, prompt, status, results, metadata,
                           created_at, updated_at
                    FROM analyses
                    WHERE dataset_id = ?
                    ORDER BY created_at DESC
                """, (dataset_id,))
                
                analyses = []
                for row in cursor.fetchall():
                    analyses.append({
                        "analysis_id": row[0],
                        "dataset_id": row[1],
                        "prompt": row[2],
                        "status": row[3],
                        "results": json.loads(row[4]) if row[4] else {},
                        "metadata": json.loads(row[5]) if row[5] else {},
                        "created_at": row[6],
                        "updated_at": row[7]
                    })
                
                return analyses
                
        except Exception as e:
            logger.error(f"Failed to get analyses for dataset {dataset_id}: {e}")
            return []
    
    async def get_all_analyses(
        self, 
        status: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get all analyses with optional filtering.
        
        Args:
            status: Filter by status (optional)
            limit: Maximum number of results
            
        Returns:
            List of analyses
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                if status:
                    cursor = conn.execute("""
                        SELECT analysis_id, dataset_id, prompt, status, results, metadata,
                               created_at, updated_at
                        FROM analyses
                        WHERE status = ?
                        ORDER BY created_at DESC
                        LIMIT ?
                    """, (status, limit))
                else:
                    cursor = conn.execute("""
                        SELECT analysis_id, dataset_id, prompt, status, results, metadata,
                               created_at, updated_at
                        FROM analyses
                        ORDER BY created_at DESC
                        LIMIT ?
                    """, (limit,))
                
                analyses = []
                for row in cursor.fetchall():
                    analyses.append({
                        "analysis_id": row[0],
                        "dataset_id": row[1],
                        "prompt": row[2],
                        "status": row[3],
                        "results": json.loads(row[4]) if row[4] else {},
                        "metadata": json.loads(row[5]) if row[5] else {},
                        "created_at": row[6],
                        "updated_at": row[7]
                    })
                
                return analyses
                
        except Exception as e:
            logger.error(f"Failed to get all analyses: {e}")
            return []
    
    async def delete_analysis(self, analysis_id: str) -> bool:
        """Delete an analysis.
        
        Args:
            analysis_id: Analysis identifier
            
        Returns:
            True if deleted, False if not found
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.execute("""
                    DELETE FROM analyses WHERE analysis_id = ?
                """, (analysis_id,))
                
                if cursor.rowcount > 0:
                    logger.info(f"Deleted analysis {analysis_id}")
                    return True
                else:
                    logger.warning(f"Analysis {analysis_id} not found for deletion")
                    return False
                    
        except Exception as e:
            logger.error(f"Failed to delete analysis {analysis_id}: {e}")
            return False 