"""General-purpose LLM service for various tasks including search, code generation, and tool calling."""

import os
import asyncio
import json
from typing import List, Optional, Dict, Any, Union, Sequence, cast
from abc import ABC, abstractmethod
import openai
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam
from .config import SearchConfig


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
    
    def __init__(self, api_key: str, model: Optional[str] = None):
        self.client = AsyncOpenAI(api_key=api_key)
        default_model = SearchConfig.get_default_llm_model()
        self.model = model if isinstance(model, str) and model else (default_model if isinstance(default_model, str) and default_model else "gpt-4o-mini")
        self.last_usage = None
        self.last_response_id: Optional[str] = None
    
    def _prepare_kwargs(self, kwargs: dict) -> dict:
        """Prepare kwargs for OpenAI API, handling model-specific parameter differences."""
        prepared_kwargs = kwargs.copy()
        
        # Handle gpt-5-mini restrictions
        if self._is_gpt5_mini():
            # Remove unsupported parameters for gpt-5-mini
            prepared_kwargs.pop("max_tokens", None)
            prepared_kwargs.pop("temperature", None)  # Only supports temperature=1 (default)
            # Note: max_completion_tokens would be used but current client doesn't support it
            
        return prepared_kwargs
    
    def _is_gpt5_mini(self) -> bool:
        """Check if the model is gpt-5-mini."""
        return "gpt-5-mini" in self.model.lower()
    
    def _is_new_model(self) -> bool:
        """Check if the model is a newer model that uses max_completion_tokens."""
        new_models = ["gpt-5-mini", "gpt-4o-2024-11-20", "gpt-4o-mini-2024-07-18", "chatgpt-4o-latest"]
        return any(model in self.model for model in new_models)
    
    async def generate(self, messages: Sequence[ChatCompletionMessageParam], **kwargs) -> str:
        """Generate with Responses API when available, else fall back to Chat Completions."""
        prepared_kwargs = self._prepare_kwargs(kwargs)

        # Try Responses API first
        try:
            responses_api = getattr(self.client, "responses", None)
            if responses_api is not None and hasattr(responses_api, "create"):
                # The Responses API can accept message-style input
                resp = await responses_api.create(
                    model=self.model,
                    input=list(messages),
                    **{k: v for k, v in prepared_kwargs.items() if k not in ("messages",)}
                )
                try:
                    self.last_response_id = getattr(resp, "id", None)
                except Exception:
                    self.last_response_id = None
                # Best-effort extraction of text
                text = None
                try:
                    text = getattr(resp, "output_text", None)
                except Exception:
                    text = None
                if not text and hasattr(resp, "output"):
                    parts = []
                    try:
                        for item in resp.output:
                            if getattr(item, "type", None) == "message":
                                for c in getattr(item, "content", []) or []:
                                    ct = getattr(c, "type", None)
                                    if ct in ("output_text", "text"):
                                        parts.append(getattr(c, "text", "") or "")
                    except Exception:
                        pass
                    text = "".join(parts) if parts else None
                # Estimate usage so session stats can advance even when Responses API
                # doesn't expose token usage directly
                try:
                    est_prompt_tokens = sum(len(str(m.get('content', ''))) for m in messages) // 4
                    est_completion_tokens = len(text or "") // 4
                    self.last_usage = {
                        'prompt_tokens': est_prompt_tokens,
                        'completion_tokens': est_completion_tokens,
                        'total_tokens': est_prompt_tokens + est_completion_tokens,
                    }
                except Exception:
                    self.last_usage = None
                if text:
                    return text.strip()
        except Exception as e:
            print(f"Responses API (non-stream) error, falling back to chat: {e}")

        # Fallback to Chat Completions
        cc_kwargs = {k: v for k, v in prepared_kwargs.items() if k not in ("store", "previous_response_id")}
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=list(messages),
            **cc_kwargs
        )

        # Check for COT usage and log it
        if hasattr(response, 'usage') and hasattr(response.usage, 'completion_tokens_details'):
            details = response.usage.completion_tokens_details
            if hasattr(details, 'reasoning_tokens') and details.reasoning_tokens > 0:
                total_completion = response.usage.completion_tokens
                reasoning_pct = (details.reasoning_tokens / total_completion) * 100 if total_completion > 0 else 0
                print(f"🧠 COT Reasoning detected: {details.reasoning_tokens}/{total_completion} tokens ({reasoning_pct:.1f}% reasoning)")
        # Persist usage
        try:
            if hasattr(response, 'usage') and response.usage is not None:
                self.last_usage = {
                    'prompt_tokens': getattr(response.usage, 'prompt_tokens', None),
                    'completion_tokens': getattr(response.usage, 'completion_tokens', None),
                    'total_tokens': getattr(response.usage, 'total_tokens', None),
                    'completion_tokens_details': getattr(response.usage, 'completion_tokens_details', None),
                }
            else:
                self.last_usage = None
        except Exception:
            self.last_usage = None

        return response.choices[0].message.content.strip()
    
    async def generate_stream(self, messages: Sequence[ChatCompletionMessageParam], **kwargs):
        """Generate streaming response using Responses API when available, else Chat Completions."""
        prepared_kwargs = self._prepare_kwargs(kwargs)

        # Try Responses streaming first
        try:
            responses_api = getattr(self.client, "responses", None)
            if responses_api is not None:
                # Prefer the streaming helper if available
                if hasattr(responses_api, "stream"):
                    try:
                        stream_ctx = responses_api.stream(
                            model=self.model,
                            input=list(messages),
                            **{k: v for k, v in prepared_kwargs.items() if k not in ("messages",)}
                        )
                        # The SDK streaming is an async context manager in recent versions
                        async with stream_ctx as stream:
                            total_text = ""
                            async for event in stream:
                                etype = getattr(event, "type", "")
                                # Emit text deltas
                                delta = getattr(event, "delta", None)
                                if delta and ("output_text" in etype or etype.endswith(".delta")):
                                    s = str(delta)
                                    total_text += s
                                    yield s
                                # Capture response id if available
                                try:
                                    resp_obj = getattr(event, "response", None)
                                    if resp_obj is not None and getattr(resp_obj, "id", None):
                                        self.last_response_id = getattr(resp_obj, "id", None)
                                except Exception:
                                    pass
                            # Estimate usage after stream completes
                            try:
                                est_prompt_tokens = sum(len(str(m.get('content', ''))) for m in messages) // 4
                                est_completion_tokens = len(total_text) // 4
                                self.last_usage = {
                                    'prompt_tokens': est_prompt_tokens,
                                    'completion_tokens': est_completion_tokens,
                                    'total_tokens': est_prompt_tokens + est_completion_tokens,
                                }
                            except Exception:
                                self.last_usage = None
                        return
                    except Exception as e:
                        print(f"Responses API .stream failed, trying create(stream=True): {e}")

                if hasattr(responses_api, "create"):
                    resp_stream = await responses_api.create(
                        model=self.model,
                        input=list(messages),
                        stream=True,
                        **{k: v for k, v in prepared_kwargs.items() if k not in ("messages",)}
                    )
                    total_text = ""
                    async for event in resp_stream:
                        etype = getattr(event, "type", "")
                        delta = getattr(event, "delta", None)
                        if delta and ("output_text" in etype or etype.endswith(".delta")):
                            s = str(delta)
                            total_text += s
                            yield s
                        # Capture id from streaming events when present
                        try:
                            resp_obj = getattr(event, "response", None)
                            if resp_obj is not None and getattr(resp_obj, "id", None):
                                self.last_response_id = getattr(resp_obj, "id", None)
                        except Exception:
                            pass
                    # Estimate usage after stream completes
                    try:
                        est_prompt_tokens = sum(len(str(m.get('content', ''))) for m in messages) // 4
                        est_completion_tokens = len(total_text) // 4
                        self.last_usage = {
                            'prompt_tokens': est_prompt_tokens,
                            'completion_tokens': est_completion_tokens,
                            'total_tokens': est_prompt_tokens + est_completion_tokens,
                        }
                    except Exception:
                        self.last_usage = None
                    return
        except Exception as e:
            print(f"Responses API (stream) error, falling back to chat: {e}")

        # Fallback to Chat Completions streaming
        try:
            cc_kwargs = {k: v for k, v in prepared_kwargs.items() if k not in ("store", "previous_response_id")}
            stream = await self.client.chat.completions.create(
                model=self.model,
                messages=list(messages),
                stream=True,
                **cc_kwargs
            )
            
            # Track usage for streaming responses
            total_tokens = 0
            async for chunk in stream:
                if chunk.choices[0].delta.content is not None:
                    content = chunk.choices[0].delta.content
                    # Rough token estimation for streaming (4 chars ≈ 1 token)
                    total_tokens += len(content) // 4
                    yield content
                    
                # Capture final usage if available in the last chunk
                if hasattr(chunk, 'usage') and chunk.usage is not None:
                    self.last_usage = {
                        'prompt_tokens': getattr(chunk.usage, 'prompt_tokens', None),
                        'completion_tokens': getattr(chunk.usage, 'completion_tokens', None),
                        'total_tokens': getattr(chunk.usage, 'total_tokens', None),
                    }
            
            # If no usage in chunks, estimate from content length
            if not hasattr(self, 'last_usage') or not self.last_usage:
                # Rough estimation: assume prompt is similar size to messages
                estimated_prompt_tokens = sum(len(str(m.get('content', ''))) for m in messages) // 4
                self.last_usage = {
                    'prompt_tokens': estimated_prompt_tokens,
                    'completion_tokens': total_tokens,
                    'total_tokens': estimated_prompt_tokens + total_tokens,
                }
                
        except Exception as e:
            print(f"OpenAI streaming error (chat fallback): {e}")
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
        
        response = await self.client.messages.create(  # type: ignore[attr-defined]
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
        
        # Streaming API shape may vary; provide a simple non-streaming fallback for type safety
        response = await self.client.messages.create(  # type: ignore[attr-defined]
            model=self.model,
            max_tokens=kwargs.get("max_tokens", 1000),
            temperature=kwargs.get("temperature", 0.7),
            messages=[{"role": "user", "content": prompt}]
        )
        yield response.content[0].text


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
        # In-memory session conversations: session_id -> [messages]
        self.sessions: Dict[str, List[ChatCompletionMessageParam]] = {}
        # Session metadata for Responses chaining and budget tracking
        # { session_id: { 'last_response_id': str|None, 'approx_chars': int, 'approx_tokens': int } }
        self.session_meta: Dict[str, Dict[str, Any]] = {}
        # Default heuristic for model context budget (tokens)
        self.default_context_tokens = 128000

    def _get_or_init_session(self, session_id: Optional[str], system_prompt: str) -> Optional[List[ChatCompletionMessageParam]]:
        if not session_id:
            return None
        messages = self.sessions.get(session_id)
        if messages is None:
            messages = [cast(ChatCompletionMessageParam, {"role": "system", "content": system_prompt})]
            self.sessions[session_id] = messages
            self.session_meta[session_id] = {
                'last_response_id': None,
                'approx_chars': len(system_prompt or ""),
                'approx_tokens': 0,
            }
        return messages

    def _append_and_prune(self, session_id: Optional[str], role: str, content: str, max_chars: int = 80000) -> None:
        if not session_id:
            return
        messages = self.sessions.get(session_id)
        if messages is None:
            return
        messages.append(cast(ChatCompletionMessageParam, {"role": role, "content": content}))
        def total_len() -> int:
            return sum(len(str(m.get("content", ""))) for m in messages)
        # Naive pruning: keep system message, drop oldest after it until under threshold
        while total_len() > max_chars and len(messages) > 2:
            messages.pop(1)

    def _update_session_usage(self, session_id: Optional[str]):
        if not session_id:
            return
        meta = self.session_meta.get(session_id)
        if meta is None:
            return
        # Capture last response id from provider if present
        last_resp_id = getattr(self.provider, 'last_response_id', None)
        if last_resp_id:
            meta['last_response_id'] = last_resp_id
        # Accumulate token usage if available
        last_usage = getattr(self.provider, 'last_usage', None)
        if isinstance(last_usage, dict):
            pt = last_usage.get('prompt_tokens') or last_usage.get('input_tokens') or 0
            ct = last_usage.get('completion_tokens') or last_usage.get('output_tokens') or 0
            try:
                meta['approx_tokens'] = int(meta.get('approx_tokens', 0) or 0) + int((pt or 0) + (ct or 0))
            except Exception:
                pass

    def _get_previous_response_id(self, session_id: Optional[str]) -> Optional[str]:
        if not session_id:
            return None
        meta = self.session_meta.get(session_id) or {}
        val = meta.get('last_response_id')
        return val if isinstance(val, str) else None

    def _is_near_context_limit(self, session_id: Optional[str], threshold: float = 0.8) -> bool:
        if not session_id:
            return False
        meta = self.session_meta.get(session_id) or {}
        approx_tokens = int(meta.get('approx_tokens', 0) or 0)
        return approx_tokens > int(self.default_context_tokens * threshold)

    def get_session_stats(self, session_id: str) -> Dict[str, Any]:
        meta = self.session_meta.get(session_id) or {}
        return {
            "session_id": session_id,
            "last_response_id": meta.get('last_response_id'),
            "approx_tokens": int(meta.get('approx_tokens', 0) or 0),
            "approx_chars": int(meta.get('approx_chars', 0) or 0),
            "limit_tokens": int(self.default_context_tokens),
            "near_limit": self._is_near_context_limit(session_id),
        }
    
    def _create_provider(self, provider: str, **kwargs) -> Optional[LLMProvider]:
        """Create LLM provider instance."""
        print(f"Creating LLM provider: {provider}")
        
        if provider == "openai":
            api_key = kwargs.get("api_key") or os.getenv("OPENAI_API_KEY")
            model = kwargs.get("model", SearchConfig.get_default_llm_model())
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

    async def ask(self, question: str, context: str = "", session_id: Optional[str] = None, **kwargs) -> str:
        """General Q&A. Uses provider if available, otherwise a simple fallback."""
        system_prompt = (
            "You are Axon, an expert assistant for answering questions about code, "
            "notebook outputs, datasets, and results. Be concise and precise. "
            "Do not invent files or environments."
        )
        user_content = (
            f"Question: {question}\n\n" + (f"Context:\n{context}" if context else "")
        )

        if not self.provider:
            # Fallback simple echo with no LLM
            return (
                "(LLM unavailable) Here's a brief assessment based on the provided context.\n\n"
                + (f"Context summary: {context[:500]}...\n\n" if context else "")
                + f"Question: {question}"
            )

        try:
            session_msgs = self._get_or_init_session(session_id, system_prompt)
            if session_msgs is not None:
                self._append_and_prune(session_id, "user", user_content)
                response = await self.provider.generate(
                    session_msgs,
                    max_tokens=800,
                    temperature=0.2,
                    store=True,
                    previous_response_id=self._get_previous_response_id(session_id),
                )
                self._update_session_usage(session_id)
                self._append_and_prune(session_id, "assistant", response)
                return response
            else:
                response = await self.provider.generate(
                    [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content},
                    ],
                    max_tokens=800,
                    temperature=0.2,
                    store=True,
                )
                return response
        except Exception as e:
            print(f"LLMService.ask error: {e}")
            return "Sorry, I couldn't generate an answer right now. Please try again."

    async def ask_stream(self, question: str, context: str = "", session_id: Optional[str] = None, **kwargs):
        """Streaming Q&A. Yields text chunks from the provider.

        We hint the model to separate internal reasoning using <thinking> tags
        and place the user-visible response within <final>...</final>. The UI will
        ignore any <thinking> content and only display the final answer.
        """
        if not self.provider:
            # Fallback to non-streaming answer
            yield await self.ask(question, context, **kwargs)
            return

        system_prompt = (
            "You are Axon, an expert assistant.\n"
            "If you need to plan internally, you MAY use <thinking>...</thinking>.\n"
            "Place user-visible content inside <final>...</final>."
        )
        user_content = (
            f"Question: {question}\n\n" + (f"Context:\n{context}" if context else "")
        )

        try:
            session_msgs = self._get_or_init_session(session_id, system_prompt)
            total = ""
            if session_msgs is not None:
                self._append_and_prune(session_id, "user", user_content)
                async for chunk in self.provider.generate_stream(
                    session_msgs,
                    max_tokens=900,
                    temperature=0.2,
                    store=True,
                    previous_response_id=self._get_previous_response_id(session_id),
                ):
                    if chunk:
                        total += chunk
                        yield chunk
                self._update_session_usage(session_id)
                self._append_and_prune(session_id, "assistant", total)
            else:
                async for chunk in self.provider.generate_stream(
                    [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content},
                    ],
                    max_tokens=900,
                    temperature=0.2,
                    store=True,
                ):
                    if chunk:
                        yield chunk
        except Exception as e:
            yield f"(error) {e}"
    
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
        context: Optional[str] = None,
        session_id: Optional[str] = None
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
- Include only necessary imports actually used by the code
- Do NOT re-import packages already imported in the Context above
- Add comments for clarity
- Handle errors gracefully
- Follow Python best practices
- Respect any dataset access instructions found in CONTEXT. If CONTEXT specifies that data was
  already downloaded to a local folder (e.g., data_dir = Path('data')) or that dataset variables
  were preloaded, do not attempt to download files again. Load data exactly as instructed by CONTEXT.

Code:
"""
        
        try:
            system_prompt = "You are an expert Python programmer. Generate only code, no explanations."
            session_msgs = self._get_or_init_session(session_id, system_prompt)
            if session_msgs is not None:
                self._append_and_prune(session_id, "user", prompt)
                response = await self.provider.generate(
                    session_msgs,
                    max_tokens=2000,
                    temperature=0.1,
                    store=True,
                    previous_response_id=self._get_previous_response_id(session_id),
                )
                self._update_session_usage(session_id)
                self._append_and_prune(session_id, "assistant", response)
            else:
                response = await self.provider.generate([
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ], max_tokens=2000, temperature=0.1, store=True)
            return self.extract_python_code(response) or self._generate_fallback_code(task_description, language)
            
        except Exception as e:
            print(f"Error generating code: {e}")
            return self._generate_fallback_code(task_description, language)
    
    async def generate_code_stream(
        self, 
        task_description: str, 
        language: str = "python",
        context: Optional[str] = None,
        notebook_edit: bool = False,
        session_id: Optional[str] = None
    ):
        """Generate code with streaming for a given task description."""
        
        if not self.provider:
            # For fallback, yield the entire code at once
            fallback_code = self._generate_fallback_code(task_description, language)
            yield fallback_code
            return
        
        # Use different prompts for notebook edits vs full code generation
        if notebook_edit:
            prompt = f"""
You are editing a specific section of code in a Jupyter notebook. 

TASK: {task_description}
LANGUAGE: {language}

{f"CONTEXT: {context}" if context else ""}

CRITICAL RULES FOR NOTEBOOK EDITING:
1. Return ONLY the exact replacement code for the specified lines
2. Do NOT add imports, comments, or boilerplate code  
3. Do NOT include directory creation or setup code
4. Do NOT add explanations, markdown, or non-code text
5. Output ONLY the modified lines as plain {language} code
6. Preserve the exact structure and indentation of the original
7. Make ONLY the specific change requested

Generate the replacement code now:
"""
        else:
            # Enhanced prompt with better structure and examples for full code generation
            prompt = f"""
You are an expert Python programmer specializing in data analysis and bioinformatics.
Generate clean, well-documented, EXECUTABLE code for the following task.

TASK: {task_description}
LANGUAGE: {language}

{f"CONTEXT: {context}" if context else ""}

CRITICAL REQUIREMENTS:
1. Write ONLY executable Python code — NO explanations, markdown, or non-code text
2. Include only the imports actually used in your code
3. Do NOT re-import packages that are already imported in the CONTEXT
4. Add clear comments explaining each step
5. Handle errors gracefully with try-except blocks
6. Follow Python best practices
7. Make the code production-ready and biologically meaningful
8. Include print statements to show progress
9. Save outputs to appropriate directories (results/, figures/, etc.)
10. Use simple print formatting: print("Value:", value)
11. Ensure all strings are properly closed and escaped

DATASET ACCESS RULES (DEFER TO CONTEXT):
- If CONTEXT specifies how to access data (e.g., a 'DATA ACCESS CONTEXT' section, preloaded dataset
  variables, or 'data_dir = Path("data")' with specific filenames), you MUST follow that pattern.
- Do NOT download data again if previous steps already handled downloading or loading.
- For remote datasets: assume files are present under 'data/' as instructed by CONTEXT; verify file
  existence before reading; if missing, print a clear warning and continue without downloading.
- For local datasets: assume variables are already loaded when CONTEXT indicates so; do not rebuild
  paths or reload unless the TASK explicitly requests it.
- Only perform network downloads if the TASK explicitly states to download and CONTEXT does not
  already include download/setup code for the same data.

ERROR HANDLING:
- Wrap I/O in try-except blocks; print meaningful error messages
- Validate file existence and format before processing
- Continue execution when possible and report missing inputs clearly

CODE STRUCTURE:
1. Imports actually used (avoid duplicates w.r.t. CONTEXT)
2. Output directories
3. Helper functions (if needed)
4. Main execution code respecting CONTEXT data access
5. Save results and visualizations

EXAMPLE STRUCTURE:
```python
import os
from pathlib import Path

# Create output directories
results_dir = Path('results')
figures_dir = Path('figures')
results_dir.mkdir(exist_ok=True)
figures_dir.mkdir(exist_ok=True)

print("Starting analysis...")

try:
    # Your code here (load using CONTEXT-specified pattern)
    print("Analysis completed successfully!")
except Exception as e:
    print("Error:", e)
    raise
```

Generate the code now:
"""
        
        try:
            # Session-aware: build/extend the conversation
            system_prompt = "You are an expert Python programmer specializing in bioinformatics and data analysis. Generate ONLY executable Python code, importing only modules actually used. Do not re-import packages already present in the provided CONTEXT. Never include explanations, markdown, or non-code text. Avoid complex f-strings and ensure all syntax is correct. Always include error handling and proper directory structure."
            session_msgs = self._get_or_init_session(session_id, system_prompt)
            total = ""
            if session_msgs is not None:
                self._append_and_prune(session_id, "user", prompt)
                async for chunk in self.provider.generate_stream(
                    session_msgs,
                    max_tokens=3000,
                    temperature=0.1,
                    store=True,
                    previous_response_id=self._get_previous_response_id(session_id),
                ):
                    if chunk:
                        total += chunk
                        yield chunk
                self._update_session_usage(session_id)
                self._append_and_prune(session_id, "assistant", total)
            else:
                async for chunk in self.provider.generate_stream([
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ], max_tokens=3000, temperature=0.1, store=True):
                    yield chunk
                
        except Exception as e:
            print(f"Error generating streaming code: {e}")
            # Yield fallback code
            fallback_code = self._generate_fallback_code(task_description, language)
            yield fallback_code
    
    def validate_python_code(self, code: str) -> tuple[bool, str]:
        """Emergency fallback validation for Python code (basic AST check only)."""
        import ast
        
        if not code or not code.strip():
            return False, "Empty code"
        
        # Basic syntax validation only - frontend should handle detailed linting
        try:
            ast.parse(code)
            return True, "Basic syntax validation passed (frontend should handle detailed linting)"
        except SyntaxError as e:
            return False, f"Syntax error: {e}"
        except Exception as e:
            return False, f"AST parsing error: {e}"
        
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

    async def classify_intent(self, text: str, context: Optional[dict] = None) -> Dict[str, Any]:
        """Classify user intent into one of two actions for the app backend:
        - ADD_CELL: user wants to add/execute code in the current notebook
        - SEARCH_DATA: user wants to find/search/download datasets

        Prefer conservative behavior: default to ADD_CELL unless SEARCH intent is clear.
        """
        # 1) Try provider with strict, JSON-only contract
        if self.provider:
            try:
                system = (
                    "You classify user requests for a Jupyter-based data app into exactly one intent: "
                    "ADD_CELL, SEARCH_DATA, or START_ANALYSIS. Focus on the user's primary goal. "
                    "Return compact JSON only."
                )
                user = (
                    "Text: " + text + "\n\n"
                    "Rules:\n"
                    "- START_ANALYSIS if user wants to start, begin, run, or trigger analysis pipeline on existing data. This includes:\n"
                    "  * 'start analysis', 'begin analysis', 'run analysis', 'analyze this data'\n"
                    "  * 'start the pipeline', 'trigger analysis', 'run the analysis'\n" 
                    "  * 'let's analyze', 'begin processing', 'start processing'\n"
                    "  * Implies data is already loaded and ready for analysis\n"
                    "- SEARCH_DATA if user wants to find, search, browse, get, or download datasets/data. This includes:\n"
                    "  * 'find me [disease] data', 'get alzheimer data', 'search for cancer datasets'\n" 
                    "  * 'find data about X', 'look for X data', 'need data on X'\n"
                    "  * Mentions of diseases/conditions when seeking data (alzheimer, cancer, etc.)\n"
                    "  * References to data portals (GEO, GSE IDs, CellxCensus, Broad SCP)\n"
                    "- ADD_CELL for code/analysis tasks: write/run code, add notebook cell, plot, analyze existing data, compute, visualize.\n"
                    "- Priority order: START_ANALYSIS > SEARCH_DATA > ADD_CELL when ambiguous.\n\n"
                    "Respond as JSON: {\"intent\": \"ADD_CELL|SEARCH_DATA|START_ANALYSIS\", \"confidence\": 0.0-1.0, \"reason\": \"...\"}"
                )
                resp = await self.provider.generate(
                    [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    max_tokens=120,
                    temperature=0.0,
                )
                parsed = json.loads(resp)
                intent = str(parsed.get("intent", "ADD_CELL")).strip().upper()
                if intent not in ("ADD_CELL", "SEARCH_DATA", "START_ANALYSIS"):
                    intent = "ADD_CELL"
                conf = parsed.get("confidence")
                try:
                    confidence = float(conf)
                except Exception:
                    confidence = 0.6 if intent == "SEARCH_DATA" else 0.8
                reason = parsed.get("reason") or ("LLM classified as " + intent)
                return {"intent": intent, "confidence": confidence, "reason": reason}
            except Exception as e:
                print(f"LLM classify_intent failed, using rules: {e}")

        # 2) Fallback to deterministic rules
        return self._rule_intent(text)

    def _rule_intent(self, text: str) -> Dict[str, Any]:
        """Deterministic rule-based classifier for intent. Conservative default to ADD_CELL."""
        import re
        t = text.lower().strip()

        # Indicators for starting analysis pipeline - highest priority
        start_analysis_keywords = [
            "start analysis", "begin analysis", "run analysis", "trigger analysis",
            "start the analysis", "begin the analysis", "run the analysis",
            "start pipeline", "begin pipeline", "run pipeline", "trigger pipeline",
            "let's analyze", "let's start", "begin processing", "start processing",
            "analyze this", "analyze the data", "start analyzing", "begin analyzing",
        ]
        
        # Indicators for dataset search - more restrictive
        search_keywords = [
            "search for datasets", "find datasets", "browse datasets", "download datasets",
            "fetch datasets", "get datasets", "browse data", "search data",
            "cellxcensus", "single cell portal", "broad scp", "broad single cell",
            "data portal", "dataset portal", "metadataset",
            # More natural data search patterns
            "find me", "find data", "find some", "get me", "show me", "look for",
            "need data", "want data", "data about", "data on", "data for",
            # Disease and condition patterns
            "alzheimer", "cancer", "diabetes", "parkinsons", "disease data",
            "condition data", "disorder data", "syndrome data",
            # General data seeking patterns  
            "available data", "existing data", "public data", "open data",
        ]
        # Indicators for code/cell operations
        add_cell_keywords = [
            "add cell", "new cell", "insert cell", "write a cell", "create a cell",
            "write code", "run code", "execute", "plot", "visualize", "analysis", "analyze",
            "import", "load", "filter", "compute", "calculate", "draw", "matplotlib",
            "seaborn", "pandas", "numpy", "scanpy", "differential", "umap", "tsne",
        ]

        # Regex markers for GEO accessions etc.
        if re.search(r"\bGSE\d+\b", text, re.IGNORECASE):
            return {"intent": "SEARCH_DATA", "confidence": 0.9, "reason": "Explicit GEO accession present"}

        # Keyword checks
        def any_kw(kws: list[str]) -> bool:
            return any(kw in t for kw in kws)

        # Priority order: START_ANALYSIS > SEARCH_DATA > ADD_CELL
        if any_kw(start_analysis_keywords):
            return {"intent": "START_ANALYSIS", "confidence": 0.85, "reason": "Analysis start/trigger phrasing detected"}

        if any_kw(search_keywords):
            return {"intent": "SEARCH_DATA", "confidence": 0.75, "reason": "Search-oriented phrasing detected"}

        if any_kw(add_cell_keywords):
            return {"intent": "ADD_CELL", "confidence": 0.8, "reason": "Notebook/code action phrasing detected"}

        # Short/ambiguous inputs -> prefer ADD_CELL to avoid random searches
        if len(t) < 12 or len(t.split()) <= 2:
            return {"intent": "ADD_CELL", "confidence": 0.6, "reason": "Short/ambiguous query; defaulting to code"}

        # Default conservative choice
        return {"intent": "ADD_CELL", "confidence": 0.7, "reason": "Conservative default"}
    
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
