"""Specialized embedding service for biological text."""

import re
from typing import List, Dict, Any, Optional
from .embedding_service import EmbeddingService


class BioEmbeddingService(EmbeddingService):
    """Specialized embedding service for biological text with domain-specific preprocessing."""
    
    def __init__(self, model_name: str = None):
        """Initialize biological embedding service.
        
        Args:
            model_name: Name of the sentence transformer model (use biomedical model if available)
        """
        # Use biomedical-specific model if available, otherwise fallback to general model
        bio_model = model_name or "all-MiniLM-L6-v2"  # Could use "dmis-lab/biobert-base-cased-v1.1" if available
        super().__init__(bio_model)
        
        # Biological term patterns for preprocessing
        self.gene_pattern = re.compile(r'\b[A-Z][A-Z0-9]+\b')  # Gene symbols (e.g., TP53, BRCA1)
        self.protein_pattern = re.compile(r'\b[A-Z][a-z0-9]+(?:-[A-Z0-9]+)*\b')  # Protein names
        self.disease_pattern = re.compile(r'\b(?:cancer|carcinoma|tumor|disease|syndrome|disorder)\b', re.IGNORECASE)
        self.organism_pattern = re.compile(r'\b(?:Homo sapiens|human|mouse|rat|Mus musculus|Rattus norvegicus)\b', re.IGNORECASE)
    
    def preprocess_biological_text(self, text: str) -> str:
        """Preprocess biological text for better embeddings.
        
        Args:
            text: Input biological text
            
        Returns:
            Preprocessed text
        """
        if not text:
            return ""
        
        # Normalize common biological abbreviations
        text = self._normalize_biological_terms(text)
        
        # Handle gene/protein names
        text = self._handle_gene_protein_names(text)
        
        # Clean up formatting
        text = self._clean_text(text)
        
        return text
    
    def _normalize_biological_terms(self, text: str) -> str:
        """Normalize common biological terms and abbreviations."""
        # Common biological term normalizations
        normalizations = {
            r'\bDNA\b': 'deoxyribonucleic acid',
            r'\bRNA\b': 'ribonucleic acid',
            r'\bmRNA\b': 'messenger RNA',
            r'\bmiRNA\b': 'microRNA',
            r'\bsiRNA\b': 'small interfering RNA',
            r'\bPCR\b': 'polymerase chain reaction',
            r'\bqPCR\b': 'quantitative PCR',
            r'\bRT-PCR\b': 'reverse transcription PCR',
            r'\bWGS\b': 'whole genome sequencing',
            r'\bRNA-seq\b': 'RNA sequencing',
            r'\bChIP-seq\b': 'chromatin immunoprecipitation sequencing',
            r'\bFPKM\b': 'fragments per kilobase per million',
            r'\bTPM\b': 'transcripts per million',
            r'\bGO\b': 'gene ontology',
            r'\bKEGG\b': 'kyoto encyclopedia genes genomes',
            r'\bIC50\b': 'half maximal inhibitory concentration',
            r'\bEC50\b': 'half maximal effective concentration',
            r'\bp-value\b': 'statistical significance value',
            r'\bFDR\b': 'false discovery rate',
            r'\bSNP\b': 'single nucleotide polymorphism',
            r'\bCNV\b': 'copy number variation',
            r'\bGWAS\b': 'genome wide association study',
            r'\beQTL\b': 'expression quantitative trait locus',
        }
        
        for pattern, replacement in normalizations.items():
            text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
        
        return text
    
    def _handle_gene_protein_names(self, text: str) -> str:
        """Handle gene and protein name formatting."""
        # Ensure gene symbols are properly spaced
        text = re.sub(r'([A-Z]{2,}[0-9]+)', r' \1 ', text)
        
        # Handle common protein family suffixes
        text = re.sub(r'([A-Z][a-z]+)(ase|oma|ine|one|ide)\b', r'\1 \2', text)
        
        return text
    
    def _clean_text(self, text: str) -> str:
        """Clean and normalize text formatting."""
        # Remove extra whitespace
        text = re.sub(r'\s+', ' ', text)
        
        # Remove special characters that don't add meaning
        text = re.sub(r'[^\w\s\-\(\)\/\.]', ' ', text)
        
        # Normalize case for better matching
        text = text.strip()
        
        return text
    
    async def encode_biological_documents(
        self, 
        documents: List[Dict[str, Any]],
        text_fields: List[str] = None,
        include_metadata: bool = True
    ) -> List[Dict[str, Any]]:
        """Encode biological documents with specialized preprocessing.
        
        Args:
            documents: List of biological documents
            text_fields: Fields to use for embedding
            include_metadata: Whether to include biological metadata in embedding
            
        Returns:
            Documents with biological embeddings
        """
        if text_fields is None:
            text_fields = ["title", "description", "abstract", "function"]
        
        # Enhanced text extraction for biological documents
        texts = []
        for doc in documents:
            text_parts = []
            
            # Standard text fields
            for field in text_fields:
                if field in doc and doc[field]:
                    text = self.preprocess_biological_text(str(doc[field]))
                    text_parts.append(text)
            
            # Add biological metadata if requested
            if include_metadata:
                metadata_text = self._extract_biological_metadata(doc)
                if metadata_text:
                    text_parts.append(metadata_text)
            
            combined_text = " ".join(text_parts) if text_parts else ""
            texts.append(combined_text)
        
        # Generate embeddings using parent class
        embeddings = await self.encode(texts)
        
        # Add embeddings and metadata to documents
        result_documents = []
        for i, doc in enumerate(documents):
            doc_with_embedding = doc.copy()
            doc_with_embedding["embedding"] = embeddings[i].tolist()
            doc_with_embedding["embedding_text"] = texts[i]
            doc_with_embedding["bio_processed"] = True
            result_documents.append(doc_with_embedding)
        
        return result_documents
    
    def _extract_biological_metadata(self, doc: Dict[str, Any]) -> str:
        """Extract biological metadata for inclusion in embeddings."""
        metadata_parts = []
        
        # Organism information
        if "organism" in doc:
            metadata_parts.append(f"organism {doc['organism']}")
        
        # Gene names
        if "gene_names" in doc and doc["gene_names"]:
            genes = " ".join(doc["gene_names"]) if isinstance(doc["gene_names"], list) else str(doc["gene_names"])
            metadata_parts.append(f"genes {genes}")
        
        # MeSH terms
        if "mesh_terms" in doc and doc["mesh_terms"]:
            mesh = " ".join(doc["mesh_terms"]) if isinstance(doc["mesh_terms"], list) else str(doc["mesh_terms"])
            metadata_parts.append(f"mesh terms {mesh}")
        
        # Keywords
        if "keywords" in doc and doc["keywords"]:
            keywords = " ".join(doc["keywords"]) if isinstance(doc["keywords"], list) else str(doc["keywords"])
            metadata_parts.append(f"keywords {keywords}")
        
        # GO terms
        if "go_terms" in doc and doc["go_terms"]:
            if isinstance(doc["go_terms"], list):
                go_text = " ".join([
                    term.get("term", "") if isinstance(term, dict) else str(term)
                    for term in doc["go_terms"]
                ])
                metadata_parts.append(f"gene ontology {go_text}")
        
        # Diseases
        if "associated_diseases" in doc and doc["associated_diseases"]:
            diseases = " ".join(doc["associated_diseases"]) if isinstance(doc["associated_diseases"], list) else str(doc["associated_diseases"])
            metadata_parts.append(f"diseases {diseases}")
        
        # Experimental type (for datasets)
        if "experiment_type" in doc:
            metadata_parts.append(f"experiment {doc['experiment_type']}")
        
        return " ".join(metadata_parts)
    
    async def search_biological_context(
        self, 
        query: str,
        documents: List[Dict[str, Any]],
        context_type: Optional[str] = None,
        top_k: int = 10
    ) -> List[Dict[str, Any]]:
        """Search documents with biological context awareness.
        
        Args:
            query: Search query
            documents: Documents to search
            context_type: Type of biological context (gene, disease, protein, etc.)
            top_k: Number of results to return
            
        Returns:
            Contextually relevant documents
        """
        # Preprocess query with biological context
        processed_query = self.preprocess_biological_text(query)
        
        # Add context-specific terms if specified
        if context_type:
            context_terms = {
                "gene": "gene expression transcription regulation",
                "protein": "protein structure function interaction",
                "disease": "disease pathology clinical symptoms",
                "pathway": "biological pathway signaling cascade",
                "drug": "drug therapy treatment pharmacology",
                "metabolism": "metabolic pathway enzyme reaction"
            }
            
            if context_type.lower() in context_terms:
                processed_query += f" {context_terms[context_type.lower()]}"
        
        # Use parent class method with processed query
        return await self.find_similar_documents(processed_query, documents, top_k) 