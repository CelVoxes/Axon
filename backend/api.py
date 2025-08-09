"""Minimal FastAPI application for GEO semantic search."""

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import uvicorn
import json
import os
import asyncio
from pathlib import Path
from dotenv import load_dotenv
from .config import SearchConfig, DEFAULT_ORGANISM

# Load environment variables from .env file
env_path = Path(__file__).parent.parent / '.env'
if env_path.exists():
    load_dotenv(env_path)
    print(f"Loaded environment variables from {env_path}")
else:
    print(f"No .env file found at {env_path}")

from .geo_search import SimpleGEOClient
from .broad_search import SimpleBroadClient
from .cellxcensus_search import SimpleCellxCensusClient
from .llm_service import get_llm_service

app = FastAPI(
    title="Multi-Source Single Cell Data Search API",
    description="Comprehensive API for finding similar datasets using semantic search across GEO, Broad Institute Single Cell Portal, and CellxCensus",
    version="1.1.0"
)

# Initialize the simple clients lazily
geo_client = None
broad_client = None
cellxcensus_client = None

def get_geo_client():
    """Get or create the GEO client."""
    global geo_client
    if geo_client is None:
        geo_client = SimpleGEOClient()
    return geo_client

def get_broad_client():
    """Get or create the Broad client."""
    global broad_client
    if broad_client is None:
        broad_client = SimpleBroadClient()
    return broad_client

def get_cellxcensus_client():
    """Get or create the CellxCensus client."""
    global cellxcensus_client
    if cellxcensus_client is None:
        cellxcensus_client = SimpleCellxCensusClient()
    return cellxcensus_client


class SearchRequest(BaseModel):
    query: str
    limit: int = SearchConfig.get_search_limit()
    organism: Optional[str] = None


class DatasetResponse(BaseModel):
    id: str
    title: str
    description: str
    organism: str
    sample_count: str
    platform: str
    similarity_score: float
    source: str = "GEO"


class LLMSearchRequest(BaseModel):
    query: str
    limit: int = SearchConfig.get_search_limit()
    organism: Optional[str] = None
    max_attempts: int = 2


class LLMSearchResponse(BaseModel):
    datasets: List[DatasetResponse]
    search_terms: List[str]
    search_steps: List[str]
    query_transformation: str


class QuerySimplificationRequest(BaseModel):
    query: str


class QuerySimplificationResponse(BaseModel):
    original_query: str
    simplified_query: str


class CodeGenerationRequest(BaseModel):
    task_description: str
    language: str = "python"
    context: Optional[str] = None
    model: Optional[str] = None


class CodeGenerationResponse(BaseModel):
    code: str
    language: str
    task_description: str


class ToolCallRequest(BaseModel):
    tool_name: str
    parameters: Dict[str, Any]
    context: Optional[str] = None


class ToolCallResponse(BaseModel):
    tool_name: str
    parameters: Dict[str, Any]
    description: str
    raw_response: Optional[str] = None


class QueryAnalysisRequest(BaseModel):
    query: str


class QueryAnalysisResponse(BaseModel):
    intent: str
    entities: List[str]
    data_types: List[str]
    analysis_type: str
    complexity: str


class SearchTermsRequest(BaseModel):
    query: str
    attempt: int = 1
    is_first_attempt: bool = True


class SearchTermsResponse(BaseModel):
	terms: List[str]


class DataTypeSuggestionsRequest(BaseModel):
	data_types: List[str]
	user_question: str
	available_datasets: List[Dict[str, Any]]
	current_context: str = ""


class DataTypeSuggestionsResponse(BaseModel):
	suggestions: List[Dict[str, Any]]
	recommended_approaches: List[Dict[str, Any]]
	data_insights: List[Dict[str, Any]]
	next_steps: List[str]


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "Multi-Source Single Cell Data Search API",
        "version": "1.1.0",
        "data_sources": ["GEO", "Broad Single Cell Portal", "CellxCensus"],
        "endpoints": {
            "geo_search": "/search",
            "geo_search_stream": "/search/stream",
            "broad_search": "/broad/search",
            "cellxcensus_search": "/cellxcensus/search",
            "cellxcensus_search_stream": "/cellxcensus/search/stream",
            "llm_search": "/search/llm",
            "query_simplify": "/llm/simplify",
            "code_generate": "/llm/code",
            "tool_call": "/llm/tool",
            "query_analyze": "/llm/analyze",
        }
    }


@app.post("/search", response_model=List[DatasetResponse])
async def search_datasets(request: SearchRequest):
    """Find GEO datasets most similar to the query.
    
    Args:
        request: Search parameters
        
    Returns:
        List of similar datasets with similarity scores
    """
    try:
        client = get_geo_client()
        datasets = await client.find_similar_datasets(
            query=request.query,
            limit=request.limit,
            organism=request.organism
        )
        
        # Convert to response format
        results = []
        for dataset in datasets:
            results.append(DatasetResponse(
                id=dataset.get("id", ""),
                title=dataset.get("title", ""),
                description=dataset.get("description", ""),
                organism=dataset.get("organism", "Unknown"),
                sample_count=dataset.get("sample_count", "0"),
                platform=dataset.get("platform", "Unknown"),
                similarity_score=dataset.get("similarity_score", 0.0)
            ))
        
        return results
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


@app.post("/search/stream")
async def search_datasets_stream(request: SearchRequest):
    """Find GEO datasets with real-time progress updates using Server-Sent Events.
    
    Args:
        request: Search parameters
        
    Returns:
        Streaming response with progress updates and final results
    """
    async def generate():
        try:
            client = get_geo_client()
            
            # Create a queue for real-time progress updates
            progress_queue = asyncio.Queue()
            
            # Set up progress callback to send updates via queue
            def progress_callback(progress_data):
                # Schedule the queue put as a task to make it non-blocking
                asyncio.create_task(progress_queue.put(progress_data))
            
            client.set_progress_callback(progress_callback)
            
            # Send initial progress
            yield f"data: {json.dumps({'type': 'progress', 'step': 'init', 'progress': 10, 'message': 'Initializing search...', 'datasetsFound': 0})}\n\n"
            await asyncio.sleep(0.1)
            
            # Start the search in a separate task
            search_task = asyncio.create_task(
                client.find_similar_datasets(
                    query=request.query,
                    limit=request.limit,
                    organism=request.organism
                )
            )
            
            # Process progress updates in real-time
            while not search_task.done():
                try:
                    # Wait for progress update with timeout
                    progress = await asyncio.wait_for(progress_queue.get(), timeout=0.1)
                    yield f"data: {json.dumps({'type': 'progress', **progress})}\n\n"
                except asyncio.TimeoutError:
                    # No progress update, continue
                    pass
            
            # Get the search results
            datasets = await search_task
            
            # Send search completion progress
            yield f"data: {json.dumps({'type': 'progress', 'step': 'complete', 'progress': 100, 'message': f'Search complete! Found {len(datasets)} datasets', 'datasetsFound': len(datasets)})}\n\n"
            await asyncio.sleep(0.1)
            
            # Send final results
            results = []
            for dataset in datasets:
                results.append({
                    "id": dataset.get("id", ""),
                    "title": dataset.get("title", ""),
                    "description": dataset.get("description", ""),
                    "organism": dataset.get("organism", "Unknown"),
                    "sample_count": dataset.get("sample_count", "0"),
                    "platform": dataset.get("platform", "Unknown"),
                    "similarity_score": dataset.get("similarity_score", 0.0)
                })
            
            yield f"data: {json.dumps({'type': 'results', 'datasets': results})}\n\n"
            
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/plain",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Content-Type": "text/event-stream",
        }
    )


@app.post("/search/llm", response_model=LLMSearchResponse)
async def llm_search_datasets(request: LLMSearchRequest):
    """Find CellxCensus datasets using LLM-generated search terms (primary).
    
    Args:
        request: Search parameters with LLM processing
        
    Returns:
        Search results with LLM-generated terms and search steps
    """
    try:
        cellx_client = get_cellxcensus_client()
        llm_service = get_llm_service()
        
        all_datasets = []
        used_search_terms = []
        search_steps = []
        
        search_steps.append(f"Processing query with LLM: {request.query}")
        
        # Try multiple LLM-generated search strategies
        for attempt in range(1, request.max_attempts + 1):
            search_steps.append(f"Attempt {attempt}/{request.max_attempts}: Generating search terms with LLM")
            
            # Get LLM-generated search terms
            llm_search_terms = await llm_service.generate_search_terms(
                request.query, 
                attempt, 
                attempt == 1
            )
            
            search_steps.append(f"LLM generated search terms: {', '.join(llm_search_terms)}")
            
            # Try each LLM-generated term
            for term in llm_search_terms:
                try:
                    search_steps.append(f"Searching CellxCensus for: {term}")

                    # Use CellxCensus as primary source
                    per_term_limit = max(1, request.limit // max(1, len(llm_search_terms)))
                    search_results = await cellx_client.find_similar_datasets(
                        query=term,
                        limit=per_term_limit,
                        organism=request.organism or DEFAULT_ORGANISM
                    )
                    
                    if search_results:
                        search_steps.append(f"Found {len(search_results)} datasets for {term}")
                        all_datasets.extend(search_results)
                        used_search_terms.append(term)
                    else:
                        search_steps.append(f"No datasets found for {term}")
                        
                except Exception as error:
                    search_steps.append(f"Search failed for {term}")
                    print(f"Search error for {term}: {error}")
            
            # If we found datasets, we can stop
            if all_datasets:
                search_steps.append(f"Found datasets on attempt {attempt}, stopping")
                break
            
            # If this is not the last attempt, continue to next iteration
            if attempt < request.max_attempts:
                search_steps.append(f"No results on attempt {attempt}, trying different approach...")
        
        # Remove duplicates
        unique_datasets = []
        seen_ids = set()
        for dataset in all_datasets:
            if dataset.get("id") not in seen_ids:
                unique_datasets.append(dataset)
                seen_ids.add(dataset.get("id"))
        
        limited_datasets = unique_datasets[:request.limit]
        
        if limited_datasets:
            search_steps.append(f"Found {len(limited_datasets)} unique datasets")
        else:
            search_steps.append(f"No datasets found after {request.max_attempts} attempts")
        
        # Convert to response format
        results = []
        for dataset in limited_datasets:
            results.append(DatasetResponse(
                id=dataset.get("id", ""),
                title=dataset.get("title", ""),
                description=dataset.get("description", ""),
                organism=dataset.get("organism", "Unknown"),
                sample_count=str(dataset.get("sample_count", "0")),
                platform=dataset.get("platform", "Unknown"),
                similarity_score=dataset.get("similarity_score", 0.0),
                source=dataset.get("source", "CellxCensus")
            ))
        
        return LLMSearchResponse(
            datasets=results,
            search_terms=used_search_terms,
            search_steps=search_steps,
            query_transformation=f"Original: {request.query} -> LLM-generated terms: {', '.join(used_search_terms)}"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM search failed: {str(e)}")


@app.post("/llm/simplify", response_model=QuerySimplificationResponse)
async def simplify_query(request: QuerySimplificationRequest):
    """Simplify a complex query to its core components."""
    try:
        llm_service = get_llm_service()
        simplified_query = await llm_service.simplify_query(request.query)
        
        return QuerySimplificationResponse(
            original_query=request.query,
            simplified_query=simplified_query
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query simplification failed: {str(e)}")


@app.post("/llm/code")
async def generate_code(request: dict):
    """Generate code for a given task."""
    try:
        # Support per-request model override
        model = request.get("model")
        if model:
            llm_service = get_llm_service()
            # Recreate provider with the selected model if possible
            # Note: For simplicity, we create a new service instance when model is provided
            from .llm_service import LLMService
            llm_service = LLMService(provider="openai", model=model)
        else:
            llm_service = get_llm_service()
        task_description = request.get("task_description", "")
        language = request.get("language", "python")
        context = request.get("context", "")
        
        if not task_description:
            return {"error": "Task description is required"}
        
        code = await llm_service.generate_code(
            task_description=task_description,
            language=language,
            context=context
        )
        
        return {
            "task_description": task_description,
            "language": language,
            "code": code
        }
        
    except Exception as e:
        print(f"Error generating code: {e}")
        return {"error": str(e)}


@app.post("/llm/code/stream")
async def generate_code_stream(request: dict):
    """Generate code with streaming for a given task."""
    try:
        # Support per-request model override
        model = request.get("model")
        if model:
            from .llm_service import LLMService
            llm_service = LLMService(provider="openai", model=model)
        else:
            llm_service = get_llm_service()
        task_description = request.get("task_description", "")
        language = request.get("language", "python")
        context = request.get("context", "")
        
        print(f"Code generation request: task='{task_description}', language='{language}'")
        print(f"Context: {context[:200]}..." if len(context) > 200 else f"Context: {context}")
        
        if not task_description:
            return {"error": "Task description is required"}
        
        from fastapi.responses import StreamingResponse
        
        async def generate():
            try:
                async for chunk in llm_service.generate_code_stream(
                    task_description=task_description,
                    language=language,
                    context=context
                ):
                    if chunk:  # Only yield non-empty chunks
                        yield f"data: {json.dumps({'chunk': chunk})}\n\n"
            except Exception as e:
                print(f"Error in streaming generation: {e}")
                # Yield error message as a chunk
                error_msg = f"# Error generating code: {str(e)}\nprint('Code generation failed due to error')"
                yield f"data: {json.dumps({'chunk': error_msg})}\n\n"
        
        return StreamingResponse(
            generate(),
            media_type="text/plain",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Content-Type": "text/event-stream"
            }
        )
        
    except Exception as e:
        print(f"Error generating streaming code: {e}")
        import traceback
        traceback.print_exc()
        return {"error": str(e)}


@app.post("/llm/validate-code")
async def validate_code(request: dict):
    """Validate generated code syntax and structure."""
    try:
        llm_service = get_llm_service()
        code = request.get("code", "")
        language = request.get("language", "python")
        
        if language == "python":
            is_valid, message = llm_service.validate_python_code(code)
            return {
                "is_valid": is_valid,
                "message": message,
                "language": language
            }
        else:
            return {
                "is_valid": False,
                "message": f"Unsupported language: {language}",
                "language": language
            }
    except Exception as e:
        return {
            "is_valid": False,
            "message": f"Validation error: {str(e)}",
            "language": request.get("language", "python")
        }


@app.post("/llm/tool", response_model=ToolCallResponse)
async def call_tool(request: ToolCallRequest):
    """Generate tool calling instructions."""
    try:
        llm_service = get_llm_service()
        result = await llm_service.call_tool(
            request.tool_name,
            request.parameters,
            request.context
        )
        
        return ToolCallResponse(
            tool_name=result.get("tool_name", request.tool_name),
            parameters=result.get("parameters", request.parameters),
            description=result.get("description", "Tool call generated"),
            raw_response=result.get("raw_response")
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Tool calling failed: {str(e)}")


@app.post("/llm/analyze", response_model=QueryAnalysisResponse)
async def analyze_query(request: QueryAnalysisRequest):
    """Analyze a query to extract components and intent."""
    try:
        llm_service = get_llm_service()
        analysis = await llm_service.analyze_query(request.query)
        
        return QueryAnalysisResponse(
            intent=analysis.get("intent", "unknown"),
            entities=analysis.get("entities", []),
            data_types=analysis.get("data_types", []),
            analysis_type=analysis.get("analysis_type", "unknown"),
            complexity=analysis.get("complexity", "simple")
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query analysis failed: {str(e)}")


@app.post("/llm/plan")
async def generate_plan(request: dict):
    """
    Generate a plan for any task based on current context, question, and available data.
    This can be called at any point during analysis to plan next steps.
    """
    try:
        llm_service = get_llm_service()
        question = request.get("question", "")
        context = request.get("context", "")
        current_state = request.get("current_state", {})
        available_data = request.get("available_data", [])
        task_type = request.get("task_type", "general")
        
        if not question:
            return {"error": "Question is required"}
        
        # Generate plan using LLM
        plan = await llm_service.generate_plan(
            question=question,
            context=context,
            current_state=current_state,
            available_data=available_data,
            task_type=task_type
        )
        
        return {
            "question": question,
            "context": context,
            "current_state": current_state,
            "plan": plan,
            "next_steps": plan.get("next_steps", []),
            "task_type": plan.get("task_type", task_type),
            "priority": plan.get("priority", "medium"),
            "estimated_time": plan.get("estimated_time", "unknown")
        }
        
    except Exception as e:
        print(f"Error generating plan: {e}")
        return {"error": str(e)}


@app.post("/llm/search-terms", response_model=SearchTermsResponse)
async def generate_search_terms(request: SearchTermsRequest):
    """Generate alternative search terms using LLM.
    
    Args:
        request: Search terms generation parameters
        
    Returns:
        List of alternative search terms
    """
    try:
        llm_service = get_llm_service()
        terms = await llm_service.generate_search_terms(
            user_query=request.query,
            attempt=request.attempt,
            is_first_attempt=request.is_first_attempt
        )
        
        return SearchTermsResponse(terms=terms)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate search terms: {str(e)}")


@app.post("/llm/suggestions", response_model=DataTypeSuggestionsResponse)
async def generate_data_type_suggestions(request: DataTypeSuggestionsRequest):
    """Generate analysis suggestions based on data types and user question."""
    try:
        llm_service = get_llm_service()
        suggestions = await llm_service.generate_data_type_suggestions(
            request.data_types,
            request.user_question,
            request.available_datasets,
            request.current_context
        )
        return DataTypeSuggestionsResponse(**suggestions)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating suggestions: {str(e)}")


@app.get("/search/gene/{gene}")
async def search_by_gene(
    gene: str,
    organism: Optional[str] = None,
    limit: int = SearchConfig.get_search_limit()
):
    """Find GEO datasets related to a specific gene.
    
    Args:
        gene: Gene name or symbol
        organism: Organism filter
        limit: Maximum results
        
    Returns:
        Gene-related datasets
    """
    try:
        client = get_geo_client()
        datasets = await client.search_by_gene(
            gene=gene,
            organism=organism,
            limit=limit
        )
        
        return {
            "gene": gene,
            "organism": organism,
            "datasets": datasets,
            "count": len(datasets)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gene search failed: {str(e)}")


@app.get("/search/disease/{disease}")
async def search_by_disease(
    disease: str,
    limit: int = SearchConfig.get_search_limit()
):
    """Find GEO datasets related to a specific disease.
    
    Args:
        disease: Disease name
        limit: Maximum results
        
    Returns:
        Disease-related datasets
    """
    try:
        client = get_geo_client()
        datasets = await client.search_by_disease(
            disease=disease,
            limit=limit
        )
        
        return {
            "disease": disease,
            "datasets": datasets,
            "count": len(datasets)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Disease search failed: {str(e)}")


# Broad Single Cell Portal endpoints
@app.post("/broad/search", response_model=List[DatasetResponse])
async def search_broad_studies(request: SearchRequest):
    """Search for single-cell studies in Broad Institute Single Cell Portal.
    
    Args:
        request: Search request with query and parameters
        
    Returns:
        List of matching studies
    """
    try:
        client = get_broad_client()
        studies = await client.find_similar_studies(
            query=request.query,
            limit=request.limit,
            organism=request.organism
        )
        
        # Convert to DatasetResponse format
        datasets = []
        for study in studies:
            datasets.append(DatasetResponse(
                id=study.get('id', ''),
                title=study.get('title', ''),
                description=study.get('description', ''),
                organism=study.get('organism', ''),
                sample_count=study.get('sample_count', ''),
                platform=study.get('platform', ''),
                similarity_score=study.get('similarity_score', 0.0),
                source='Broad Single Cell Portal'
            ))
        
        return datasets
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Broad search failed: {str(e)}")


@app.get("/broad/search/disease/{disease}")
async def search_broad_by_disease(
    disease: str,
    limit: int = SearchConfig.get_search_limit()
):
    """Find Broad single-cell studies related to a specific disease.
    
    Args:
        disease: Disease name
        limit: Maximum results
        
    Returns:
        Disease-related studies
    """
    try:
        client = get_broad_client()
        studies = await client.search_by_disease(
            disease=disease,
            limit=limit
        )
        
        return {
            "disease": disease,
            "studies": studies,
            "count": len(studies)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Broad disease search failed: {str(e)}")


@app.get("/broad/search/organism/{organism}")
async def search_broad_by_organism(
    organism: str,
    limit: int = SearchConfig.get_search_limit()
):
    """Find Broad single-cell studies for a specific organism.
    
    Args:
        organism: Organism name
        limit: Maximum results
        
    Returns:
        Organism-related studies
    """
    try:
        client = get_broad_client()
        studies = await client.search_by_organism(
            organism=organism,
            limit=limit
        )
        
        return {
            "organism": organism,
            "studies": studies,
            "count": len(studies)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Broad organism search failed: {str(e)}")


@app.get("/broad/search/tissue/{tissue}")
async def search_broad_by_tissue(
    tissue: str,
    limit: int = SearchConfig.get_search_limit()
):
    """Find Broad single-cell studies for a specific tissue type.
    
    Args:
        tissue: Tissue name
        limit: Maximum results
        
    Returns:
        Tissue-related studies
    """
    try:
        client = get_broad_client()
        studies = await client.search_by_tissue(
            tissue=tissue,
            limit=limit
        )
        
        return {
            "tissue": tissue,
            "studies": studies,
            "count": len(studies)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Broad tissue search failed: {str(e)}")


@app.get("/broad/search/technology/{technology}")
async def search_broad_by_technology(
    technology: str,
    limit: int = SearchConfig.get_search_limit()
):
    """Find Broad single-cell studies using a specific technology.
    
    Args:
        technology: Technology name
        limit: Maximum results
        
    Returns:
        Technology-related studies
    """
    try:
        client = get_broad_client()
        studies = await client.search_by_technology(
            technology=technology,
            limit=limit
        )
        
        return {
            "technology": technology,
            "studies": studies,
            "count": len(studies)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Broad technology search failed: {str(e)}")


@app.get("/broad/facets")
async def get_broad_facets():
    """Get available search facets for Broad Single Cell Portal.
    
    Returns:
        Available facets and their options
    """
    try:
        client = get_broad_client()
        facets = await client.get_available_facets()
        return facets
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get Broad facets: {str(e)}")


@app.get("/broad/tos/check")
async def check_broad_tos_acceptance():
    """Check if user has accepted current Terra Terms of Service.
    
    Returns:
        TOS acceptance status
    """
    try:
        client = get_broad_client()
        accepted = await client.check_terra_tos_acceptance()
        
        return {
            "tos_accepted": accepted,
            "message": "User has accepted Terra Terms of Service" if accepted else "User needs to accept Terra Terms of Service",
            "tos_url": "https://singlecell.broadinstitute.org/single_cell/terms"
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to check TOS acceptance: {str(e)}")


# Download endpoints
@app.get("/broad/studies/{study_accession}/files")
async def get_broad_study_files(study_accession: str):
    """Get list of files available for a Broad study."""
    try:
        client = get_broad_client()
        files = await client.get_study_files(study_accession)
        
        return {
            "study_accession": study_accession,
            "files": files,
            "count": len(files)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get study files: {str(e)}")


@app.post("/broad/studies/{study_accession}/download")
async def download_broad_study_file(
    study_accession: str,
    file_id: str,
    output_path: str
):
    """Download a specific file from a Broad study."""
    try:
        client = get_broad_client()
        success = await client.download_study_file(
            study_accession=study_accession,
            file_id=file_id,
            output_path=output_path
        )
        
        if success:
            return {
                "status": "success",
                "message": f"File {file_id} downloaded to {output_path}",
                "study_accession": study_accession,
                "file_id": file_id,
                "output_path": output_path
            }
        else:
            raise HTTPException(status_code=500, detail="Download failed")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Download failed: {str(e)}")


@app.get("/broad/studies/{study_accession}/manifest")
async def get_broad_study_manifest(study_accession: str):
    """Get study manifest for a Broad study."""
    try:
        client = get_broad_client()
        manifest = await client.get_study_manifest(study_accession)
        
        if manifest:
            return {
                "study_accession": study_accession,
                "manifest": manifest
            }
        else:
            raise HTTPException(status_code=404, detail="Manifest not found")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get manifest: {str(e)}")


@app.post("/broad/bulk-download/auth")
async def create_broad_bulk_download_auth(study_accessions: List[str]):
    """Create one-time auth code for bulk downloads."""
    try:
        client = get_broad_client()
        auth_code = await client.create_bulk_download_auth(study_accessions)
        
        if auth_code:
            return {
                "status": "success",
                "auth_code": auth_code,
                "study_accessions": study_accessions
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to create auth code")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create auth code: {str(e)}")


@app.get("/broad/bulk-download/summary/{auth_code}")
async def get_broad_bulk_download_summary(auth_code: str):
    """Get summary information for bulk download."""
    try:
        client = get_broad_client()
        summary = await client.get_bulk_download_summary(auth_code)
        
        if summary:
            return {
                "auth_code": auth_code,
                "summary": summary
            }
        else:
            raise HTTPException(status_code=404, detail="Summary not found")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get summary: {str(e)}")


@app.post("/broad/bulk-download/curl-config")
async def generate_broad_curl_config(auth_code: str, output_path: str):
    """Generate curl command file for bulk download."""
    try:
        client = get_broad_client()
        success = await client.generate_curl_config(auth_code, output_path)
        
        if success:
            return {
                "status": "success",
                "message": f"Curl config generated at {output_path}",
                "auth_code": auth_code,
                "output_path": output_path
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to generate curl config")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate curl config: {str(e)}")


# CellxCensus endpoints
@app.post("/cellxcensus/search", response_model=List[DatasetResponse])
async def search_cellxcensus_datasets(request: SearchRequest):
    """Search for single-cell datasets in CellxCensus.
    
    Args:
        request: Search request with query and parameters
        
    Returns:
        List of matching single-cell datasets
    """
    try:
        client = get_cellxcensus_client()
        datasets = await client.find_similar_datasets(
            query=request.query,
            limit=request.limit,
            organism=request.organism
        )
        
        # Convert to DatasetResponse format
        results = []
        for dataset in datasets:
            results.append(DatasetResponse(
                id=dataset.get('id', ''),
                title=dataset.get('title', ''),
                description=dataset.get('description', ''),
                organism=dataset.get('organism', ''),
                sample_count=dataset.get('sample_count', ''),
                platform=dataset.get('platform', ''),
                similarity_score=dataset.get('similarity_score', 0.0),
                source='CellxCensus'
            ))
        
        return results
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CellxCensus search failed: {str(e)}")


@app.post("/cellxcensus/search/stream")
async def search_cellxcensus_datasets_stream(request: SearchRequest):
    """Search CellxCensus datasets with real-time progress updates using Server-Sent Events.
    
    Args:
        request: Search parameters
        
    Returns:
        Streaming response with progress updates and final results
    """
    async def generate():
        try:
            client = get_cellxcensus_client()
            
            # Create a queue for real-time progress updates
            progress_queue = asyncio.Queue()
            
            # Set up progress callback
            def progress_callback(progress_data):
                asyncio.create_task(progress_queue.put(progress_data))
            
            client.set_progress_callback(progress_callback)
            
            # Send initial progress
            yield f"data: {json.dumps({'type': 'progress', 'step': 'init', 'progress': 10, 'message': 'Initializing CellxCensus search...', 'datasetsFound': 0})}\n\n"
            await asyncio.sleep(0.1)
            
            # Start the search in a separate task
            search_task = asyncio.create_task(
                client.find_similar_datasets(
                    query=request.query,
                    limit=request.limit,
                    organism=request.organism
                )
            )
            
            # Process progress updates in real-time
            while not search_task.done():
                try:
                    progress = await asyncio.wait_for(progress_queue.get(), timeout=0.1)
                    yield f"data: {json.dumps({'type': 'progress', **progress})}\n\n"
                except asyncio.TimeoutError:
                    pass
            
            # Get the search results
            datasets = await search_task
            
            # Send final results
            results = []
            for dataset in datasets:
                results.append({
                    "id": dataset.get("id", ""),
                    "title": dataset.get("title", ""),
                    "description": dataset.get("description", ""),
                    "organism": dataset.get("organism", "Unknown"),
                    "sample_count": dataset.get("sample_count", "0"),
                    "platform": dataset.get("platform", "Unknown"),
                    "similarity_score": dataset.get("similarity_score", 0.0),
                    "source": dataset.get("source", "CellxCensus"),
                    "url": dataset.get("url", "")
                })
            
            yield f"data: {json.dumps({'type': 'results', 'datasets': results})}\n\n"
            
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/plain",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Content-Type": "text/event-stream",
        }
    )


@app.get("/cellxcensus/search/cell_type/{cell_type}")
async def search_cellxcensus_by_cell_type(
    cell_type: str,
    organism: Optional[str] = None,
    limit: int = SearchConfig.get_search_limit()
):
    """Find datasets by treating the cell type as a query term."""
    try:
        client = get_cellxcensus_client()
        datasets = await client.find_similar_datasets(
            query=cell_type,
            limit=limit,
            organism=organism or DEFAULT_ORGANISM,
        )
        return {
            "cell_type": cell_type,
            "organism": organism or DEFAULT_ORGANISM,
            "datasets": datasets,
            "count": len(datasets),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CellxCensus cell type search failed: {str(e)}")


@app.get("/cellxcensus/search/tissue/{tissue}")
async def search_cellxcensus_by_tissue(
    tissue: str,
    organism: Optional[str] = None,
    limit: int = SearchConfig.get_search_limit()
):
    """Find datasets by treating the tissue as a query term."""
    try:
        client = get_cellxcensus_client()
        datasets = await client.find_similar_datasets(
            query=tissue,
            limit=limit,
            organism=organism or DEFAULT_ORGANISM,
        )
        return {
            "tissue": tissue,
            "organism": organism or DEFAULT_ORGANISM,
            "datasets": datasets,
            "count": len(datasets),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CellxCensus tissue search failed: {str(e)}")


@app.get("/cellxcensus/search/disease/{disease}")
async def search_cellxcensus_by_disease(
    disease: str,
    organism: Optional[str] = None,
    limit: int = SearchConfig.get_search_limit()
):
    """Find datasets by treating the disease as a query term."""
    try:
        client = get_cellxcensus_client()
        datasets = await client.find_similar_datasets(
            query=disease,
            limit=limit,
            organism=organism or DEFAULT_ORGANISM,
        )
        return {
            "disease": disease,
            "organism": organism or DEFAULT_ORGANISM,
            "datasets": datasets,
            "count": len(datasets),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CellxCensus disease search failed: {str(e)}")


class DatasetDataRequest(BaseModel):
    dataset_id: str
    organism: str = "Homo sapiens"
    cell_type: Optional[str] = None
    tissue: Optional[str] = None
    genes: Optional[List[str]] = None


@app.post("/cellxcensus/dataset/data")
async def get_cellxcensus_dataset_data(request: DatasetDataRequest):
    """Return minimal dataset info stub. Full data fetch not implemented in SimpleCellxCensusClient."""
    try:
        # For now, provide a stub response indicating where to fetch the h5ad
        return {
            "dataset_id": request.dataset_id,
            "organism": request.organism,
            "message": "Use dataset_version_id.h5ad URL from /cellxcensus/search results to download and load with anndata.read_h5ad."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get dataset data: {str(e)}")


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    # Check if LLM service is properly configured
    llm_service = get_llm_service()
    llm_status = "configured" if llm_service.provider else "not_configured"
    
    # Check environment variables (without exposing the actual key)
    openai_key_set = bool(os.getenv("OPENAI_API_KEY"))
    anthropic_key_set = bool(os.getenv("ANTHROPIC_API_KEY"))
    
    return {
        "status": "healthy", 
        "service": "GEO and Broad Single Cell Semantic Search",
        "llm_service": llm_status,
        "openai_key_configured": openai_key_set,
        "anthropic_key_configured": anthropic_key_set
    }


def run_server(host: str = "0.0.0.0", port: int = 8000):
    """Run the minimal API server."""
    print(f"🚀 Starting Minimal GEO Semantic Search API on {host}:{port}")
    print(f"📖 API Documentation: http://{host}:{port}/docs")
    
    uvicorn.run(
        "backend.api:app",
        host=host,
        port=port,
        reload=True
    )


if __name__ == "__main__":
    run_server() 