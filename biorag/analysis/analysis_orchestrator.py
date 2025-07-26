"""Analysis orchestrator for managing dataset analyses."""

import asyncio
import json
import logging
from typing import Dict, Any, List, Optional
from pathlib import Path
from datetime import datetime

logger = logging.getLogger(__name__)

class AnalysisOrchestrator:
    """Orchestrates analysis execution on downloaded datasets."""
    
    def __init__(self):
        """Initialize analysis orchestrator."""
        self.running_analyses = {}
        self.completed_analyses = {}
    
    async def run_analysis(
        self, 
        analysis_id: str, 
        dataset_id: str, 
        prompt: str
    ) -> Dict[str, Any]:
        """Run analysis on a dataset.
        
        Args:
            analysis_id: Unique analysis identifier
            dataset_id: Dataset to analyze
            prompt: Analysis prompt/question
            
        Returns:
            Analysis results
        """
        try:
            logger.info(f"Starting analysis {analysis_id} for dataset {dataset_id}")
            
            # Update status
            await self.set_status(analysis_id, "running", "Starting analysis...")
            
            # Simulate analysis process
            # In a real implementation, this would:
            # 1. Load the dataset
            # 2. Apply appropriate analysis methods
            # 3. Generate visualizations
            # 4. Create summary report
            
            await asyncio.sleep(2)  # Simulate processing time
            
            # Mock analysis results
            results = {
                "analysis_id": analysis_id,
                "dataset_id": dataset_id,
                "prompt": prompt,
                "status": "completed",
                "timestamp": datetime.utcnow().isoformat(),
                "results": {
                    "summary": f"Analysis completed for {dataset_id}",
                    "key_findings": [
                        "Differential expression identified between conditions",
                        "Pathway enrichment analysis reveals key biological processes",
                        "Clustering analysis identifies distinct sample groups"
                    ],
                    "figures": [
                        f"figures/{dataset_id}_heatmap.png",
                        f"figures/{dataset_id}_volcano_plot.png",
                        f"figures/{dataset_id}_pathway_enrichment.png"
                    ],
                    "data_files": [
                        f"results/{dataset_id}_differential_genes.csv",
                        f"results/{dataset_id}_pathway_results.csv"
                    ]
                },
                "metadata": {
                    "analysis_type": "differential_expression",
                    "n_genes": 20000,
                    "n_samples": 48,
                    "n_conditions": 2
                }
            }
            
            # Store completed analysis
            self.completed_analyses[analysis_id] = results
            await self.set_status(analysis_id, "completed", "Analysis completed successfully")
            
            logger.info(f"Analysis {analysis_id} completed successfully")
            return results
            
        except Exception as e:
            logger.error(f"Analysis {analysis_id} failed: {e}")
            await self.set_status(analysis_id, "error", str(e))
            raise
    
    async def get_analysis_status(self, analysis_id: str) -> Dict[str, Any]:
        """Get status of a running or completed analysis.
        
        Args:
            analysis_id: Analysis identifier
            
        Returns:
            Status information
        """
        if analysis_id in self.completed_analyses:
            return {
                "analysis_id": analysis_id,
                "status": "completed",
                "results": self.completed_analyses[analysis_id]
            }
        elif analysis_id in self.running_analyses:
            return {
                "analysis_id": analysis_id,
                "status": "running",
                "progress": self.running_analyses[analysis_id]
            }
        else:
            return {
                "analysis_id": analysis_id,
                "status": "not_found"
            }
    
    async def set_status(
        self, 
        analysis_id: str, 
        status: str, 
        message: str = None
    ):
        """Update analysis status.
        
        Args:
            analysis_id: Analysis identifier
            status: Status (running, completed, error)
            message: Status message
        """
        status_info = {
            "status": status,
            "timestamp": datetime.utcnow().isoformat(),
            "message": message
        }
        
        if status == "running":
            self.running_analyses[analysis_id] = status_info
        elif status in ["completed", "error"]:
            if analysis_id in self.running_analyses:
                del self.running_analyses[analysis_id]
            # For completed/error, we store in completed_analyses with full results
        
        logger.info(f"Analysis {analysis_id} status: {status} - {message}")
    
    async def cancel_analysis(self, analysis_id: str) -> bool:
        """Cancel a running analysis.
        
        Args:
            analysis_id: Analysis identifier
            
        Returns:
            True if cancelled, False if not found or already completed
        """
        if analysis_id in self.running_analyses:
            del self.running_analyses[analysis_id]
            await self.set_status(analysis_id, "cancelled", "Analysis cancelled by user")
            return True
        return False
    
    def get_all_analyses(self) -> Dict[str, Any]:
        """Get all analyses (running and completed).
        
        Returns:
            Dictionary of all analyses
        """
        return {
            "running": self.running_analyses,
            "completed": list(self.completed_analyses.keys())
        } 