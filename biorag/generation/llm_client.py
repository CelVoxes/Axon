"""LLM client for text generation."""

from typing import List, Dict, Any, Optional
import openai
from openai import AsyncOpenAI

from ..config import settings


class LLMClient:
    """Client for language model generation."""
    
    def __init__(self, api_key: str = None, model: str = None):
        """Initialize LLM client.
        
        Args:
            api_key: OpenAI API key
            model: Model name to use
        """
        self.api_key = api_key or settings.openai_api_key
        self.model = model or settings.openai_model
        
        if not self.api_key:
            raise ValueError("OpenAI API key is required")
        
        self.client = AsyncOpenAI(api_key=self.api_key)
    
    async def generate_response(
        self,
        query: str,
        context_documents: List[Dict[str, Any]],
        system_prompt: str = None,
        max_tokens: int = 1000,
        temperature: float = 0.3
    ) -> Dict[str, Any]:
        """Generate a response using retrieved context.
        
        Args:
            query: User query
            context_documents: Retrieved documents for context
            system_prompt: System prompt to use
            max_tokens: Maximum tokens to generate
            temperature: Generation temperature
            
        Returns:
            Generated response with metadata
        """
        # Build context from documents
        context = self._build_context(context_documents)
        
        # Create messages
        messages = []
        
        # System prompt
        if system_prompt is None:
            system_prompt = self._get_default_system_prompt()
        
        messages.append({"role": "system", "content": system_prompt})
        
        # User message with context
        user_content = self._format_user_message(query, context)
        messages.append({"role": "user", "content": user_content})
        
        try:
            # Generate response
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
                stream=False
            )
            
            answer = response.choices[0].message.content
            
            return {
                "answer": answer,
                "query": query,
                "context_used": len(context_documents),
                "model": self.model,
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens
                }
            }
            
        except Exception as e:
            return {
                "answer": f"Error generating response: {str(e)}",
                "query": query,
                "context_used": 0,
                "model": self.model,
                "error": str(e)
            }
    
    def _build_context(self, documents: List[Dict[str, Any]]) -> str:
        """Build context string from documents.
        
        Args:
            documents: List of retrieved documents
            
        Returns:
            Formatted context string
        """
        if not documents:
            return "No relevant documents found."
        
        context_parts = []
        
        for i, doc in enumerate(documents, 1):
            # Extract key information
            source = doc.get("source", "Unknown")
            title = doc.get("title", "Untitled")
            description = doc.get("description", doc.get("abstract", "No description"))
            
            # Format document with academic citation style
            doc_text = f"[{i}] Source: {source}\n"
            doc_text += f"Title: {title}\n"
            
            if description:
                # Truncate long descriptions
                if len(description) > 500:
                    description = description[:500] + "..."
                doc_text += f"Description: {description}\n"
            
            # Add biological metadata if available
            if doc.get("organism"):
                doc_text += f"Organism: {doc.get('organism')}\n"
            
            if doc.get("gene_names"):
                genes = doc["gene_names"] if isinstance(doc["gene_names"], list) else [doc["gene_names"]]
                doc_text += f"Genes: {', '.join(genes[:3])}\n"  # Limit to first 3 genes
            
            if doc.get("mesh_terms"):
                mesh = doc["mesh_terms"] if isinstance(doc["mesh_terms"], list) else [doc["mesh_terms"]]
                doc_text += f"Keywords: {', '.join(mesh[:5])}\n"  # Limit to first 5 terms
            
            context_parts.append(doc_text)
        
        return "\n".join(context_parts)
    
    def _format_user_message(self, query: str, context: str) -> str:
        """Format the user message with query and context.
        
        Args:
            query: User query
            context: Document context
            
        Returns:
            Formatted message
        """
        return f"""Question: {query}

Context from biological databases:
{context}

Please provide a comprehensive, well-formatted answer based on the provided context. Use clear markdown formatting with headers, bullet points, and proper structure. Bold important biological terms. If the context doesn't contain enough information to fully answer the question, please indicate what additional information might be needed."""
    
    def _get_default_system_prompt(self) -> str:
        """Get the default system prompt for biological queries."""
        return """You are a knowledgeable biological research assistant with expertise in genomics, proteomics, disease biology, and bioinformatics. Your role is to help researchers understand complex biological concepts and data.

Guidelines:
1. Base your answers primarily on the provided context from biological databases (GEO, PubMed, UniProt, etc.)
2. Explain biological concepts clearly and accurately
3. Use proper scientific terminology while remaining accessible
4. When discussing genes, proteins, or pathways, provide relevant biological context
5. If the context is insufficient, clearly state what additional information would be helpful
6. Include relevant details about organisms, experimental methods, or disease associations when available
7. Use academic citation format [1], [2], [3], etc. when referencing specific documents
8. Be precise about statistical significance and experimental evidence levels

FORMATTING REQUIREMENTS:
- Use clear markdown formatting with headers (##, ###)
- Structure information with bullet points and numbered lists
- Bold important terms using **bold text**
- Use line breaks between sections for readability
- Include subsections when covering multiple topics
- Format gene names in caps (e.g., **BRCA1**, **TP53**)
- Format drug names and protocols clearly
- Use tables when comparing multiple items

Citation format: When referencing the provided documents, use [1], [2], [3] format instead of "Document 1", "Document 2", etc.

Remember that your audience consists of researchers and scientists who need accurate, evidence-based information."""
    
    async def generate_summary(
        self,
        documents: List[Dict[str, Any]],
        focus_area: str = None,
        max_tokens: int = 500
    ) -> str:
        """Generate a summary of multiple documents.
        
        Args:
            documents: Documents to summarize
            focus_area: Specific area to focus on (gene, disease, etc.)
            max_tokens: Maximum tokens for summary
            
        Returns:
            Generated summary
        """
        if not documents:
            return "No documents to summarize."
        
        context = self._build_context(documents)
        
        focus_instruction = ""
        if focus_area:
            focus_instruction = f" Focus particularly on {focus_area}-related information."
        
        prompt = f"""Please provide a concise summary of the following biological research documents.{focus_instruction} Use academic citation format [1], [2], [3] when referencing specific documents.

Documents:
{context}

Summary:"""
        
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "You are a scientific summarization assistant. Create clear, accurate summaries of biological research. Use academic citation format [1], [2], [3] when referencing documents."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=max_tokens,
                temperature=0.3
            )
            
            return response.choices[0].message.content
            
        except Exception as e:
            return f"Error generating summary: {str(e)}"
    
    async def generate_research_insights(
        self,
        query: str,
        documents: List[Dict[str, Any]],
        max_tokens: int = 800
    ) -> Dict[str, Any]:
        """Generate research insights and potential follow-up questions.
        
        Args:
            query: Original research query
            documents: Retrieved documents
            max_tokens: Maximum tokens to generate
            
        Returns:
            Research insights with follow-up questions
        """
        context = self._build_context(documents)
        
        prompt = f"""Based on the research question "{query}" and the following scientific documents, provide:

1. Key research insights and findings
2. Gaps in current knowledge
3. Potential follow-up research questions
4. Relevant experimental approaches that might be useful

Documents:
{context}

Please structure your response clearly with these four sections."""
        
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "You are a research strategist helping scientists identify insights and research directions from biological literature. Use academic citation format [1], [2], [3] when referencing documents."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=max_tokens,
                temperature=0.4
            )
            
            content = response.choices[0].message.content
            
            return {
                "insights": content,
                "query": query,
                "documents_analyzed": len(documents),
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens
                }
            }
            
        except Exception as e:
            return {
                "insights": f"Error generating insights: {str(e)}",
                "query": query,
                "documents_analyzed": 0,
                "error": str(e)
            } 