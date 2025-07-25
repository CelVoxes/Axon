"""Text processing utilities for biological data."""

import re
from typing import List, Dict, Any, Optional
from dataclasses import dataclass


@dataclass
class ProcessedText:
    """Processed text with metadata."""
    original: str
    cleaned: str
    sentences: List[str]
    chunks: List[str]
    metadata: Dict[str, Any]


class TextProcessor:
    """Text processing utilities for biological documents."""
    
    def __init__(self):
        """Initialize text processor."""
        # Patterns for cleaning
        self.citation_pattern = re.compile(r'\[\d+(?:,\s*\d+)*\]')
        self.email_pattern = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b')
        self.url_pattern = re.compile(r'http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+')
        self.excessive_whitespace = re.compile(r'\s+')
        
        # Biological abbreviation patterns
        self.bio_abbreviations = {
            'DNA': 'deoxyribonucleic acid',
            'RNA': 'ribonucleic acid',
            'mRNA': 'messenger RNA',
            'miRNA': 'microRNA',
            'siRNA': 'small interfering RNA',
            'PCR': 'polymerase chain reaction',
            'qPCR': 'quantitative PCR',
            'RT-PCR': 'reverse transcription PCR',
            'NGS': 'next generation sequencing',
            'WGS': 'whole genome sequencing',
            'RNA-seq': 'RNA sequencing',
            'ChIP-seq': 'chromatin immunoprecipitation sequencing',
            'GWAS': 'genome wide association study',
            'SNP': 'single nucleotide polymorphism',
            'CNV': 'copy number variation',
            'eQTL': 'expression quantitative trait locus',
            'GO': 'gene ontology',
            'KEGG': 'kyoto encyclopedia genes genomes'
        }
    
    def clean_text(self, text: str) -> str:
        """Clean text by removing unwanted elements.
        
        Args:
            text: Input text
            
        Returns:
            Cleaned text
        """
        if not text:
            return ""
        
        # Remove citations [1], [1,2,3], etc.
        text = self.citation_pattern.sub('', text)
        
        # Remove emails and URLs
        text = self.email_pattern.sub('', text)
        text = self.url_pattern.sub('', text)
        
        # Remove excessive whitespace
        text = self.excessive_whitespace.sub(' ', text)
        
        # Remove special characters but keep biological notation
        text = re.sub(r'[^\w\s\-\(\)\/\.\,\:\;]', ' ', text)
        
        return text.strip()
    
    def expand_abbreviations(self, text: str) -> str:
        """Expand biological abbreviations.
        
        Args:
            text: Input text
            
        Returns:
            Text with expanded abbreviations
        """
        for abbr, expansion in self.bio_abbreviations.items():
            # Use word boundaries to avoid partial matches
            pattern = rf'\b{re.escape(abbr)}\b'
            text = re.sub(pattern, f'{abbr} ({expansion})', text, flags=re.IGNORECASE)
        
        return text
    
    def split_sentences(self, text: str) -> List[str]:
        """Split text into sentences.
        
        Args:
            text: Input text
            
        Returns:
            List of sentences
        """
        # Simple sentence splitting on periods, exclamation marks, and question marks
        # while avoiding splitting on abbreviations
        sentences = re.split(r'(?<!\b[A-Z][a-z]\.)\s*[.!?]+\s*', text)
        
        # Clean and filter sentences
        sentences = [s.strip() for s in sentences if s.strip()]
        
        return sentences
    
    def chunk_text(
        self, 
        text: str, 
        chunk_size: int = 500, 
        overlap: int = 50,
        by_sentences: bool = True
    ) -> List[str]:
        """Split text into chunks for processing.
        
        Args:
            text: Input text
            chunk_size: Maximum characters per chunk
            overlap: Character overlap between chunks
            by_sentences: Whether to split by sentences for better coherence
            
        Returns:
            List of text chunks
        """
        if not text:
            return []
        
        if by_sentences:
            return self._chunk_by_sentences(text, chunk_size, overlap)
        else:
            return self._chunk_by_characters(text, chunk_size, overlap)
    
    def _chunk_by_sentences(self, text: str, chunk_size: int, overlap: int) -> List[str]:
        """Chunk text by sentences."""
        sentences = self.split_sentences(text)
        if not sentences:
            return []
        
        chunks = []
        current_chunk = ""
        
        for sentence in sentences:
            # If adding this sentence would exceed chunk size, start a new chunk
            if current_chunk and len(current_chunk) + len(sentence) > chunk_size:
                chunks.append(current_chunk.strip())
                
                # Start new chunk with overlap
                if overlap > 0:
                    words = current_chunk.split()
                    overlap_words = words[-overlap:]
                    current_chunk = " ".join(overlap_words) + " " + sentence
                else:
                    current_chunk = sentence
            else:
                current_chunk += " " + sentence if current_chunk else sentence
        
        # Add the last chunk
        if current_chunk.strip():
            chunks.append(current_chunk.strip())
        
        return chunks
    
    def _chunk_by_characters(self, text: str, chunk_size: int, overlap: int) -> List[str]:
        """Chunk text by character count."""
        chunks = []
        start = 0
        
        while start < len(text):
            end = start + chunk_size
            
            # Try to break at word boundary
            if end < len(text):
                # Look for the nearest space before the end
                while end > start and text[end] != ' ':
                    end -= 1
                
                # If no space found, use the original end
                if end == start:
                    end = start + chunk_size
            
            chunk = text[start:end].strip()
            if chunk:
                chunks.append(chunk)
            
            start = end - overlap if overlap > 0 else end
        
        return chunks
    
    def extract_biological_entities(self, text: str) -> Dict[str, List[str]]:
        """Extract biological entities from text.
        
        Args:
            text: Input text
            
        Returns:
            Dictionary of extracted entities
        """
        entities = {
            "genes": [],
            "proteins": [],
            "diseases": [],
            "organisms": [],
            "chemicals": []
        }
        
        # Gene patterns (simple heuristics)
        gene_patterns = [
            r'\b[A-Z][A-Z0-9]{2,}[0-9]*\b',  # Gene symbols like TP53, BRCA1
            r'\b(?:gene|genes?)\s+([A-Z][A-Z0-9]+)\b'
        ]
        
        for pattern in gene_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            entities["genes"].extend(matches)
        
        # Protein patterns
        protein_patterns = [
            r'\b([A-Z][a-z]+(?:ase|oma|ine|one|ide))\b',  # Enzyme endings
            r'\bprotein\s+([A-Z][a-z0-9]+(?:-[A-Z0-9]+)*)\b'
        ]
        
        for pattern in protein_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            entities["proteins"].extend(matches)
        
        # Disease patterns
        disease_patterns = [
            r'\b([A-Z][a-z]+\s+(?:cancer|carcinoma|tumor|disease|syndrome|disorder))\b',
            r'\b(cancer|carcinoma|tumor|lymphoma|leukemia|sarcoma)\b'
        ]
        
        for pattern in disease_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            entities["diseases"].extend(matches)
        
        # Organism patterns
        organism_patterns = [
            r'\b(Homo sapiens|human|mouse|rat|Mus musculus|Rattus norvegicus)\b',
            r'\b([A-Z][a-z]+ [a-z]+)\b(?=\s+(?:strain|cell|tissue))'
        ]
        
        for pattern in organism_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            entities["organisms"].extend(matches)
        
        # Clean up entities (remove duplicates, empty strings)
        for entity_type in entities:
            entities[entity_type] = list(set([
                e.strip() for e in entities[entity_type] 
                if e and e.strip()
            ]))
        
        return entities
    
    def process_document(
        self, 
        document: Dict[str, Any],
        text_fields: List[str] = None,
        chunk_size: int = 500,
        expand_abbr: bool = True
    ) -> ProcessedText:
        """Process a biological document.
        
        Args:
            document: Document dictionary
            text_fields: Fields to process (default: title, description, abstract)
            chunk_size: Size for text chunking
            expand_abbr: Whether to expand abbreviations
            
        Returns:
            Processed text object
        """
        if text_fields is None:
            text_fields = ["title", "description", "abstract", "function"]
        
        # Extract text from document
        text_parts = []
        for field in text_fields:
            if field in document and document[field]:
                text_parts.append(str(document[field]))
        
        original_text = " ".join(text_parts)
        
        # Clean text
        cleaned_text = self.clean_text(original_text)
        
        # Expand abbreviations if requested
        if expand_abbr:
            cleaned_text = self.expand_abbreviations(cleaned_text)
        
        # Split into sentences
        sentences = self.split_sentences(cleaned_text)
        
        # Create chunks
        chunks = self.chunk_text(cleaned_text, chunk_size=chunk_size)
        
        # Extract entities
        entities = self.extract_biological_entities(cleaned_text)
        
        # Create metadata
        metadata = {
            "original_length": len(original_text),
            "cleaned_length": len(cleaned_text),
            "sentence_count": len(sentences),
            "chunk_count": len(chunks),
            "entities": entities,
            "source_fields": text_fields
        }
        
        return ProcessedText(
            original=original_text,
            cleaned=cleaned_text,
            sentences=sentences,
            chunks=chunks,
            metadata=metadata
        ) 