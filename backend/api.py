"""Minimal FastAPI application for GEO semantic search."""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import uvicorn
import json

from .geo_search import SimpleGEOClient
from .llm_service import get_llm_service

app = FastAPI(
    title="Minimal GEO Semantic Search",
    description="Simple API for finding similar GEO datasets using semantic search",
    version="1.0.0"
)

# Initialize the simple client lazily
geo_client = None

def get_geo_client():
    """Get or create the GEO client."""
    global geo_client
    if geo_client is None:
        geo_client = SimpleGEOClient()
    return geo_client


class SearchRequest(BaseModel):
    query: str
    limit: int = 10
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
    limit: int = 10
    organism: Optional[str] = None
    max_attempts: int = 3


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


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "Minimal GEO Semantic Search API",
        "version": "1.0.0",
        "endpoints": {
            "search": "/search",
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


@app.post("/search/llm", response_model=LLMSearchResponse)
async def llm_search_datasets(request: LLMSearchRequest):
    """Find GEO datasets using LLM-generated search terms.
    
    Args:
        request: Search parameters with LLM processing
        
    Returns:
        Search results with LLM-generated terms and search steps
    """
    try:
        geo_client = get_geo_client()
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
                    search_steps.append(f"Searching for: {term}")
                    
                    search_results = await geo_client.find_similar_datasets(
                        query=term,
                        limit=request.limit // len(llm_search_terms),
                        organism=request.organism
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
                sample_count=dataset.get("sample_count", "0"),
                platform=dataset.get("platform", "Unknown"),
                similarity_score=dataset.get("similarity_score", 0.0)
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
        llm_service = get_llm_service()
        task_description = request.get("task_description", "")
        language = request.get("language", "python")
        context = request.get("context", "")
        
        if not task_description:
            return {"error": "Task description is required"}
        
        from fastapi.responses import StreamingResponse
        
        async def generate():
            async for chunk in llm_service.generate_code_stream(
                task_description=task_description,
                language=language,
                context=context
            ):
                yield f"data: {json.dumps({'chunk': chunk})}\n\n"
        
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
        return {"error": str(e)}


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


@app.get("/search/gene/{gene}")
async def search_by_gene(
    gene: str,
    organism: Optional[str] = None,
    limit: int = 10
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


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "GEO Semantic Search"}


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