"""Dataset management and analysis endpoints for BioRAG."""

import asyncio
import os
import json
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel
import httpx
from datetime import datetime

from ..data_sources.geo_client import GEOClient
from ..analysis.dataset_processor import DatasetProcessor
from ..analysis.analysis_orchestrator import AnalysisOrchestrator
from ..storage.analysis_storage import AnalysisStorage

router = APIRouter(prefix="/datasets", tags=["datasets"])

# Pydantic models
class DatasetSearchRequest(BaseModel):
    query: str
    organism: Optional[str] = None
    min_samples: Optional[int] = None
    data_type: str = "RNA-seq"
    limit: int = 20

class DatasetDownloadRequest(BaseModel):
    dataset_id: str
    force_redownload: bool = False

class AnalysisRequest(BaseModel):
    dataset_id: str
    prompt: str
    analysis_type: Optional[str] = None

class DatasetInfo(BaseModel):
    id: str
    title: str
    description: str
    organism: str
    samples: int
    type: str
    date: str
    platform: str
    conditions: List[str]
    downloaded: bool
    processed: bool
    download_status: Optional[str] = None
    file_paths: Optional[Dict[str, str]] = None

# Initialize services
geo_client = GEOClient()
dataset_processor = DatasetProcessor()
analysis_orchestrator = AnalysisOrchestrator()
analysis_storage = AnalysisStorage()

@router.get("/search")
async def search_datasets(
    query: str,
    organism: Optional[str] = None,
    min_samples: Optional[int] = None,
    data_type: str = "RNA-seq",
    limit: int = 20
) -> List[DatasetInfo]:
    """Search for GEO datasets based on query parameters."""
    try:
        # Search using GEO client
        search_results = await geo_client.search_datasets(
            query=query,
            limit=limit,
            organism=organism
        )
        
        # Convert to our format and check local status
        datasets = []
        for result in search_results:
            dataset_info = await _get_dataset_status(result)
            
            # Apply filters
            if min_samples and dataset_info.samples < min_samples:
                continue
            if data_type and dataset_info.type != data_type:
                continue
                
            datasets.append(dataset_info)
        
        return datasets[:limit]
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")

@router.get("/{dataset_id}")
async def get_dataset_info(dataset_id: str) -> DatasetInfo:
    """Get detailed information about a specific dataset."""
    try:
        # Get info from GEO
        geo_info = await geo_client.get_details(dataset_id)
        if not geo_info:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Check local status
        dataset_info = await _get_dataset_status(geo_info)
        return dataset_info
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get dataset info: {str(e)}")

@router.post("/{dataset_id}/download")
async def download_dataset(
    dataset_id: str,
    background_tasks: BackgroundTasks,
    force_redownload: bool = False
) -> Dict[str, str]:
    """Initiate dataset download and preprocessing."""
    try:
        # Check if already downloaded
        if not force_redownload:
            status = await dataset_processor.get_download_status(dataset_id)
            if status == "completed":
                return {"status": "already_downloaded", "dataset_id": dataset_id}
        
        # Start download in background
        background_tasks.add_task(
            _download_and_process_dataset,
            dataset_id
        )
        
        return {"status": "download_started", "dataset_id": dataset_id}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Download failed: {str(e)}")

@router.get("/{dataset_id}/download/status")
async def get_download_status(dataset_id: str) -> Dict[str, Any]:
    """Get download and processing status for a dataset."""
    try:
        status = await dataset_processor.get_download_status(dataset_id)
        progress = await dataset_processor.get_progress(dataset_id)
        
        return {
            "dataset_id": dataset_id,
            "status": status,
            "progress": progress,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get status: {str(e)}")

@router.post("/{dataset_id}/analyze")
async def analyze_dataset(
    dataset_id: str,
    request: AnalysisRequest,
    background_tasks: BackgroundTasks
) -> Dict[str, str]:
    """Run AI-powered analysis on a dataset."""
    try:
        # Check if dataset is processed
        status = await dataset_processor.get_download_status(dataset_id)
        if status != "completed":
            raise HTTPException(
                status_code=400, 
                detail="Dataset must be downloaded and processed first"
            )
        
        # Start analysis in background
        analysis_id = f"analysis_{dataset_id}_{int(datetime.now().timestamp())}"
        
        background_tasks.add_task(
            _run_analysis,
            analysis_id,
            dataset_id,
            request.prompt
        )
        
        return {
            "analysis_id": analysis_id,
            "status": "analysis_started",
            "dataset_id": dataset_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@router.get("/{dataset_id}/analyses")
async def get_dataset_analyses(dataset_id: str) -> List[Dict[str, Any]]:
    """Get all analyses for a dataset."""
    try:
        analyses = await analysis_storage.get_analyses_by_dataset(dataset_id)
        return analyses
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get analyses: {str(e)}")

@router.get("/analysis/{analysis_id}")
async def get_analysis_results(analysis_id: str) -> Dict[str, Any]:
    """Get results for a specific analysis."""
    try:
        results = await analysis_storage.get_analysis_results(analysis_id)
        if not results:
            raise HTTPException(status_code=404, detail="Analysis not found")
            
        return results
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get analysis: {str(e)}")

@router.get("/analysis/{analysis_id}/status")
async def get_analysis_status(analysis_id: str) -> Dict[str, Any]:
    """Get status of a running analysis."""
    try:
        status = await analysis_orchestrator.get_analysis_status(analysis_id)
        return status
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get status: {str(e)}")

# Helper functions
async def _get_dataset_status(geo_info: Dict[str, Any]) -> DatasetInfo:
    """Convert GEO info to DatasetInfo with local status."""
    dataset_id = geo_info.get("id", "")
    
    # Check local download and processing status
    download_status = await dataset_processor.get_download_status(dataset_id)
    file_paths = await dataset_processor.get_file_paths(dataset_id)
    
    return DatasetInfo(
        id=dataset_id,
        title=geo_info.get("title", ""),
        description=geo_info.get("description", ""),
        organism=geo_info.get("organism", ""),
        samples=int(geo_info.get("sample_count", 0)),
        type="RNA-seq",  # Default for now
        date=geo_info.get("publication_date", ""),
        platform=geo_info.get("platform", ""),
        conditions=geo_info.get("conditions", []),
        downloaded=download_status in ["completed", "processing"],
        processed=download_status == "completed",
        download_status=download_status,
        file_paths=file_paths
    )

async def _download_and_process_dataset(dataset_id: str):
    """Background task to download and process a dataset."""
    try:
        await dataset_processor.download_dataset(dataset_id)
        await dataset_processor.process_dataset(dataset_id)
    except Exception as e:
        print(f"Error processing dataset {dataset_id}: {e}")
        await dataset_processor.set_status(dataset_id, "error", str(e))

async def _run_analysis(analysis_id: str, dataset_id: str, prompt: str):
    """Background task to run analysis."""
    try:
        results = await analysis_orchestrator.run_analysis(
            analysis_id=analysis_id,
            dataset_id=dataset_id,
            prompt=prompt
        )
        
        # Store results
        await analysis_storage.store_analysis_results(analysis_id, results)
        
    except Exception as e:
        print(f"Error running analysis {analysis_id}: {e}")
        await analysis_orchestrator.set_status(analysis_id, "error", str(e)) 