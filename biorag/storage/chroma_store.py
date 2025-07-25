"""ChromaDB vector storage implementation."""

import uuid
from typing import List, Dict, Any, Optional, Union
import chromadb
from chromadb.config import Settings as ChromaSettings
import numpy as np

from ..config import settings


class ChromaStore:
    """Vector storage using ChromaDB."""
    
    def __init__(
        self, 
        collection_name: str = None,
        persist_directory: str = None
    ):
        """Initialize ChromaDB store.
        
        Args:
            collection_name: Name of the collection
            persist_directory: Directory to persist data
        """
        self.collection_name = collection_name or settings.chroma_collection_name
        self.persist_directory = persist_directory or settings.chroma_persist_directory
        
        # Initialize ChromaDB client
        self.client = chromadb.PersistentClient(
            path=self.persist_directory,
            settings=ChromaSettings(
                anonymized_telemetry=False,
                allow_reset=True
            )
        )
        
        # Get or create collection
        self.collection = self.client.get_or_create_collection(
            name=self.collection_name,
            metadata={"description": "BioRAG biological documents collection"}
        )
    
    async def add_documents(
        self, 
        documents: List[Dict[str, Any]], 
        embeddings: Optional[List[List[float]]] = None
    ) -> List[str]:
        """Add documents to the vector store.
        
        Args:
            documents: List of documents to add
            embeddings: Optional pre-computed embeddings
            
        Returns:
            List of document IDs
        """
        if not documents:
            return []
        
        # Generate IDs for documents
        ids = []
        texts = []
        metadatas = []
        
        for i, doc in enumerate(documents):
            # Generate ID if not present
            doc_id = doc.get("id", str(uuid.uuid4()))
            ids.append(doc_id)
            
            # Extract text for storage
            text = doc.get("embedding_text", "")
            if not text:
                # Fallback to combining title and description
                text_parts = []
                for field in ["title", "description", "abstract", "function"]:
                    if field in doc and doc[field]:
                        text_parts.append(str(doc[field]))
                text = " ".join(text_parts)
            
            texts.append(text)
            
            # Prepare metadata (exclude embedding and large fields)
            metadata = {}
            for key, value in doc.items():
                if key not in ["embedding", "embedding_text"] and value is not None:
                    # ChromaDB metadata must be strings, numbers, or booleans
                    if isinstance(value, (str, int, float, bool)):
                        metadata[key] = value
                    elif isinstance(value, list):
                        # Convert lists to comma-separated strings
                        metadata[key] = ", ".join(str(v) for v in value)
                    else:
                        metadata[key] = str(value)
            
            metadatas.append(metadata)
        
        # Use provided embeddings or extract from documents
        if embeddings is None:
            embeddings = []
            for doc in documents:
                if "embedding" in doc:
                    embeddings.append(doc["embedding"])
                else:
                    # This should not happen if embeddings are properly generated
                    raise ValueError("Documents must have embeddings or embeddings must be provided")
        
        # Add to ChromaDB
        self.collection.add(
            ids=ids,
            documents=texts,
            metadatas=metadatas,
            embeddings=embeddings
        )
        
        return ids
    
    async def search(
        self, 
        query_embedding: Union[List[float], np.ndarray],
        limit: int = 10,
        where: Optional[Dict[str, Any]] = None,
        where_document: Optional[Dict[str, str]] = None
    ) -> List[Dict[str, Any]]:
        """Search for similar documents.
        
        Args:
            query_embedding: Query embedding vector
            limit: Maximum number of results
            where: Metadata filters
            where_document: Document content filters
            
        Returns:
            List of similar documents with metadata
        """
        # Convert numpy array to list if needed
        if isinstance(query_embedding, np.ndarray):
            query_embedding = query_embedding.tolist()
        
        # Perform similarity search
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=limit,
            where=where,
            where_document=where_document,
            include=["documents", "metadatas", "distances"]
        )
        
        # Format results
        documents = []
        if results["ids"]:
            for i in range(len(results["ids"][0])):
                doc = {
                    "id": results["ids"][0][i],
                    "text": results["documents"][0][i],
                    "metadata": results["metadatas"][0][i],
                    "distance": results["distances"][0][i],
                    "similarity_score": 1 - results["distances"][0][i]  # Convert distance to similarity
                }
                
                # Merge metadata into main document
                doc.update(doc["metadata"])
                
                documents.append(doc)
        
        return documents
    
    async def search_by_metadata(
        self, 
        filters: Dict[str, Any],
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Search documents by metadata filters only.
        
        Args:
            filters: Metadata filters
            limit: Maximum number of results
            
        Returns:
            List of matching documents
        """
        results = self.collection.get(
            where=filters,
            limit=limit,
            include=["documents", "metadatas"]
        )
        
        # Format results
        documents = []
        if results["ids"]:
            for i in range(len(results["ids"])):
                doc = {
                    "id": results["ids"][i],
                    "text": results["documents"][i],
                    "metadata": results["metadatas"][i]
                }
                
                # Merge metadata into main document
                doc.update(doc["metadata"])
                
                documents.append(doc)
        
        return documents
    
    async def get_document(self, doc_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific document by ID.
        
        Args:
            doc_id: Document ID
            
        Returns:
            Document if found, None otherwise
        """
        results = self.collection.get(
            ids=[doc_id],
            include=["documents", "metadatas"]
        )
        
        if results["ids"]:
            doc = {
                "id": results["ids"][0],
                "text": results["documents"][0],
                "metadata": results["metadatas"][0]
            }
            doc.update(doc["metadata"])
            return doc
        
        return None
    
    async def update_document(
        self, 
        doc_id: str, 
        document: Dict[str, Any],
        embedding: Optional[List[float]] = None
    ) -> bool:
        """Update an existing document.
        
        Args:
            doc_id: Document ID
            document: Updated document data
            embedding: Updated embedding
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Prepare update data
            update_data = {"ids": [doc_id]}
            
            # Update text if available
            text = document.get("embedding_text", "")
            if not text:
                text_parts = []
                for field in ["title", "description", "abstract", "function"]:
                    if field in document and document[field]:
                        text_parts.append(str(document[field]))
                text = " ".join(text_parts)
            
            if text:
                update_data["documents"] = [text]
            
            # Update metadata
            metadata = {}
            for key, value in document.items():
                if key not in ["embedding", "embedding_text"] and value is not None:
                    if isinstance(value, (str, int, float, bool)):
                        metadata[key] = value
                    elif isinstance(value, list):
                        metadata[key] = ", ".join(str(v) for v in value)
                    else:
                        metadata[key] = str(value)
            
            if metadata:
                update_data["metadatas"] = [metadata]
            
            # Update embedding if provided
            if embedding:
                update_data["embeddings"] = [embedding]
            elif "embedding" in document:
                update_data["embeddings"] = [document["embedding"]]
            
            # Perform update
            self.collection.update(**update_data)
            return True
            
        except Exception as e:
            print(f"Error updating document {doc_id}: {e}")
            return False
    
    async def delete_document(self, doc_id: str) -> bool:
        """Delete a document by ID.
        
        Args:
            doc_id: Document ID
            
        Returns:
            True if successful, False otherwise
        """
        try:
            self.collection.delete(ids=[doc_id])
            return True
        except Exception as e:
            print(f"Error deleting document {doc_id}: {e}")
            return False
    
    async def delete_collection(self) -> bool:
        """Delete the entire collection.
        
        Returns:
            True if successful, False otherwise
        """
        try:
            self.client.delete_collection(name=self.collection_name)
            return True
        except Exception as e:
            print(f"Error deleting collection {self.collection_name}: {e}")
            return False
    
    async def get_collection_stats(self) -> Dict[str, Any]:
        """Get collection statistics.
        
        Returns:
            Collection statistics
        """
        try:
            count = self.collection.count()
            return {
                "name": self.collection_name,
                "document_count": count,
                "persist_directory": self.persist_directory
            }
        except Exception as e:
            print(f"Error getting collection stats: {e}")
            return {}
    
    def reset_collection(self):
        """Reset the collection (delete all documents)."""
        try:
            # Delete and recreate collection
            self.client.delete_collection(name=self.collection_name)
            self.collection = self.client.get_or_create_collection(
                name=self.collection_name,
                metadata={"description": "BioRAG biological documents collection"}
            )
        except Exception as e:
            print(f"Error resetting collection: {e}")
    
    async def list_documents(
        self, 
        limit: int = 100,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """List all documents in the collection.
        
        Args:
            limit: Maximum number of documents to return
            offset: Number of documents to skip
            
        Returns:
            List of documents
        """
        try:
            results = self.collection.get(
                limit=limit,
                offset=offset,
                include=["documents", "metadatas"]
            )
            
            documents = []
            if results["ids"]:
                for i in range(len(results["ids"])):
                    doc = {
                        "id": results["ids"][i],
                        "text": results["documents"][i],
                        "metadata": results["metadatas"][i]
                    }
                    doc.update(doc["metadata"])
                    documents.append(doc)
            
            return documents
            
        except Exception as e:
            print(f"Error listing documents: {e}")
            return [] 