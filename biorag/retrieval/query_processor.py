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
        enhanced_query = query
        
        # Add context-specific terms
        if context_type:
            context_terms = {
                "gene": "gene expression transcription regulation",
                "protein": "protein structure function interaction",
                "disease": "disease pathology clinical symptoms",
                "pathway": "biological pathway signaling cascade",
                "drug": "drug therapy treatment pharmacology",
                "metabolism": "metabolic pathway enzyme reaction"
            }
            
            if context_type in context_terms:
                enhanced_query += f" {context_terms[context_type]}"
        
        # Add entity synonyms and related terms
        if entities["genes"]:
            for gene in entities["genes"]:
                enhanced_query += f" {gene} gene expression"
        
        if entities["diseases"]:
            for disease in entities["diseases"]:
                enhanced_query += f" {disease} pathology"
        
        return enhanced_query
    
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