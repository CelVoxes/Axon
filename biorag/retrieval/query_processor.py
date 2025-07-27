"""Query processor for biological queries."""

import re
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass


@dataclass
class ProcessedQuery:
    """Processed query with biological context."""
    original_query: str
    processed_query: str
    entities: Dict[str, List[str]]
    context_type: Optional[str]
    filters: Dict[str, Any]
    search_strategy: str


class QueryProcessor:
    """Processor for biological queries with entity extraction and context detection."""
    
    def __init__(self):
        """Initialize query processor."""
        # Biological entity patterns
        self.gene_patterns = [
            re.compile(r'\b[A-Z][A-Z0-9]{3,}[0-9]*\b'),  # Gene symbols (e.g., TP53, BRCA1) - increased minimum length to avoid AML
            re.compile(r'\b(?:gene|genes?)\s+([A-Z][A-Z0-9]+)\b', re.IGNORECASE),
        ]
        
        self.protein_patterns = [
            re.compile(r'\bprotein\s+([A-Z][a-z0-9]+(?:-[A-Z0-9]+)*)\b', re.IGNORECASE),
            re.compile(r'\b([A-Z][a-z]+(?:ase|oma|ine|one|ide))\b'),  # Protein family endings
        ]
        
        self.disease_patterns = [
            re.compile(r'\b([A-Z][a-z]+\s+(?:cancer|carcinoma|tumor|disease|syndrome|disorder))\b', re.IGNORECASE),
            re.compile(r'\b(cancer|carcinoma|tumor|disease|syndrome|disorder)\b', re.IGNORECASE),
            re.compile(r'\b(AML|CML|ALL|CLL)\b'),  # Leukemia abbreviations
            re.compile(r'\b(acute myeloid leukemia|chronic myeloid leukemia|acute lymphoblastic leukemia)\b', re.IGNORECASE),
            re.compile(r'\b([A-Z]{2,5})\s+(?:leukemia|lymphoma|sarcoma)\b', re.IGNORECASE),
        ]
        
        self.organism_patterns = [
            re.compile(r'\b(Homo sapiens|human|mouse|rat|Mus musculus|Rattus norvegicus)\b', re.IGNORECASE),
        ]
        
        self.pathway_patterns = [
            re.compile(r'\b([A-Z][a-z]+\s+(?:pathway|signaling|cascade))\b', re.IGNORECASE),
            re.compile(r'\b(pathway|signaling|cascade)\b', re.IGNORECASE),
        ]
        
        # Context keywords
        self.context_keywords = {
            "gene": ["gene", "expression", "transcription", "regulation", "promoter"],
            "protein": ["protein", "enzyme", "structure", "function", "interaction"],
            "disease": ["disease", "pathology", "clinical", "symptoms", "diagnosis"],
            "pathway": ["pathway", "signaling", "cascade", "network", "regulation"],
            "drug": ["drug", "therapy", "treatment", "pharmaceutical", "compound"],
            "metabolism": ["metabolism", "metabolic", "enzyme", "reaction", "biosynthesis"],
            "genetics": ["genetics", "genomic", "mutation", "variant", "polymorphism"],
            "dataset": ["dataset", "data", "study", "experiment", "analysis"]
        }
    
    async def process_query(self, query: str) -> ProcessedQuery:
        """Process a biological query.
        
        Args:
            query: Raw query string
            
        Returns:
            Processed query with extracted entities and context
        """
        # Extract biological entities
        entities = self._extract_entities(query)
        
        # Determine context type
        context_type = self._determine_context(query, entities)
        
        # Generate filters based on entities
        filters = self._generate_filters(entities)
        
        # Process and enhance the query
        processed_query = self._enhance_query(query, entities, context_type)
        
        # Determine search strategy
        search_strategy = self._determine_strategy(query, entities, context_type)
        
        return ProcessedQuery(
            original_query=query,
            processed_query=processed_query,
            entities=entities,
            context_type=context_type,
            filters=filters,
            search_strategy=search_strategy
        )
    
    def _extract_entities(self, query: str) -> Dict[str, List[str]]:
        """Extract biological entities from query."""
        entities = {
            "genes": [],
            "proteins": [],
            "diseases": [],
            "organisms": [],
            "pathways": []
        }
        
        # Extract genes
        for pattern in self.gene_patterns:
            matches = pattern.findall(query)
            if isinstance(matches[0] if matches else None, tuple):
                matches = [match[0] if match else match for match in matches]
            entities["genes"].extend(matches)
        
        # Extract proteins
        for pattern in self.protein_patterns:
            matches = pattern.findall(query)
            if isinstance(matches[0] if matches else None, tuple):
                matches = [match[0] if match else match for match in matches]
            entities["proteins"].extend(matches)
        
        # Extract diseases
        for pattern in self.disease_patterns:
            matches = pattern.findall(query)
            entities["diseases"].extend(matches)
        
        # Extract organisms
        for pattern in self.organism_patterns:
            matches = pattern.findall(query)
            entities["organisms"].extend(matches)
        
        # Extract pathways
        for pattern in self.pathway_patterns:
            matches = pattern.findall(query)
            entities["pathways"].extend(matches)
        
        # Remove duplicates and clean
        for entity_type in entities:
            entities[entity_type] = list(set(entities[entity_type]))
            entities[entity_type] = [e.strip() for e in entities[entity_type] if e.strip()]
        
        # Filter out LLM-specific terms that might have been incorrectly extracted
        llm_terms_to_filter = {
            "WORKING", "DIRECTORY", "DATASETS", "IMPORTANT", "ONLY", "REAL", 
            "DOWNLOADED", "NUMBER", "QUESTION", "STEP", "RESEARCH", "UNDERSTANDING",
            "OUTPUTS", "S", "as", "for", "in", "the", "and", "or", "with", "using"
        }
        
        for entity_type in entities:
            entities[entity_type] = [
                entity for entity in entities[entity_type] 
                if entity.lower() not in llm_terms_to_filter and len(entity) > 1
            ]
        
        return entities
    
    def _determine_context(self, query: str, entities: Dict[str, List[str]]) -> Optional[str]:
        """Determine the biological context of the query."""
        query_lower = query.lower()
        
        # Score different contexts based on keywords and entities
        context_scores = {}
        
        for context, keywords in self.context_keywords.items():
            score = 0
            # Score based on keywords
            for keyword in keywords:
                score += query_lower.count(keyword.lower())
            
            # Score based on entities
            if context == "gene" and entities["genes"]:
                score += len(entities["genes"]) * 2
            elif context == "protein" and entities["proteins"]:
                score += len(entities["proteins"]) * 2
            elif context == "disease" and entities["diseases"]:
                score += len(entities["diseases"]) * 2
            elif context == "pathway" and entities["pathways"]:
                score += len(entities["pathways"]) * 2
            
            context_scores[context] = score
        
        # Return context with highest score if above threshold
        if context_scores:
            best_context = max(context_scores, key=context_scores.get)
            if context_scores[best_context] > 0:
                return best_context
        
        return None
    
    def _generate_filters(self, entities: Dict[str, List[str]]) -> Dict[str, Any]:
        """Generate metadata filters based on extracted entities."""
        filters = {}
        
        # Organism filters
        if entities["organisms"]:
            # Map common names to scientific names
            organism_mapping = {
                "human": "Homo sapiens",
                "mouse": "Mus musculus",
                "rat": "Rattus norvegicus"
            }
            
            organisms = []
            for org in entities["organisms"]:
                mapped = organism_mapping.get(org.lower(), org)
                organisms.append(mapped)
            
            if len(organisms) == 1:
                filters["organism"] = organisms[0]
            elif len(organisms) > 1:
                filters["organism"] = {"$in": organisms}
        
        return filters
    
    def _enhance_query(
        self, 
        query: str, 
        entities: Dict[str, List[str]], 
        context_type: Optional[str]
    ) -> str:
        """Enhance query with biological context and synonyms."""
        # Clean up LLM prompts that might be passed as queries
        cleaned_query = self._clean_llm_prompt(query)
        
        # Start with cleaned query
        enhanced_query = cleaned_query
        
        # Add context-specific terms (but be more conservative)
        if context_type:
            context_terms = {
                "gene": "gene expression",
                "protein": "protein function",
                "disease": "disease pathology",
                "pathway": "biological pathway",
                "drug": "drug therapy",
                "metabolism": "metabolic pathway"
            }
            
            if context_type in context_terms:
                # Only add if not already present
                context_term = context_terms[context_type]
                if context_term not in enhanced_query.lower():
                    enhanced_query += f" {context_term}"
        
        # Add entity synonyms and related terms (but avoid repetition)
        if entities["genes"]:
            for gene in entities["genes"]:
                # Only add if not already present
                if f"{gene} gene" not in enhanced_query and f"{gene} expression" not in enhanced_query:
                    enhanced_query += f" {gene}"
        
        if entities["diseases"]:
            for disease in entities["diseases"]:
                # Only add if not already present
                if disease not in enhanced_query:
                    enhanced_query += f" {disease}"
        
        # Clean up any excessive whitespace
        enhanced_query = " ".join(enhanced_query.split())
        
        # Remove any remaining LLM-specific terms that might have slipped through
        llm_terms_to_remove = [
            "WORKING", "DIRECTORY", "DATASETS", "IMPORTANT", "ONLY", "REAL", 
            "DOWNLOADED", "NUMBER", "QUESTION", "STEP", "RESEARCH"
        ]
        for term in llm_terms_to_remove:
            enhanced_query = enhanced_query.replace(term, "").replace(term.lower(), "")
        
        # Clean up whitespace again after removing terms
        enhanced_query = " ".join(enhanced_query.split())
        
        # Limit query length to prevent API issues
        if len(enhanced_query) > 200:
            # Take first few meaningful terms
            terms = enhanced_query.split()[:10]
            enhanced_query = " ".join(terms)
        
        return enhanced_query
    
    def _clean_llm_prompt(self, query: str) -> str:
        """Clean up LLM prompts to extract only relevant search terms."""
        # First, check if query contains specific GEO dataset IDs
        gse_matches = re.findall(r'GSE\d+', query)
        if gse_matches:
            # If specific datasets are mentioned, extract biological context
            biological_terms = self._extract_biological_terms(query)
            
            # Return biological context + dataset IDs
            if biological_terms:
                return f"{' '.join(biological_terms)} {' '.join(gse_matches)}"
            else:
                return " ".join(gse_matches)
        
        # Check if this looks like an LLM prompt with various patterns
        llm_indicators = [
            "You are an expert bioinformatics programmer",
            "RESEARCH_QUESTION",
            "STEP",
            "WORKING",
            "DIRECTORY",
            "DATASETS",
            "IMPORTANT",
            "ONLY",
            "REAL",
            "DOWNLOADED",
            "NUMBER",
            "QUESTION"
        ]
        
        is_llm_prompt = any(indicator in query for indicator in llm_indicators)
        
        if is_llm_prompt:
            # Look for RESEARCH_QUESTION pattern first
            research_match = re.search(r'RESEARCH_QUESTION[:\s]*["\']([^"\']+)["\']', query)
            if research_match:
                return research_match.group(1).strip()
            
            # Look for STEP pattern that might contain the actual question
            step_match = re.search(r'STEP[:\s]*["\']([^"\']+)["\']', query)
            if step_match:
                step_content = step_match.group(1)
                # Extract biological terms from the step
                biological_terms = self._extract_biological_terms(step_content)
                if biological_terms:
                    return " ".join(biological_terms)
            
            # Fallback: extract any biological terms and remove LLM-specific terms
            biological_terms = self._extract_biological_terms(query)
            if biological_terms:
                return " ".join(biological_terms)
            
            # Last resort: return a minimal search term
            return "gene expression analysis"
        
        # If it's not an LLM prompt, still clean any LLM-specific terms that might be present
        llm_terms_to_remove = [
            "WORKING", "DIRECTORY", "DATASETS", "IMPORTANT", "ONLY", "REAL", 
            "DOWNLOADED", "NUMBER", "QUESTION", "STEP", "RESEARCH", "UNDERSTANDING",
            "OUTPUTS", "S", "as", "for", "in", "the", "and", "or", "with", "using"
        ]
        
        cleaned_query = query
        for term in llm_terms_to_remove:
            # Remove the term with surrounding whitespace
            cleaned_query = re.sub(r'\b' + re.escape(term) + r'\b', '', cleaned_query, flags=re.IGNORECASE)
        
        # Clean up whitespace
        cleaned_query = " ".join(cleaned_query.split())
        
        return cleaned_query
    
    def _extract_biological_terms(self, text: str) -> List[str]:
        """Extract biological terms from text."""
        biological_keywords = [
            # Diseases and conditions
            "B-ALL", "leukemia", "cancer", "tumor", "carcinoma", "sarcoma", "lymphoma",
            "AML", "CML", "ALL", "CLL", "breast cancer", "lung cancer", "colon cancer",
            "melanoma", "glioblastoma", "pancreatic cancer", "ovarian cancer",
            
            # Biological processes
            "transcriptional", "transcription", "gene expression", "differential expression",
            "pathway", "signaling", "metabolism", "apoptosis", "proliferation",
            "differentiation", "migration", "invasion", "angiogenesis",
            
            # Analysis types
            "subtypes", "clustering", "classification", "biomarker", "signature",
            "microarray", "RNA-seq", "single-cell", "bulk RNA-seq", "scRNA-seq",
            "differential", "enrichment", "pathway analysis", "gene ontology",
            
            # Organisms
            "human", "mouse", "rat", "Homo sapiens", "Mus musculus", "Rattus norvegicus",
            
            # Cell types
            "epithelial", "mesenchymal", "stromal", "immune", "T-cell", "B-cell",
            "macrophage", "neutrophil", "fibroblast", "endothelial",
            
            # Genes and proteins (common ones)
            "TP53", "BRCA1", "BRCA2", "EGFR", "HER2", "KRAS", "BRAF", "PIK3CA",
            "MYC", "BCL2", "CDKN2A", "PTEN", "APC", "VHL", "RB1"
        ]
        
        found_terms = []
        text_lower = text.lower()
        
        for keyword in biological_keywords:
            if keyword.lower() in text_lower:
                found_terms.append(keyword)
        
        # Remove duplicates while preserving order
        seen = set()
        unique_terms = []
        for term in found_terms:
            if term.lower() not in seen:
                seen.add(term.lower())
                unique_terms.append(term)
        
        return unique_terms
    
    def _determine_strategy(
        self, 
        query: str, 
        entities: Dict[str, List[str]], 
        context_type: Optional[str]
    ) -> str:
        """Determine the best search strategy."""
        # Check for specific entity queries
        if len(entities["genes"]) == 1 and not any(entities[k] for k in entities if k != "genes"):
            return "gene_specific"
        
        if len(entities["diseases"]) == 1 and not any(entities[k] for k in entities if k != "diseases"):
            return "disease_specific"
        
        if len(entities["proteins"]) == 1 and not any(entities[k] for k in entities if k != "proteins"):
            return "protein_specific"
        
        # Check for multi-entity queries
        entity_count = sum(len(entities[k]) for k in entities)
        if entity_count > 3:
            return "multi_entity"
        
        # Check for broad context queries
        if context_type and len(query.split()) > 10:
            return "broad_context"
        
        # Default strategy
        return "general_search"
    
    def get_search_parameters(self, processed_query: ProcessedQuery) -> Dict[str, Any]:
        """Get search parameters based on processed query.
        
        Args:
            processed_query: Processed query object
            
        Returns:
            Search parameters dictionary
        """
        params = {
            "query": processed_query.processed_query,
            "filters": processed_query.filters,
            "context_type": processed_query.context_type
        }
        
        # Strategy-specific parameters
        if processed_query.search_strategy == "gene_specific":
            params["limit"] = 15
            params["source_types"] = ["GEO", "PubMed", "UniProt"]
        
        elif processed_query.search_strategy == "disease_specific":
            params["limit"] = 12
            params["source_types"] = ["PubMed", "GEO"]
        
        elif processed_query.search_strategy == "protein_specific":
            params["limit"] = 10
            params["source_types"] = ["UniProt", "PubMed"]
        
        elif processed_query.search_strategy == "multi_entity":
            params["limit"] = 20
            params["retrieve_from_sources"] = True
        
        elif processed_query.search_strategy == "broad_context":
            params["limit"] = 25
            params["retrieve_from_sources"] = True
        
        else:  # general_search
            params["limit"] = 10
        
        return params 