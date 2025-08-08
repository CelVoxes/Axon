"""General-purpose LLM service for various tasks including search, code generation, and tool calling."""

import os
import asyncio
import json
from typing import List, Optional, Dict, Any, Union, Sequence
from abc import ABC, abstractmethod
import openai
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam


class LLMProvider(ABC):
    """Abstract base class for LLM providers."""
    
    @abstractmethod
    async def generate(self, messages: Sequence[ChatCompletionMessageParam], **kwargs) -> str:
        """Generate response from messages."""
        pass
    
    @abstractmethod
    async def generate_stream(self, messages: Sequence[ChatCompletionMessageParam], **kwargs):
        """Generate streaming response from messages."""
        yield ""


class OpenAIProvider(LLMProvider):
    """OpenAI provider implementation."""
    
    def __init__(self, api_key: str, model: str = "gpt-4o-mini"):
        self.client = AsyncOpenAI(api_key=api_key)
        self.model = model
    
    async def generate(self, messages: Sequence[ChatCompletionMessageParam], **kwargs) -> str:
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=list(messages),
            **kwargs
        )
        return response.choices[0].message.content.strip()
    
    async def generate_stream(self, messages: Sequence[ChatCompletionMessageParam], **kwargs):
        """Generate streaming response from messages."""
        try:
            stream = await self.client.chat.completions.create(
                model=self.model,
                messages=list(messages),
                stream=True,
                **kwargs
            )
            
            async for chunk in stream:
                if chunk.choices[0].delta.content is not None:
                    yield chunk.choices[0].delta.content
                    
        except Exception as e:
            print(f"OpenAI streaming error: {e}")
            # Return a simple fallback message
            yield f"# Error: Could not generate code due to: {e}\nprint('Code generation failed')"


class AnthropicProvider(LLMProvider):
    """Anthropic provider implementation."""
    
    def __init__(self, api_key: str, model: str = "claude-3-sonnet-20240229"):
        try:
            import anthropic
            self.client = anthropic.AsyncAnthropic(api_key=api_key)
            self.model = model
        except ImportError:
            raise ImportError("anthropic package not installed. Run: pip install anthropic")
    
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
    
    async def generate_stream(self, messages: List[Dict[str, str]], **kwargs):
        """Generate streaming response from messages."""
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
        
        with self.client.messages.stream(
            model=self.model,
            max_tokens=kwargs.get("max_tokens", 1000),
            temperature=kwargs.get("temperature", 0.7),
            messages=[{"role": "user", "content": prompt}]
        ) as stream:
            for text in stream.text_stream:
                yield text


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
        print(f"Creating LLM provider: {provider}")
        
        if provider == "openai":
            api_key = kwargs.get("api_key") or os.getenv("OPENAI_API_KEY")
            model = kwargs.get("model", "gpt-4o-mini")
            print(f"OpenAI API key found: {bool(api_key)}")
            if api_key:
                print(f"Creating OpenAI provider with model: {model}")
                return OpenAIProvider(api_key, model)
            else:
                print("No OpenAI API key found")
        elif provider == "anthropic":
            api_key = kwargs.get("api_key") or os.getenv("ANTHROPIC_API_KEY")
            model = kwargs.get("model", "claude-3-sonnet-20240229")
            print(f"Anthropic API key found: {bool(api_key)}")
            if api_key:
                print(f"Creating Anthropic provider with model: {model}")
                return AnthropicProvider(api_key, model)
            else:
                print("No Anthropic API key found")
        
        print("No provider created, returning None")
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
            
            # Add timeout protection
            response = await asyncio.wait_for(
                self.provider.generate([
                    {"role": "system", "content": "You are a biomedical research assistant that simplifies complex queries for dataset search. Always prioritize disease/condition names and technical terms. Return only the simplified query, no formatting or explanations."},
                    {"role": "user", "content": prompt}
                ], max_tokens=100, temperature=0.2),
                timeout=25.0  # 25 second timeout
            )
            
            return response.strip().strip('"').strip("'")
            
        except asyncio.TimeoutError:
            print(f"Query simplification timed out after 25 seconds, using original query")
            return complex_query
        except Exception as e:
            print(f"Query simplification error: {e}")
            return complex_query
    
    async def generate_code(
        self, 
        task_description: str, 
        language: str = "python",
        context: Optional[str] = None
    ) -> str:
        """Generate code for a given task description."""
        if not self.provider:
            return self._generate_fallback_code(task_description, language)
        
        prompt = f"""
You are an expert Python programmer specializing in data analysis and bioinformatics. 
Generate clean, well-documented code for the following task.

Task: {task_description}
Language: {language}

{f"Context: {context}" if context else ""}

Requirements:
- Write only the code, no explanations
- Include necessary imports
- Add comments for clarity
- Handle errors gracefully
- Follow Python best practices

Code:
"""
        
        try:
            response = await self.provider.generate([
                {"role": "system", "content": "You are an expert Python programmer. Generate only code, no explanations."},
                {"role": "user", "content": prompt}
            ], max_tokens=2000, temperature=0.1)
            
            return self.extract_python_code(response) or self._generate_fallback_code(task_description, language)
            
        except Exception as e:
            print(f"Error generating code: {e}")
            return self._generate_fallback_code(task_description, language)
    
    async def generate_code_stream(
        self, 
        task_description: str, 
        language: str = "python",
        context: Optional[str] = None
    ):
        """Generate code with streaming for a given task description."""
        
        if not self.provider:
            # For fallback, yield the entire code at once
            fallback_code = self._generate_fallback_code(task_description, language)
            yield fallback_code
            return
        
        # Enhanced prompt with better structure and examples
        prompt = f"""
You are an expert Python programmer specializing in data analysis and bioinformatics. 
Generate clean, well-documented, EXECUTABLE code for the following task.

TASK: {task_description}
LANGUAGE: {language}

{f"CONTEXT: {context}" if context else ""}

CRITICAL REQUIREMENTS:
1. Write ONLY executable Python code - NO explanations, markdown, or non-code text
2. ALWAYS include ALL necessary imports at the top
3. Use these standard imports: pandas, numpy, matplotlib, seaborn, scipy, sklearn, requests, gzip, io, os, pathlib
4. Add clear comments explaining each step
5. Handle errors gracefully with try-except blocks
6. Follow Python best practices
7. Make the code production-ready and biologically meaningful
8. Include print statements to show progress
9. Save outputs to appropriate directories (results/, figures/, etc.)
10. Use simple string formatting: print("Value:", value) instead of complex f-strings
11. Ensure all strings are properly closed and escaped

DATASET HANDLING REQUIREMENTS:
- ALWAYS validate URLs before downloading
- Check HTTP status codes (200 = success, 404 = not found, etc.)
- Handle different file formats (txt, csv, gz, gzip, etc.)
- Validate downloaded content (check if it's HTML error page vs actual data)
- Provide fallback options when downloads fail
- Use proper headers for requests to avoid being blocked
- Check file size and content type
- For GEO datasets: Use proper NCBI URLs and handle series matrix files

ERROR HANDLING:
- Always wrap downloads in try-except blocks
- Check if response contains HTML error pages
- Validate file content before processing
- Provide meaningful error messages
- Continue execution even if some datasets fail

CODE STRUCTURE:
1. Start with imports
2. Create output directories
3. Define helper functions
4. Main execution code with error handling
5. Save results and create visualizations

EXAMPLE STRUCTURE:
```python
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import os
from pathlib import Path

# Create output directories
results_dir = Path('results')
figures_dir = Path('figures')
results_dir.mkdir(exist_ok=True)
figures_dir.mkdir(exist_ok=True)

print("Starting analysis...")

try:
    # Your code here
    print("Analysis completed successfully!")
except Exception as e:
    print(f"Error: {{e}}")
    raise
```

Generate the code now:
"""
        
        try:
            async for chunk in self.provider.generate_stream([
                {"role": "system", "content": "You are an expert Python programmer specializing in bioinformatics and data analysis. Generate ONLY executable Python code with proper imports. Never include explanations, markdown, or non-code text. Avoid complex f-strings and ensure all syntax is correct. Always include error handling and proper directory structure."},
                {"role": "user", "content": prompt}
            ], max_tokens=3000, temperature=0.1):
                yield chunk
                
        except Exception as e:
            print(f"Error generating streaming code: {e}")
            # Yield fallback code
            fallback_code = self._generate_fallback_code(task_description, language)
            yield fallback_code
    
    def validate_python_code(self, code: str) -> tuple[bool, str]:
        """Validate Python code syntax and basic structure."""
        import ast
        import re
        
        if not code or not code.strip():
            return False, "Empty code"
        
        # Check for basic syntax errors
        try:
            ast.parse(code)
        except SyntaxError as e:
            return False, f"Syntax error: {e}"
        except Exception as e:
            return False, f"AST parsing error: {e}"
        
        # Check for common issues
        issues = []
        
        # Check for unclosed strings
        if code.count('"') % 2 != 0 or code.count("'") % 2 != 0:
            issues.append("Unclosed string literals")
        
        # Check for unclosed parentheses/brackets
        if code.count('(') != code.count(')') or code.count('[') != code.count(']') or code.count('{') != code.count('}'):
            issues.append("Unmatched parentheses/brackets")
        
        # Check for common problematic patterns
        if re.search(r'f"[^"]*{[^}]*"[^}]*}', code):
            issues.append("Malformed f-string")
        
        # Check for missing imports (basic check)
        if 'pandas' in code and 'import pandas' not in code and 'from pandas' not in code:
            issues.append("Missing pandas import")
        
        if 'numpy' in code and 'import numpy' not in code and 'from numpy' not in code:
            issues.append("Missing numpy import")
        
        if 'matplotlib' in code and 'import matplotlib' not in code and 'from matplotlib' not in code:
            issues.append("Missing matplotlib import")
        
        if issues:
            return False, f"Code issues: {', '.join(issues)}"
        
        return True, "Code is valid"
    
    def extract_python_code(self, response: str) -> Optional[str]:
        """Extract Python code from LLM response."""
        # Look for code blocks
        import re
        
        # Try to find code blocks
        code_block_pattern = r"```(?:python)?\s*\n(.*?)\n```"
        match = re.search(code_block_pattern, response, re.DOTALL)
        if match:
            code = match.group(1).strip()
        else:
            # If no code blocks, try to extract from the response
            lines = response.split('\n')
            code_lines = []
            in_code = False
            
            for line in lines:
                if line.strip().startswith('import ') or line.strip().startswith('from '):
                    in_code = True
                elif line.strip().startswith('#') or line.strip().startswith('def ') or line.strip().startswith('class '):
                    in_code = True
                
                if in_code:
                    code_lines.append(line)
            
            if code_lines:
                code = '\n'.join(code_lines).strip()
            else:
                return None
        
        # Validate the extracted code
        is_valid, message = self.validate_python_code(code)
        if not is_valid:
            print(f"Code validation failed: {message}")
            print("Attempting to fix common issues...")
            code = self._fix_common_code_issues(code)
            # Validate again after fixing
            is_valid, message = self.validate_python_code(code)
            if not is_valid:
                print(f"Code still invalid after fixing: {message}")
                return None
        
        return code
    
    def _fix_common_code_issues(self, code: str) -> str:
        """Attempt to fix common code issues."""
        import re
        
        # Fix common f-string issues
        # Remove problematic f-strings and replace with simple string formatting
        code = re.sub(r'f"([^"]*)"', r'"\1"', code)
        
        # Fix unclosed strings by adding quotes
        lines = code.split('\n')
        fixed_lines = []
        
        for line in lines:
            # Count quotes in the line
            quote_count = line.count('"') + line.count("'")
            if quote_count % 2 != 0:
                # Add closing quote
                if line.count('"') % 2 != 0:
                    line += '"'
                elif line.count("'") % 2 != 0:
                    line += "'"
            fixed_lines.append(line)
        
        return '\n'.join(fixed_lines)
    
    def _generate_fallback_code(self, task_description: str, language: str = "python") -> str:
        """Generate fallback code when LLM is not available."""
        desc_lower = task_description.lower()
        
        # Basic imports
        code = f"""# Fallback code generation
# Task: {task_description}

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import os
from pathlib import Path

print("Executing:", task_description)

# Set up directories
results_dir = Path('results')
figures_dir = Path('figures')
results_dir.mkdir(exist_ok=True)
figures_dir.mkdir(exist_ok=True)

"""
        
        # Add specific code based on task description keywords
        if any(keyword in desc_lower for keyword in ['download', 'load', 'data']):
            code += r"""
# Data loading and preprocessing with robust error handling
print("Loading and preprocessing data...")

import requests
import gzip
import io
from urllib.parse import urlparse

def download_dataset(url, filename):
    # Download dataset with proper error handling and validation
    try:
        print("Downloading from:", url)
        
        # Set headers to avoid being blocked
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()  # Raise exception for bad status codes
        
        # Check if response is HTML (error page)
        content_type = response.headers.get('content-type', '')
        if 'text/html' in content_type.lower():
            print("Warning: Received HTML response, may be an error page")
            return False
            
        # Check content length
        if len(response.content) < 100:
            print("Warning: Response too small, may be an error")
            return False
            
        # Save the file
        with open(filename, 'wb') as f:
            f.write(response.content)
        
        print("Download successful:", filename)
        return True
        
    except requests.exceptions.RequestException as e:
        print("Download failed:", e)
        return False
    except Exception as e:
        print("Unexpected error during download:", e)
        return False

def load_data_file(filename):
    # Load data file with format detection
    try:
        # Try different formats
        if filename.endswith('.gz') or filename.endswith('.gzip'):
            with gzip.open(filename, 'rt') as f:
                return pd.read_csv(f, sep='\t')
        elif filename.endswith('.csv'):
            return pd.read_csv(filename)
        elif filename.endswith('.txt'):
            # Try different separators
            try:
                return pd.read_csv(filename, sep='\t')
            except Exception:
                return pd.read_csv(filename, sep=',')
        else:
            # Try common formats
            try:
                return pd.read_csv(filename, sep='\t')
            except Exception:
                return pd.read_csv(filename)
    except Exception as e:
        print("Error loading", filename, ":", e)
        return None

# Check for available data files
data_files = []
for file in Path('.').glob('*.csv'):
    data_files.append(file.name)
for file in Path('.').glob('*.txt'):
    data_files.append(file.name)
for file in Path('.').glob('*.gz'):
    data_files.append(file.name)

print("Found data files:", data_files)

# Load data if available
if data_files:
    for data_file in data_files:
        try:
            data = load_data_file(data_file)
            if data is not None:
                print("Successfully loaded", data_file, ":", data.shape[0], "rows,", data.shape[1], "columns")
                print("Columns:", list(data.columns))
                
                # Basic data exploration
                print("\nData summary:")
                print(data.info())
                print("\nFirst few rows:")
                print(data.head())
                break
        except Exception as e:
            print("Error loading", data_file, ":", e)
            continue
else:
    print("No data files found. Please ensure data is available.")
"""
        
        elif any(keyword in desc_lower for keyword in ['expression', 'differential', 'deg']):
            code += """
# Gene expression analysis
print("Performing gene expression analysis...")

# This would typically involve:
# 1. Loading expression data
# 2. Quality control
# 3. Normalization
# 4. Differential expression analysis

print("Expression analysis framework ready.")
print("Please implement specific analysis based on your data.")
"""
        
        elif any(keyword in desc_lower for keyword in ['subtype', 'clustering', 'classification']):
            code += """
# Subtype/clustering analysis
print("Performing subtype/clustering analysis...")

# This would typically involve:
# 1. Data preprocessing
# 2. Feature selection
# 3. Dimensionality reduction
# 4. Clustering algorithm application
# 5. Visualization

print("Clustering analysis framework ready.")
print("Please implement specific clustering based on your data.")
"""
        
        elif any(keyword in desc_lower for keyword in ['visualization', 'plot', 'figure']):
            code += """
# Data visualization
print("Creating visualizations...")

# Example visualization code
try:
    # Create a sample plot
    fig, ax = plt.subplots(figsize=(10, 6))
    ax.set_title("Analysis: " + task_description)
    ax.set_xlabel("Sample")
    ax.set_ylabel("Value")
    
    # Save the plot
    plot_file = figures_dir / f"analysis_plot_{pd.Timestamp.now().strftime('%Y%m%d_%H%M%S')}.png"
    plt.savefig(plot_file, dpi=300, bbox_inches='tight')
    print("Saved plot to:", plot_file)
    plt.close()
    
except Exception as e:
    print(f"Error creating visualization: {e}")
"""
        
        else:
            code += """
# General analysis framework
print("Setting up analysis framework...")

# This is a general analysis template
# Please implement specific analysis based on your requirements

print("Analysis framework ready.")
print("Please implement specific analysis based on your data and requirements.")
"""
        
        code += f"""
        print("\\n✅ {task_description} - Analysis completed!")
        print("Results saved to 'results/' directory")
        print("Figures saved to 'figures/' directory")
        """
        
        return code
    
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
        current_state: Optional[dict] = None,
        available_data: Optional[list] = None,
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

        if not self.provider:
            return self._generate_fallback_plan(question, task_type)
            
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
    
    async def generate_data_type_suggestions(
        self,
        data_types: List[str],
        user_question: str,
        available_datasets: List[Dict[str, Any]],
        current_context: str = ""
    ) -> Dict[str, Any]:
        """
        Generate dynamic analysis suggestions based on the selected data types.
        This provides contextual recommendations for what the user can analyze.
        """
        if not data_types:
            return {
                "suggestions": [],
                "recommended_analyses": [],
                "data_insights": []
            }
            
        prompt = f"""
You are an expert bioinformatics and data science assistant. Based on the selected data types and user question, provide dynamic analysis suggestions.

User Question: {user_question}

Selected Data Types: {', '.join(data_types)}

Available Datasets: {json.dumps(available_datasets, indent=2)}

Current Context: {current_context}

Please provide:

1. **Specific Analysis Suggestions**: List 3-5 specific analyses that would be valuable for this data type and question
2. **Recommended Approaches**: Suggest the best analytical approaches for this data
3. **Data Insights**: What interesting patterns or insights could be discovered
4. **Next Steps**: What should the user do next to get the most value from this data

For each data type, provide tailored suggestions:

- **Single-cell expression data**: Clustering, trajectory analysis, differential expression, cell type annotation
- **Expression matrix data**: Differential expression, pathway analysis, correlation analysis, visualization
- **Clinical data**: Statistical analysis, survival analysis, correlation with molecular data
- **Sequence data**: Quality control, alignment, variant calling, annotation
- **Variant data**: Frequency analysis, functional impact, association studies
- **Metadata**: Quality assessment, integration with other data types

Return your response as a JSON object with this structure:
{{
    "suggestions": [
        {{
            "title": "Analysis Title",
            "description": "What this analysis will reveal",
            "data_types": ["data_type1", "data_type2"],
            "complexity": "easy|medium|hard",
            "estimated_time": "time estimate",
            "expected_insights": ["insight1", "insight2"]
        }}
    ],
    "recommended_approaches": [
        {{
            "approach": "Approach name",
            "description": "Why this approach is suitable",
            "tools": ["tool1", "tool2"],
            "data_types": ["data_type1"]
        }}
    ],
    "data_insights": [
        {{
            "insight": "Potential insight",
            "data_type": "data_type",
            "confidence": "high|medium|low"
        }}
    ],
    "next_steps": [
        "Step 1: Description",
        "Step 2: Description"
    ]
}}

Make suggestions specific, actionable, and tailored to the user's question and data types.
"""

        if not self.provider:
            return self._generate_fallback_suggestions(data_types, user_question)
            
        try:
            response = await self.provider.generate([
                {"role": "system", "content": "You are an expert bioinformatics assistant that provides specific, actionable analysis suggestions based on data types and research questions."},
                {"role": "user", "content": prompt}
            ], max_tokens=1500, temperature=0.3)
            
            # Try to parse JSON from the response
            try:
                json_start = response.find('{')
                json_end = response.rfind('}') + 1
                if json_start != -1 and json_end != 0:
                    json_str = response[json_start:json_end]
                    suggestions = json.loads(json_str)
                    return suggestions
                else:
                    raise ValueError("No JSON found in response")
            except (json.JSONDecodeError, ValueError) as e:
                print(f"Failed to parse JSON from suggestions response: {e}")
                return self._generate_fallback_suggestions(data_types, user_question)
                
        except Exception as e:
            print(f"Error generating data type suggestions: {e}")
            return self._generate_fallback_suggestions(data_types, user_question)

    def _generate_fallback_suggestions(self, data_types: List[str], user_question: str) -> Dict[str, Any]:
        """
        Generate fallback suggestions when LLM fails.
        """
        suggestions = []
        
        for data_type in data_types:
            if data_type == "single_cell_expression":
                suggestions.append({
                    "title": "Single-cell Clustering Analysis",
                    "description": "Identify distinct cell populations and their gene expression patterns",
                    "data_types": ["single_cell_expression"],
                    "complexity": "medium",
                    "estimated_time": "30-60 minutes",
                    "expected_insights": ["Cell type identification", "Gene expression patterns", "Cell population heterogeneity"]
                })
                suggestions.append({
                    "title": "Differential Expression Analysis",
                    "description": "Find genes that are differentially expressed between cell types or conditions",
                    "data_types": ["single_cell_expression"],
                    "complexity": "medium",
                    "estimated_time": "20-40 minutes",
                    "expected_insights": ["Marker genes", "Pathway enrichment", "Functional differences"]
                })
            elif data_type == "expression_matrix":
                suggestions.append({
                    "title": "Expression Pattern Analysis",
                    "description": "Analyze gene expression patterns across samples or conditions",
                    "data_types": ["expression_matrix"],
                    "complexity": "easy",
                    "estimated_time": "15-30 minutes",
                    "expected_insights": ["Expression trends", "Sample clustering", "Gene correlations"]
                })
            elif data_type == "clinical_data":
                suggestions.append({
                    "title": "Clinical Data Summary",
                    "description": "Generate comprehensive summary statistics and visualizations",
                    "data_types": ["clinical_data"],
                    "complexity": "easy",
                    "estimated_time": "10-20 minutes",
                    "expected_insights": ["Patient demographics", "Clinical correlations", "Risk factors"]
                })
            elif data_type == "sequence_data":
                suggestions.append({
                    "title": "Sequence Quality Assessment",
                    "description": "Evaluate sequence data quality and perform basic analysis",
                    "data_types": ["sequence_data"],
                    "complexity": "medium",
                    "estimated_time": "20-40 minutes",
                    "expected_insights": ["Quality metrics", "Sequence characteristics", "Potential issues"]
                })
            elif data_type == "variant_data":
                suggestions.append({
                    "title": "Variant Analysis",
                    "description": "Analyze genetic variants and their potential impact",
                    "data_types": ["variant_data"],
                    "complexity": "medium",
                    "estimated_time": "25-45 minutes",
                    "expected_insights": ["Variant frequency", "Functional impact", "Disease associations"]
                })
        
        return {
            "suggestions": suggestions,
            "recommended_approaches": [
                {
                    "approach": "Exploratory Data Analysis",
                    "description": "Start with basic exploration to understand your data",
                    "tools": ["pandas", "matplotlib", "seaborn"],
                    "data_types": data_types
                }
            ],
            "data_insights": [
                {
                    "insight": "Data quality assessment",
                    "data_type": "general",
                    "confidence": "high"
                }
            ],
            "next_steps": [
                "Load and examine your data",
                "Perform quality control checks",
                "Choose an analysis approach from the suggestions above"
            ]
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