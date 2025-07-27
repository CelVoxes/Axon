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
from ..analysis.analysis_storage import AnalysisStorage

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

# Initialize services (will be updated with workspace-specific instances when needed)
geo_client = GEOClient()
dataset_processor = DatasetProcessor()  # Default instance
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
        print(f"🔍 Searching for datasets with query: '{query}'")
        
        # Use the GEO client to perform real search
        search_results = await geo_client.search_datasets(
            query=query,
            limit=limit * 2,  # Get more results to filter
            organism=organism,
            experiment_type=data_type
        )
        
        print(f"📊 Found {len(search_results)} raw search results")
        
        # Convert to our format and check local status
        datasets = []
        for result in search_results:
            try:
                dataset_info = await _get_dataset_status(result)
                
                # Apply filters
                if min_samples and dataset_info.samples < min_samples:
                    continue
                if data_type and dataset_info.type != data_type:
                    continue
                    
                datasets.append(dataset_info)
                
                # Stop if we have enough results
                if len(datasets) >= limit:
                    break
                    
            except Exception as e:
                print(f"⚠️ Error processing dataset {result.get('id', 'unknown')}: {e}")
                continue
        
        print(f"✅ Returning {len(datasets)} filtered datasets")
        return datasets
        
    except Exception as e:
        print(f"❌ Dataset search failed: {e}")
        # Fallback to a few relevant datasets if search fails
        fallback_datasets = [
            {
                "id": "GSE13159",
                "title": "Microarray Innovations in LEukemia (MILE) study: Stage 1 data",
                "description": "An International Multi-Center Study to Define the Clinical Utility of Microarray–Based Gene Expression Profiling in the Diagnosis and Sub-classification of Leukemia (MILE Study)",
                "organism": "Homo sapiens",
                "sample_count": "2096",
                "platform": "Affymetrix Human Genome U133 Plus 2.0 Array",
                "publication_date": "Oct 10, 2008"
            },
            {
                "id": "GSE156728",
                "title": "Single-cell RNA-seq analysis of human breast cancer",
                "description": "Single-cell RNA sequencing analysis of human breast cancer samples to identify cell type-specific gene expression patterns",
                "organism": "Homo sapiens",
                "sample_count": "500",
                "platform": "10x Genomics Chromium",
                "publication_date": "Mar 15, 2021"
            }
        ]
        
        # Only return fallback if query is relevant
        if any(term in query.lower() for term in ['leukemia', 'cancer', 'breast', 'expression']):
            datasets = []
            for result in fallback_datasets:
                try:
                    dataset_info = await _get_dataset_status(result)
                    datasets.append(dataset_info)
                except Exception:
                    continue
            return datasets[:limit]
        
        return []

@router.get("/{dataset_id}")
async def get_dataset_info(dataset_id: str) -> DatasetInfo:
    """Get detailed information about a specific dataset."""
    try:
        # Get info from GEO
        geo_info = await geo_client.get_details(dataset_id)
        if not geo_info:
            # If not found in GEO, create a basic response
            geo_info = {
                "id": dataset_id,
                "title": f"Dataset {dataset_id}",
                "description": f"GEO dataset {dataset_id}",
                "organism": "Unknown",
                "sample_count": "0",
                "platform": "Unknown",
                "publication_date": "Unknown",
                "source": "GEO"
            }
        
        # Check local status
        dataset_info = await _get_dataset_status(geo_info)
        return dataset_info
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get dataset info: {str(e)}")

@router.post("/set-workspace")
async def set_workspace(workspace_dir: str):
    """Set the workspace directory for dataset downloads."""
    global dataset_processor
    try:
        # Create workspace-specific dataset processor
        dataset_processor = DatasetProcessor(workspace_dir=workspace_dir)
        return {"status": "success", "workspace_dir": workspace_dir}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to set workspace: {str(e)}")

@router.post("/{dataset_id}/download")
async def download_dataset(
    dataset_id: str,
    background_tasks: BackgroundTasks,
    force_redownload: bool = False,
    workspace_dir: Optional[str] = None
) -> Dict[str, str]:
    """Initiate dataset download and preprocessing."""
    try:
        # Use workspace-specific processor if provided
        processor = dataset_processor
        if workspace_dir:
            processor = DatasetProcessor(workspace_dir=workspace_dir)
        
        # Check if already downloaded
        if not force_redownload:
            status = await processor.get_download_status(dataset_id)
            if status == "completed":
                return {"status": "already_downloaded", "dataset_id": dataset_id, "workspace_dir": workspace_dir or "default"}
        
        # Start download in background
        background_tasks.add_task(
            _download_and_process_dataset,
            dataset_id,
            workspace_dir
        )
        
        return {"status": "download_started", "dataset_id": dataset_id, "workspace_dir": workspace_dir or "default"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Download failed: {str(e)}")

@router.get("/{dataset_id}/status")
async def get_dataset_status(dataset_id: str) -> Dict[str, Any]:
    """Get download and processing status for a dataset (alias for download/status)."""
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
    try:
        download_status = await dataset_processor.get_download_status(dataset_id)
        file_paths = await dataset_processor.get_file_paths(dataset_id)
    except Exception:
        # If processor fails, assume not downloaded
        download_status = "not_started"
        file_paths = None
    
    # Safely convert sample count
    sample_count = geo_info.get("sample_count", "0")
    try:
        samples = int(sample_count) if sample_count else 0
    except (ValueError, TypeError):
        samples = 0
    
    return DatasetInfo(
        id=dataset_id,
        title=geo_info.get("title", f"Dataset {dataset_id}"),
        description=geo_info.get("description", f"GEO dataset {dataset_id}"),
        organism=geo_info.get("organism", "Unknown"),
        samples=samples,
        type="RNA-seq",  # Default for now
        date=geo_info.get("publication_date", "Unknown"),
        platform=geo_info.get("platform", "Unknown"),
        conditions=geo_info.get("conditions", []),
        downloaded=download_status in ["completed", "processing"],
        processed=download_status == "completed",
        download_status=download_status,
        file_paths=file_paths
    )

async def _download_and_process_dataset(dataset_id: str, workspace_dir: str = None):
    """Background task to download and process a dataset."""
    try:
        # Use workspace-specific processor
        processor = DatasetProcessor(workspace_dir=workspace_dir) if workspace_dir else dataset_processor
        await processor.download_dataset(dataset_id)
        await processor.process_dataset(dataset_id)
    except Exception as e:
        print(f"Error processing dataset {dataset_id}: {e}")
        processor = DatasetProcessor(workspace_dir=workspace_dir) if workspace_dir else dataset_processor
        await processor.set_status(dataset_id, "error", str(e))

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