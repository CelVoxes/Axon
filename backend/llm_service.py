"""General-purpose LLM service for various tasks including search, code generation, and tool calling."""

import os
import asyncio
import json
from typing import List, Optional, Dict, Any, Union
from abc import ABC, abstractmethod
import openai
from openai import AsyncOpenAI


class LLMProvider(ABC):
    """Abstract base class for LLM providers."""
    
    @abstractmethod
    async def generate(self, messages: List[Dict[str, str]], **kwargs) -> str:
        """Generate response from messages."""
        pass


class OpenAIProvider(LLMProvider):
    """OpenAI provider implementation."""
    
    def __init__(self, api_key: str, model: str = "gpt-4o-mini"):
        self.client = AsyncOpenAI(api_key=api_key)
        self.model = model
    
    async def generate(self, messages: List[Dict[str, str]], **kwargs) -> str:
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            **kwargs
        )
        return response.choices[0].message.content.strip()


class AnthropicProvider(LLMProvider):
    """Anthropic provider implementation."""
    
    def __init__(self, api_key: str, model: str = "claude-3-sonnet-20240229"):
        import anthropic
        self.client = anthropic.AsyncAnthropic(api_key=api_key)
        self.model = model
    
    async def generate(self, messages: List[Dict[str, str]], **kwargs) -> str:
        # Convert OpenAI format to Anthropic format
        prompt = ""
        for msg in messages:
            if msg["role"] == "system":
                prompt += f"System: {msg['content']}\n\n"
            elif msg["role"] == "user":
                prompt += f"Human: {msg['content']}\n\n"
            elif msg["role"] == "assistant":
                prompt += f"Assistant: {msg['content']}\n\n"
        
        prompt += "Assistant:"
        
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=kwargs.get("max_tokens", 1000),
            temperature=kwargs.get("temperature", 0.7),
            messages=[{"role": "user", "content": prompt}]
        )
        
        return response.content[0].text


class LLMService:
    """General-purpose LLM service for various tasks."""
    
    def __init__(self, provider: str = "openai", **kwargs):
        """Initialize LLM service.
        
        Args:
            provider: LLM provider ("openai", "anthropic", etc.)
            **kwargs: Provider-specific configuration
        """
        self.provider_name = provider
        self.provider = self._create_provider(provider, **kwargs)
    
    def _create_provider(self, provider: str, **kwargs) -> Optional[LLMProvider]:
        """Create LLM provider instance."""
        if provider == "openai":
            api_key = kwargs.get("api_key") or os.getenv("OPENAI_API_KEY")
            model = kwargs.get("model", "gpt-4o-mini")
            if api_key:
                return OpenAIProvider(api_key, model)
        elif provider == "anthropic":
            api_key = kwargs.get("api_key") or os.getenv("ANTHROPIC_API_KEY")
            model = kwargs.get("model", "claude-3-sonnet-20240229")
            if api_key:
                return AnthropicProvider(api_key, model)
        return None
    
    async def generate_search_terms(
        self, 
        user_query: str, 
        attempt: int = 1, 
        is_first_attempt: bool = True
    ) -> List[str]:
        """Generate search terms for dataset search."""
        if not self.provider:
            return self._extract_basic_terms(user_query)
        
        try:
            prompt = self._build_search_prompt(user_query, attempt, is_first_attempt)
            response = await self.provider.generate([
                {"role": "system", "content": "You are a biomedical search expert specializing in finding relevant datasets in biological databases."},
                {"role": "user", "content": prompt}
            ], max_tokens=200, temperature=0.3)
            
            return self._parse_comma_separated_response(response)[:5]
            
        except Exception as e:
            print(f"LLM search terms generation error: {e}")
            return self._extract_basic_terms(user_query)
    
    async def simplify_query(self, complex_query: str) -> str:
        """Simplify a complex query to its core components."""
        if not self.provider:
            return complex_query
        
        try:
            prompt = f"""Simplify this complex query to its essential biological components:

Original query: "{complex_query}"

Extract and combine the key components into a simple, search-friendly query:
1. **Disease/Condition**: The specific disease, condition, or biological state mentioned
2. **Technical Approach**: The type of analysis or data type mentioned
3. **Biological Goal**: What the user wants to find or analyze

Focus on creating a search-friendly query that includes:
- The specific disease/condition name (e.g., "B-ALL", "breast cancer")
- The technical approach (e.g., "gene expression", "transcriptional", "RNA-seq")
- The biological goal if relevant (e.g., "subtypes", "biomarkers")

Return ONLY a simple, concise query optimized for dataset search. Do not include formatting, labels, or explanations.

Simplified query:"""
            
            response = await self.provider.generate([
                {"role": "system", "content": "You are a biomedical research assistant that simplifies complex queries for dataset search. Always prioritize disease/condition names and technical terms. Return only the simplified query, no formatting or explanations."},
                {"role": "user", "content": prompt}
            ], max_tokens=100, temperature=0.2)
            
            return response.strip().strip('"').strip("'")
            
        except Exception as e:
            print(f"Query simplification error: {e}")
            return complex_query
    
    async def generate_code(
        self, 
        task_description: str, 
        language: str = "python",
        context: Optional[str] = None
    ) -> str:
        """Generate code for a given task."""
        if not self.provider:
            return f"# Code generation not available\n# Task: {task_description}"
        
        try:
            system_prompt = f"You are an expert {language} programmer specializing in bioinformatics and data analysis."
            
            user_prompt = f"""Generate {language} code for the following task:

Task: {task_description}

{f"Context: {context}" if context else ""}

Requirements:
- Write complete, executable code
- Include proper error handling
- Add comments explaining the logic
- Use best practices for {language}

Return only the code, no explanations:"""
            
            response = await self.provider.generate([
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ], max_tokens=1000, temperature=0.1)
            
            return response.strip()
            
        except Exception as e:
            print(f"Code generation error: {e}")
            return f"# Error generating code: {e}\n# Task: {task_description}"
    
    async def call_tool(
        self, 
        tool_name: str, 
        parameters: Dict[str, Any],
        context: Optional[str] = None
    ) -> Dict[str, Any]:
        """Generate tool calling instructions."""
        if not self.provider:
            return {"error": "LLM not available for tool calling"}
        
        try:
            prompt = f"""Generate instructions for calling the tool '{tool_name}' with the following parameters:

Parameters: {json.dumps(parameters, indent=2)}

{f"Context: {context}" if context else ""}

Return a JSON object with:
- tool_name: the name of the tool
- parameters: the parameters to pass
- description: what this tool call will do

JSON response:"""
            
            response = await self.provider.generate([
                {"role": "system", "content": "You are a tool calling expert that generates precise tool invocation instructions."},
                {"role": "user", "content": prompt}
            ], max_tokens=300, temperature=0.1)
            
            # Try to parse JSON response
            try:
                return json.loads(response)
            except json.JSONDecodeError:
                return {
                    "tool_name": tool_name,
                    "parameters": parameters,
                    "description": "Tool call generated by LLM",
                    "raw_response": response
                }
            
        except Exception as e:
            print(f"Tool calling error: {e}")
            return {"error": f"Tool calling failed: {e}"}
    
    async def analyze_query(self, query: str) -> Dict[str, Any]:
        """Analyze a query to extract components and intent."""
        if not self.provider:
            return self._basic_query_analysis(query)
        
        try:
            prompt = f"""Analyze this biomedical research query and extract key components:

Query: "{query}"

Extract and return a JSON object with:
- intent: the main research goal
- entities: biological entities mentioned (genes, diseases, etc.)
- data_types: types of data needed
- analysis_type: type of analysis required
- complexity: simple/medium/complex

JSON response:"""
            
            response = await self.provider.generate([
                {"role": "system", "content": "You are a biomedical query analyzer that extracts structured information from research questions."},
                {"role": "user", "content": prompt}
            ], max_tokens=300, temperature=0.1)
            
            try:
                return json.loads(response)
            except json.JSONDecodeError:
                return self._basic_query_analysis(query)
            
        except Exception as e:
            print(f"Query analysis error: {e}")
            return self._basic_query_analysis(query)
    
    async def generate_plan(
        self, 
        question: str, 
        context: str = "", 
        current_state: dict = None,
        available_data: list = None,
        task_type: str = "general"
    ) -> dict:
        """
        Generate a plan for any task based on current context and state.
        This can be called at any point during analysis to plan next steps.
        """
        if current_state is None:
            current_state = {}
        if available_data is None:
            available_data = []
            
        prompt = f"""
You are an expert AI assistant that can plan and execute various tasks. Given a question, current context, and available data, create a plan for the next steps.

Question: {question}

Context: {context}

Current State: {json.dumps(current_state, indent=2)}

Available Data: {json.dumps(available_data, indent=2)}

Task Type: {task_type}

Please create a plan that includes:

1. Task Type: What type of task this is
2. Priority: High/Medium/Low based on importance and dependencies
3. Next Steps: A list of specific steps to accomplish the task
4. Estimated Time: Rough time estimate for completion
5. Dependencies: What needs to be completed first
6. Success Criteria: How to know when the task is complete

Return your response as a JSON object with the following structure:
{{
    "task_type": "task_type_here",
    "priority": "high|medium|low",
    "next_steps": [
        "Step 1: Description of what to do",
        "Step 2: Description of what to do",
        "Step 3: Description of what to do"
    ],
    "estimated_time": "time_estimate",
    "dependencies": ["dependency1", "dependency2"],
    "success_criteria": ["criterion1", "criterion2"]
}}

Make the steps specific, actionable, and appropriate for the current context and available data.
"""

        try:
            response = await self.provider.generate([
                {"role": "system", "content": "You are an expert AI assistant that can plan and execute various tasks. Create specific, actionable plans based on the given context."},
                {"role": "user", "content": prompt}
            ], max_tokens=1000, temperature=0.1)
            
            # Try to parse JSON from the response
            try:
                # Extract JSON from the response (it might be wrapped in markdown)
                json_start = response.find('{')
                json_end = response.rfind('}') + 1
                if json_start != -1 and json_end != 0:
                    json_str = response[json_start:json_end]
                    plan = json.loads(json_str)
                    return plan
                else:
                    raise ValueError("No JSON found in response")
            except (json.JSONDecodeError, ValueError) as e:
                print(f"Failed to parse JSON from LLM response: {e}")
                print(f"Raw response: {response}")
                
                # Fallback: generate a basic plan
                return self._generate_fallback_plan(question, task_type)
                
        except Exception as e:
            print(f"Error generating plan: {e}")
            return self._generate_fallback_plan(question, task_type)

    def _generate_fallback_plan(self, question: str, task_type: str = "general") -> dict:
        """
        Generate a fallback plan when LLM fails.
        """
        question_lower = question.lower()
        
        # Basic keyword-based plan generation
        if task_type == "analysis" or any(word in question_lower for word in ["analyze", "analysis", "study"]):
            next_steps = [
                "Load and examine the available data",
                "Perform initial data exploration",
                "Apply appropriate analytical methods",
                "Generate results and visualizations",
                "Interpret findings and draw conclusions"
            ]
        elif task_type == "data_processing" or any(word in question_lower for word in ["process", "clean", "preprocess"]):
            next_steps = [
                "Assess data quality and structure",
                "Handle missing values and outliers",
                "Apply data transformations",
                "Validate processed data",
                "Save processed data for next steps"
            ]
        elif task_type == "visualization" or any(word in question_lower for word in ["plot", "visualize", "graph"]):
            next_steps = [
                "Identify key data to visualize",
                "Choose appropriate plot types",
                "Create initial visualizations",
                "Refine plots for clarity",
                "Add annotations and labels"
            ]
        else:
            next_steps = [
                "Understand the current situation",
                "Identify what needs to be done",
                "Execute the required actions",
                "Verify the results",
                "Document the outcomes"
            ]
        
        return {
            "task_type": task_type,
            "priority": "medium",
            "next_steps": next_steps,
            "estimated_time": "variable",
            "dependencies": [],
            "success_criteria": ["Task completed", "Results documented"]
        }
    
    def _build_search_prompt(
        self, 
        user_query: str, 
        attempt: int, 
        is_first_attempt: bool
    ) -> str:
        """Build the prompt for search term generation."""
        if is_first_attempt:
            return f"""The user wants to search biological databases for datasets.

User query: "{user_query}"

Generate 3-5 specific search terms that would be most effective for finding relevant datasets. Focus on:

1. **Disease/Condition**: Extract the specific disease, condition, or biological state mentioned (e.g., "B-ALL", "breast cancer", "diabetes")
2. **Technical Terms**: Include specific technical terms from the query (e.g., "transcriptional", "gene expression", "RNA-seq")
3. **Biological Concepts**: Include relevant biological processes or concepts (e.g., "subtypes", "clustering", "biomarkers")

IMPORTANT: 
- Start with the disease/condition name alone (e.g., "B-ALL")
- Then add disease + technical term combinations (e.g., "B-ALL gene expression")
- Avoid overly specific combinations that might be too narrow
- Use terms that are likely to appear in dataset titles and descriptions
- Return only the search terms, separated by commas, no explanations or formatting

Return only the search terms, separated by commas."""
        else:
            return f"""The previous search terms didn't find any results.

User query: "{user_query}"
Previous attempt: {attempt}

Generate 3-5 alternative search terms that are:
1. **Broader disease terms**: Use synonyms or broader categories for the disease mentioned
2. **Different technical approaches**: Try alternative technical terms or methodologies
3. **Related conditions**: Include related diseases or conditions
4. **Specific techniques**: Focus on specific experimental techniques mentioned

IMPORTANT:
- Still prioritize the disease/condition from the original query
- Try broader disease categories if specific terms failed
- Include alternative technical terms for the same biological concept
- Return only the search terms, separated by commas, no explanations

Return only the search terms, separated by commas."""
    
    def _parse_comma_separated_response(self, response: str) -> List[str]:
        """Parse comma-separated response."""
        try:
            return [term.strip() for term in response.split(',') if term.strip()]
        except Exception as e:
            print(f"Error parsing response: {e}")
            return []
    
    def _extract_basic_terms(self, query: str) -> List[str]:
        """Fallback method to extract basic terms from query."""
        import re
        common_words = {
            "can", "you", "find", "me", "the", "different", "of", "in", "on", "at", "to", "for",
            "with", "by", "from", "this", "that", "these", "those", "what", "when", "where",
            "why", "how", "which", "who", "whose", "whom", "please", "show", "get", "want",
            "need", "would", "could", "should", "will", "may", "might", "must", "shall"
        }
        
        # Extract GEO IDs
        geo_ids = re.findall(r'GSE\d+', query)
        
        # Extract disease-like terms (patterns that look like disease names)
        disease_patterns = [
            r'\b[A-Z][A-Z-]+\b',  # ALL, B-ALL, AML, etc.
            r'\b[A-Z][a-z]+ [A-Z][a-z]+\b',  # Breast Cancer, etc.
            r'\bcancer\b', r'\bleukemia\b', r'\blymphoma\b', r'\bdiabetes\b',
            r'\bheart\b', r'\blung\b', r'\bbrain\b', r'\bliver\b', r'\bkidney\b'
        ]
        
        disease_terms = []
        for pattern in disease_patterns:
            matches = re.findall(pattern, query, re.IGNORECASE)
            disease_terms.extend(matches)
        
        # Extract technical/biological terms
        technical_terms = [
            r'\btranscriptional\b', r'\bexpression\b', r'\bsubtypes\b', r'\bclustering\b',
            r'\bbiomarkers\b', r'\bgenes\b', r'\bRNA\b', r'\bDNA\b', r'\bprotein\b',
            r'\bsequencing\b', r'\bmicroarray\b', r'\banalysis\b', r'\bdata\b'
        ]
        
        tech_terms = []
        for pattern in technical_terms:
            matches = re.findall(pattern, query, re.IGNORECASE)
            tech_terms.extend(matches)
        
        # Extract meaningful words (4+ characters, not common words)
        words = [
            word.lower() 
            for word in re.findall(r'\b\w+\b', query)
            if len(word) >= 4 and word.lower() not in common_words
        ]
        
        # Prioritize disease terms, then technical terms, then other words
        result = geo_ids + disease_terms + tech_terms + words[:3]
        
        # Remove duplicates while preserving order
        seen = set()
        unique_result = []
        for term in result:
            if term.lower() not in seen:
                unique_result.append(term)
                seen.add(term.lower())
        
        return unique_result[:5]
    
    def _basic_query_analysis(self, query: str) -> Dict[str, Any]:
        """Basic query analysis without LLM."""
        return {
            "intent": "data_search",
            "entities": [],
            "data_types": ["gene_expression"],
            "analysis_type": "exploratory",
            "complexity": "simple"
        }


# Global LLM service instance
llm_service = None

def get_llm_service(provider: str = "openai", **kwargs) -> LLMService:
    """Get or create the LLM service instance."""
    global llm_service
    if llm_service is None:
        llm_service = LLMService(provider=provider, **kwargs)
    return llm_service 