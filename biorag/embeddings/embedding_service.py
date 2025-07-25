"""General embedding service using sentence transformers."""

import asyncio
from typing import List, Union, Dict, Any
import numpy as np
from sentence_transformers import SentenceTransformer

from ..config import settings


class EmbeddingService:
    """Service for generating text embeddings."""
    
    def __init__(self, model_name: str = None):
        """Initialize embedding service.
        
        Args:
            model_name: Name of the sentence transformer model
        """
        self.model_name = model_name or settings.embedding_model
        self.model = None
        self._lock = asyncio.Lock()
    
    async def _ensure_model_loaded(self):
        """Ensure the model is loaded."""
        if self.model is None:
            async with self._lock:
                if self.model is None:
                    # Load model in thread pool to avoid blocking
                    loop = asyncio.get_event_loop()
                    self.model = await loop.run_in_executor(
                        None, 
                        SentenceTransformer, 
                        self.model_name
                    )
    
    async def encode(
        self, 
        texts: Union[str, List[str]], 
        batch_size: int = 32,
        normalize_embeddings: bool = True
    ) -> np.ndarray:
        """Encode texts into embeddings.
        
        Args:
            texts: Text or list of texts to encode
            batch_size: Batch size for encoding
            normalize_embeddings: Whether to normalize embeddings
            
        Returns:
            Numpy array of embeddings
        """
        await self._ensure_model_loaded()
        
        if isinstance(texts, str):
            texts = [texts]
        
        # Run encoding in thread pool
        loop = asyncio.get_event_loop()
        embeddings = await loop.run_in_executor(
            None,
            lambda: self.model.encode(
                texts,
                batch_size=batch_size,
                normalize_embeddings=normalize_embeddings,
                convert_to_numpy=True
            )
        )
        
        return embeddings
    
    async def encode_documents(
        self, 
        documents: List[Dict[str, Any]],
        text_fields: List[str] = None
    ) -> List[Dict[str, Any]]:
        """Encode documents with metadata.
        
        Args:
            documents: List of documents to encode
            text_fields: Fields to use for text embedding (default: title, description)
            
        Returns:
            Documents with embeddings added
        """
        if not documents:
            return []
        
        if text_fields is None:
            text_fields = ["title", "description", "abstract"]
        
        # Extract texts for embedding
        texts = []
        for doc in documents:
            text_parts = []
            for field in text_fields:
                if field in doc and doc[field]:
                    text_parts.append(str(doc[field]))
            
            combined_text = " ".join(text_parts) if text_parts else ""
            texts.append(combined_text)
        
        # Generate embeddings
        embeddings = await self.encode(texts)
        
        # Add embeddings to documents
        result_documents = []
        for i, doc in enumerate(documents):
            doc_with_embedding = doc.copy()
            doc_with_embedding["embedding"] = embeddings[i].tolist()
            doc_with_embedding["embedding_text"] = texts[i]
            result_documents.append(doc_with_embedding)
        
        return result_documents
    
    async def compute_similarity(
        self, 
        query_embedding: np.ndarray, 
        document_embeddings: np.ndarray
    ) -> np.ndarray:
        """Compute cosine similarity between query and document embeddings.
        
        Args:
            query_embedding: Query embedding vector
            document_embeddings: Document embedding matrix
            
        Returns:
            Similarity scores
        """
        # Normalize embeddings if not already normalized
        query_norm = query_embedding / np.linalg.norm(query_embedding)
        doc_norms = document_embeddings / np.linalg.norm(document_embeddings, axis=1, keepdims=True)
        
        # Compute cosine similarity
        similarities = np.dot(doc_norms, query_norm)
        return similarities
    
    async def find_similar_documents(
        self, 
        query: str,
        documents: List[Dict[str, Any]],
        top_k: int = 10
    ) -> List[Dict[str, Any]]:
        """Find documents most similar to a query.
        
        Args:
            query: Query text
            documents: List of documents with embeddings
            top_k: Number of top results to return
            
        Returns:
            Top k most similar documents with similarity scores
        """
        if not documents:
            return []
        
        # Check if documents need embeddings
        docs_need_embeddings = any("embedding" not in doc for doc in documents)
        
        if docs_need_embeddings:
            # Generate embeddings for documents that don't have them
            documents = await self.encode_documents(documents)
        
        # Encode query
        query_embedding = await self.encode(query)
        query_embedding = query_embedding[0]  # Extract single embedding
        
        # Extract document embeddings
        doc_embeddings = np.array([doc["embedding"] for doc in documents])
        
        # Compute similarities
        similarities = await self.compute_similarity(query_embedding, doc_embeddings)
        
        # Get top k indices
        top_indices = np.argsort(similarities)[::-1][:top_k]
        
        # Return top documents with scores
        results = []
        for idx in top_indices:
            doc = documents[idx].copy()
            doc["similarity_score"] = float(similarities[idx])
            results.append(doc)
        
        return results
    
    def get_embedding_dimension(self) -> int:
        """Get the dimension of embeddings from this model.
        
        Returns:
            Embedding dimension
        """
        return self.model.get_sentence_embedding_dimension() if self.model else settings.embedding_dimension 