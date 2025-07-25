"""Data validation utilities for biological data."""

import re
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime


class DataValidator:
    """Validator for biological data and documents."""
    
    def __init__(self):
        """Initialize data validator."""
        # Required fields for different document types
        self.required_fields = {
            "article": ["title", "source"],
            "dataset": ["title", "source"],
            "protein": ["id", "source"],
            "gene": ["id", "source"]
        }
        
        # Valid source types
        self.valid_sources = {
            "PubMed", "GEO", "UniProt", "NCBI", "Ensembl", 
            "STRING", "KEGG", "Reactome", "GO", "ChEMBL"
        }
        
        # Patterns for biological identifiers
        self.id_patterns = {
            "pmid": re.compile(r'^\d{1,10}$'),
            "geo_series": re.compile(r'^GSE\d+$'),
            "geo_dataset": re.compile(r'^GDS\d+$'),
            "geo_platform": re.compile(r'^GPL\d+$'),
            "uniprot": re.compile(r'^[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$'),
            "ensembl_gene": re.compile(r'^ENS[A-Z]*G\d{11}$'),
            "ensembl_transcript": re.compile(r'^ENS[A-Z]*T\d{11}$'),
            "gene_symbol": re.compile(r'^[A-Z][A-Z0-9]*$'),
            "doi": re.compile(r'^10\.\d{4,}/[-._;()/:\w\[\]]+$')
        }
    
    def validate_document(self, document: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """Validate a biological document.
        
        Args:
            document: Document to validate
            
        Returns:
            Tuple of (is_valid, error_messages)
        """
        errors = []
        
        # Check basic structure
        if not isinstance(document, dict):
            return False, ["Document must be a dictionary"]
        
        # Check document type
        doc_type = document.get("type", "article")
        if doc_type not in self.required_fields:
            errors.append(f"Unknown document type: {doc_type}")
        
        # Check required fields
        required = self.required_fields.get(doc_type, [])
        for field in required:
            if field not in document or not document[field]:
                errors.append(f"Missing required field: {field}")
        
        # Validate source
        source = document.get("source")
        if source and source not in self.valid_sources:
            errors.append(f"Invalid source: {source}. Valid sources: {', '.join(self.valid_sources)}")
        
        # Validate specific fields
        errors.extend(self._validate_specific_fields(document))
        
        # Check data types
        errors.extend(self._validate_data_types(document))
        
        return len(errors) == 0, errors
    
    def _validate_specific_fields(self, document: Dict[str, Any]) -> List[str]:
        """Validate specific biological fields."""
        errors = []
        
        # Validate IDs based on source
        source = document.get("source", "").lower()
        doc_id = document.get("id", "")
        
        if source == "pubmed" and doc_id:
            if not self.id_patterns["pmid"].match(str(doc_id)):
                errors.append(f"Invalid PubMed ID format: {doc_id}")
        
        elif source == "geo" and doc_id:
            if not any(pattern.match(doc_id) for pattern in [
                self.id_patterns["geo_series"],
                self.id_patterns["geo_dataset"],
                self.id_patterns["geo_platform"]
            ]):
                errors.append(f"Invalid GEO ID format: {doc_id}")
        
        elif source == "uniprot" and doc_id:
            if not self.id_patterns["uniprot"].match(doc_id):
                errors.append(f"Invalid UniProt ID format: {doc_id}")
        
        # Validate DOI if present
        doi = document.get("doi")
        if doi and not self.id_patterns["doi"].match(doi):
            errors.append(f"Invalid DOI format: {doi}")
        
        # Validate gene names
        gene_names = document.get("gene_names")
        if gene_names:
            if isinstance(gene_names, str):
                gene_names = [gene_names]
            elif not isinstance(gene_names, list):
                errors.append("gene_names must be a string or list of strings")
            else:
                for gene in gene_names:
                    if not isinstance(gene, str) or not gene.strip():
                        errors.append(f"Invalid gene name: {gene}")
        
        # Validate organism
        organism = document.get("organism")
        if organism and not isinstance(organism, str):
            errors.append("organism must be a string")
        
        # Validate publication date
        pub_date = document.get("publication_date")
        if pub_date:
            if not self._validate_date(pub_date):
                errors.append(f"Invalid publication date format: {pub_date}")
        
        return errors
    
    def _validate_data_types(self, document: Dict[str, Any]) -> List[str]:
        """Validate data types of document fields."""
        errors = []
        
        # String fields
        string_fields = ["title", "description", "abstract", "function", "organism", "journal"]
        for field in string_fields:
            if field in document and document[field] is not None:
                if not isinstance(document[field], str):
                    errors.append(f"{field} must be a string")
        
        # List fields
        list_fields = ["authors", "keywords", "mesh_terms", "gene_names", "go_terms"]
        for field in list_fields:
            if field in document and document[field] is not None:
                if not isinstance(document[field], list):
                    errors.append(f"{field} must be a list")
        
        # Numeric fields
        numeric_fields = ["year", "length", "sample_count"]
        for field in numeric_fields:
            if field in document and document[field] is not None:
                try:
                    float(document[field])
                except (ValueError, TypeError):
                    errors.append(f"{field} must be numeric")
        
        return errors
    
    def _validate_date(self, date_str: str) -> bool:
        """Validate date string."""
        if not isinstance(date_str, str):
            return False
        
        # Try common date formats
        date_formats = [
            "%Y-%m-%d",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%dT%H:%M:%S.%f",
            "%Y-%m-%dT%H:%M:%SZ",
            "%Y",
            "%Y-%m"
        ]
        
        for fmt in date_formats:
            try:
                datetime.strptime(date_str, fmt)
                return True
            except ValueError:
                continue
        
        return False
    
    def validate_query(self, query: str) -> Tuple[bool, List[str]]:
        """Validate a search query.
        
        Args:
            query: Search query string
            
        Returns:
            Tuple of (is_valid, error_messages)
        """
        errors = []
        
        if not query or not isinstance(query, str):
            errors.append("Query must be a non-empty string")
            return False, errors
        
        query = query.strip()
        
        if len(query) < 3:
            errors.append("Query must be at least 3 characters long")
        
        if len(query) > 1000:
            errors.append("Query must be less than 1000 characters")
        
        # Check for potentially malicious content
        suspicious_patterns = [
            r'<script',
            r'javascript:',
            r'on\w+\s*=',
            r'eval\s*\(',
            r'exec\s*\('
        ]
        
        for pattern in suspicious_patterns:
            if re.search(pattern, query, re.IGNORECASE):
                errors.append("Query contains suspicious content")
                break
        
        return len(errors) == 0, errors
    
    def validate_embedding(self, embedding: List[float]) -> Tuple[bool, List[str]]:
        """Validate an embedding vector.
        
        Args:
            embedding: Embedding vector
            
        Returns:
            Tuple of (is_valid, error_messages)
        """
        errors = []
        
        if not isinstance(embedding, list):
            errors.append("Embedding must be a list")
            return False, errors
        
        if len(embedding) == 0:
            errors.append("Embedding cannot be empty")
            return False, errors
        
        # Check if all elements are numbers
        for i, value in enumerate(embedding):
            if not isinstance(value, (int, float)):
                errors.append(f"Embedding element at index {i} must be a number")
                break
        
        # Check for NaN or infinite values
        try:
            import math
            for i, value in enumerate(embedding):
                if math.isnan(value) or math.isinf(value):
                    errors.append(f"Embedding contains invalid value at index {i}: {value}")
                    break
        except Exception:
            pass
        
        return len(errors) == 0, errors
    
    def sanitize_document(self, document: Dict[str, Any]) -> Dict[str, Any]:
        """Sanitize a document by cleaning and validating fields.
        
        Args:
            document: Document to sanitize
            
        Returns:
            Sanitized document
        """
        sanitized = {}
        
        for key, value in document.items():
            # Skip None values
            if value is None:
                continue
            
            # Clean string values
            if isinstance(value, str):
                value = value.strip()
                if not value:  # Skip empty strings
                    continue
            
            # Clean list values
            elif isinstance(value, list):
                if key in ["authors", "keywords", "mesh_terms", "gene_names"]:
                    # Clean string lists
                    value = [str(item).strip() for item in value if item]
                    value = [item for item in value if item]  # Remove empty strings
                    if not value:  # Skip empty lists
                        continue
            
            sanitized[key] = value
        
        return sanitized
    
    def validate_batch_documents(
        self, 
        documents: List[Dict[str, Any]]
    ) -> Tuple[List[Dict[str, Any]], List[Tuple[int, List[str]]]]:
        """Validate a batch of documents.
        
        Args:
            documents: List of documents to validate
            
        Returns:
            Tuple of (valid_documents, errors_by_index)
        """
        valid_documents = []
        errors_by_index = []
        
        for i, document in enumerate(documents):
            is_valid, errors = self.validate_document(document)
            
            if is_valid:
                sanitized = self.sanitize_document(document)
                valid_documents.append(sanitized)
            else:
                errors_by_index.append((i, errors))
        
        return valid_documents, errors_by_index 