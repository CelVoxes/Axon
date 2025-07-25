"""Pydantic schemas for API requests and responses."""

from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from datetime import datetime


class QueryRequest(BaseModel):
    """Request schema for biological queries."""
    question: str = Field(..., description="The biological question to ask")
    max_documents: int = Field(default=10, ge=1, le=50, description="Maximum number of documents to retrieve")
    retrieve_from_sources: bool = Field(default=True, description="Whether to search external sources")
    response_type: str = Field(default="answer", description="Type of response: answer, summary, or insights")
    system_prompt: Optional[str] = Field(None, description="Custom system prompt")


class DocumentInfo(BaseModel):
    """Document information schema."""
    id: str
    title: Optional[str] = None
    source: Optional[str] = None
    type: Optional[str] = None
    organism: Optional[str] = None
    similarity_score: Optional[float] = None
    description: Optional[str] = None


class RetrievalInfo(BaseModel):
    """Retrieval information schema."""
    query: str
    processed_query: str
    entities: Dict[str, List[str]]
    context_type: Optional[str]
    search_strategy: str
    documents_found: int
    documents: List[DocumentInfo]


class GenerationInfo(BaseModel):
    """Generation information schema."""
    model: Optional[str]
    usage: Dict[str, Any] = {}
    context_used: int


class TimingInfo(BaseModel):
    """Timing information schema."""
    retrieval_time_ms: int
    generation_time_ms: int
    total_time_ms: int


class QueryResponse(BaseModel):
    """Response schema for biological queries."""
    question: str
    answer: str
    response_type: str
    retrieval: RetrievalInfo
    generation: GenerationInfo
    timing: TimingInfo
    metadata: Dict[str, Any]
    error: Optional[str] = None


class GeneSearchRequest(BaseModel):
    """Request schema for gene-specific searches."""
    gene: str = Field(..., description="Gene name or symbol")
    organism: Optional[str] = Field(None, description="Organism name")
    question: Optional[str] = Field(None, description="Specific question about the gene")
    response_type: str = Field(default="answer", description="Type of response")


class DiseaseSearchRequest(BaseModel):
    """Request schema for disease-specific searches."""
    disease: str = Field(..., description="Disease name")
    question: Optional[str] = Field(None, description="Specific question about the disease")
    response_type: str = Field(default="answer", description="Type of response")


class ComparisonRequest(BaseModel):
    """Request schema for entity comparisons."""
    entities: List[str] = Field(..., description="List of entities to compare")
    entity_type: str = Field(default="gene", description="Type of entities (gene, protein, disease)")
    comparison_aspect: str = Field(default="function", description="Aspect to compare")


class PathwayRequest(BaseModel):
    """Request schema for pathway exploration."""
    pathway: str = Field(..., description="Pathway name")
    focus: str = Field(default="overview", description="Focus area (overview, genes, diseases, drugs)")


class ResearchRecommendationRequest(BaseModel):
    """Request schema for research recommendations."""
    research_area: str = Field(..., description="Area of research interest")
    current_knowledge: Optional[str] = Field(None, description="Current state of knowledge")


class ExperimentalDesignRequest(BaseModel):
    """Request schema for experimental design suggestions."""
    research_question: str = Field(..., description="The research question")
    organism: Optional[str] = Field(None, description="Target organism")


class DocumentSearchRequest(BaseModel):
    """Request schema for document search."""
    query: str = Field(..., description="Search query")
    limit: int = Field(default=10, ge=1, le=100, description="Maximum number of results")
    filters: Optional[Dict[str, Any]] = Field(None, description="Metadata filters")
    source_types: Optional[List[str]] = Field(None, description="Filter by source types")


class DocumentResponse(BaseModel):
    """Response schema for document information."""
    id: str
    title: Optional[str]
    description: Optional[str]
    source: Optional[str]
    type: Optional[str]
    organism: Optional[str]
    gene_names: Optional[List[str]]
    keywords: Optional[List[str]]
    publication_date: Optional[str]
    similarity_score: Optional[float]
    metadata: Dict[str, Any] = {}


class SearchResponse(BaseModel):
    """Response schema for search results."""
    query: str
    documents: List[DocumentResponse]
    document_count: int
    metadata: Dict[str, Any] = {}


class StatsResponse(BaseModel):
    """Response schema for system statistics."""
    document_count: int
    collection_name: str
    persist_directory: str
    embedding_model: str
    sources: Dict[str, int] = {}


class HealthResponse(BaseModel):
    """Response schema for health check."""
    status: str
    version: str
    timestamp: datetime
    components: Dict[str, str] = {}


class ErrorResponse(BaseModel):
    """Response schema for errors."""
    error: str
    detail: Optional[str] = None
    timestamp: datetime 