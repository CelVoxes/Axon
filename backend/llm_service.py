"""General-purpose LLM service for various tasks including search, code generation, and tool calling."""

import os
import asyncio
import json
import hashlib
from typing import List, Optional, Dict, Any, Union, Sequence, cast
import re
from abc import ABC, abstractmethod
from openai import AsyncOpenAI
from typing import TypedDict
import random
from .config import SearchConfig


class Message(TypedDict, total=False):
    role: str
    content: str


class LLMProvider(ABC):
    """Abstract base class for LLM providers."""
    
    @abstractmethod
    async def generate(self, messages: Sequence[Message], **kwargs) -> str:
        """Generate response from messages."""
        pass
    
    @abstractmethod
    async def generate_stream(self, messages: Sequence[Message], **kwargs):
        """Generate streaming response from messages."""
        yield ""


class OpenAIProvider(LLMProvider):
    """OpenAI provider implementation."""
    
    def __init__(
        self,
        api_key: str,
        model: Optional[str] = None,
        organization: Optional[str] = None,
        project: Optional[str] = None,
        service_tier: Optional[str] = None,
        timeout: Optional[float] = None,
    ):
        # Initialize OpenAI client with optional organization/project for project-scoped keys
        client_timeout = float(timeout) if isinstance(timeout, (int, float)) else float(SearchConfig.get_openai_timeout_seconds())
        self.client = AsyncOpenAI(
            api_key=api_key,
            organization=organization if organization else None,
            project=project if project else None,
            timeout=client_timeout,
        )
        default_model = SearchConfig.get_default_llm_model()
        self.model = model if isinstance(model, str) and model else (default_model if isinstance(default_model, str) and default_model else "gpt-4o-mini")
        self.last_usage = None
        cfg_tier = SearchConfig.get_openai_service_tier()
        self.service_tier = (service_tier or cfg_tier or "").strip()
        self.last_reasoning_summary: Optional[str] = None
        # Map logical session ids to OpenAI Responses session metadata
        self._responses_sessions: Dict[str, Dict[str, str]] = {}
    
    def _prepare_kwargs(self, kwargs: dict) -> dict:
        """Prepare kwargs for OpenAI API, handling model-specific parameter differences."""
        prepared_kwargs = kwargs.copy()

        # Handle gpt-5-mini restrictions
        if self._is_gpt5_mini():
            # Remove unsupported parameters for gpt-5-mini
            prepared_kwargs.pop("max_tokens", None)
            prepared_kwargs.pop("temperature", None)  # Only supports temperature=1 (default)
            # Note: max_completion_tokens would be used but current client doesn't support it

        # Remove reasoning parameters for models that don't support them
        ml = (self.model or "").lower()
        if not (("gpt-5" in ml) or ("o3" in ml)):
            prepared_kwargs.pop("reasoning", None)

        return prepared_kwargs
    
    def _prepare_responses_kwargs(self, kwargs: dict) -> dict:
        """Prepare kwargs specifically for Responses API, which has different parameter support."""
        prepared_kwargs = kwargs.copy()

        # The Responses API doesn't support max_tokens parameter
        prepared_kwargs.pop("max_tokens", None)

        # Filter out other parameters that Responses API might not support
        prepared_kwargs.pop("messages", None)  # Already handled separately
        prepared_kwargs.pop("session_id", None)

        # Remove reasoning parameters for models that don't support them
        ml = (self.model or "").lower()
        if not (("gpt-5" in ml) or ("o3" in ml)):
            prepared_kwargs.pop("reasoning", None)

        # Inject default service_tier if configured and not overridden
        if not prepared_kwargs.get("service_tier") and getattr(self, "service_tier", ""):
            tier = self.service_tier
            if tier == "flex":
                # Only set flex when model supports it
                if ("gpt-5" in ml) or ("o3" in ml) or ("o4-mini" in ml):
                    prepared_kwargs["service_tier"] = tier
            else:
                prepared_kwargs["service_tier"] = tier

        # Encourage models with reasoning capability to emit lightweight reasoning deltas.
        # Do NOT inject unsupported 'include' values. Only set a gentle default for reasoning effort/summary.
        # Only add reasoning parameters if the model supports them (after filtering out unsupported ones above)
        if ("gpt-5" in ml) or ("o3" in ml):
            if not prepared_kwargs.get("reasoning"):
                prepared_kwargs["reasoning"] = {"effort": "medium", "summary": "detailed"}
            else:
                if isinstance(prepared_kwargs["reasoning"], dict):
                    prepared_kwargs["reasoning"].setdefault("effort", "medium")
                    prepared_kwargs["reasoning"].setdefault("summary", "detailed")

        return prepared_kwargs

    async def _ensure_responses_session(
        self,
        session_key: Optional[str],
        model: str,
        system_prompt: str,
    ) -> Optional[str]:
        """Ensure a Responses API session exists for the given logical session id."""

        if not session_key:
            return None

        try:
            normalized_key = str(session_key).strip()
        except Exception:
            normalized_key = None

        if not normalized_key:
            return None

        responses_api = getattr(self.client, "responses", None)
        if responses_api is None:
            return None

        sessions_api = getattr(responses_api, "sessions", None)
        if sessions_api is None or not hasattr(sessions_api, "create"):
            return None

        normalized_prompt = (system_prompt or "").strip()
        instructions_hash = ""
        if normalized_prompt:
            try:
                instructions_hash = hashlib.sha256(normalized_prompt.encode("utf-8")).hexdigest()
            except Exception:
                instructions_hash = normalized_prompt[:128]

        cached = self._responses_sessions.get(normalized_key)
        if cached:
            cached_id = cached.get("id")
            cached_model = cached.get("model")
            cached_hash = cached.get("instructions_hash")
            if cached_id and cached_model == model and cached_hash == instructions_hash:
                return cached_id
            # Model or instructions changed – drop cached entry so we can recreate the session
            self._responses_sessions.pop(normalized_key, None)

        try:
            create_kwargs = {"model": model}
            if normalized_prompt:
                create_kwargs["instructions"] = normalized_prompt
            session_obj = await sessions_api.create(**create_kwargs)
        except TypeError:
            # Some SDK builds may not accept the instructions parameter; retry without it.
            try:
                session_obj = await sessions_api.create(model=model)
            except Exception:
                return None
        except Exception:
            return None

        session_id = getattr(session_obj, "id", None)
        if session_id is None and isinstance(session_obj, dict):
            session_id = session_obj.get("id")

        if not session_id:
            return None

        if len(self._responses_sessions) >= 64:
            try:
                self._responses_sessions.pop(next(iter(self._responses_sessions)))
            except Exception:
                self._responses_sessions.clear()

        self._responses_sessions[normalized_key] = {
            "id": session_id,
            "model": model,
            "instructions_hash": instructions_hash,
        }

        return session_id

    def _build_session_scoped_input(
        self,
        messages: Sequence[Message],
        session_identifier: Optional[str],
    ) -> List[Message]:
        """Trim repeated context when Responses sessions already retain memory."""
        if not session_identifier:
            return list(messages)
        try:
            trimmed: List[Message] = []
            for message in reversed(messages):
                role = str(message.get("role", "")).lower()
                trimmed.insert(
                    0,
                    cast(
                        Message,
                        dict(message),
                    ),
                )
                if role == "user":
                    break
            trimmed = [m for m in trimmed if str(m.get("role", "")).lower() != "system"]
            if trimmed:
                return trimmed
        except Exception:
            pass
        return list(messages)
    
    def _is_gpt5_mini(self) -> bool:
        """Check if the model is gpt-5-mini."""
        return "gpt-5-mini" in self.model.lower()

    
    async def generate(self, messages: Sequence[Message], **kwargs) -> str:
        """Generate with Responses API when available, else fall back to Chat Completions."""
        prepared_kwargs = self._prepare_kwargs(kwargs)
        # Support per-call model override without mutating provider default
        model_override = prepared_kwargs.pop("model", None)
        chosen_model = model_override or self.model

        raw_session_key = prepared_kwargs.pop("session_id", None)
        if isinstance(raw_session_key, str):
            session_key = raw_session_key.strip() or None
        elif raw_session_key is not None:
            session_key = str(raw_session_key).strip() or None
        else:
            session_key = None

        system_prompt = ""
        if messages:
            first_msg = messages[0]
            if isinstance(first_msg, dict) and first_msg.get("role") == "system":
                try:
                    system_prompt = str(first_msg.get("content", ""))
                except Exception:
                    system_prompt = ""

        # Try Responses API first
        try:
            responses_api = getattr(self.client, "responses", None)
            if responses_api is not None and hasattr(responses_api, "create"):
                # The Responses API can accept message-style input
                responses_kwargs = self._prepare_responses_kwargs(prepared_kwargs)
                session_identifier = None
                if session_key:
                    session_identifier = await self._ensure_responses_session(
                        session_key,
                        chosen_model,
                        system_prompt,
                    )

                async def _do_request(override_tier: Optional[str] = None):
                    kwargs_local = dict(responses_kwargs)
                    if override_tier:
                        kwargs_local["service_tier"] = override_tier
                    if session_identifier:
                        kwargs_local.setdefault("session", session_identifier)
                    input_messages = self._build_session_scoped_input(messages, session_identifier)
                    return await responses_api.create(
                        model=chosen_model,
                        input=list(input_messages),
                        **kwargs_local
                    )

                st = responses_kwargs.get("service_tier")
                try:
                    resp = await _do_request()
                except Exception as e:
                    status = getattr(e, "status_code", None)
                    is_429 = (status == 429) or ("429" in str(getattr(e, "status", ""))) or ("429" in str(e))
                    if is_429 and st == "flex":
                        # Retry with exponential backoff on flex, then fall back to auto
                        resp = None
                        for i in range(3):
                            await asyncio.sleep((2 ** i) + random.random() * 0.25)
                            try:
                                resp = await _do_request("flex")
                                break
                            except Exception:
                                resp = None
                        if resp is None:
                            # Fallback to standard processing
                            resp = await _do_request("auto")
                    else:
                        raise
                # Best-effort extraction of text
                text = None
                try:
                    text = getattr(resp, "output_text", None)
                except Exception:
                    text = None
                # Extract reasoning summary if present
                try:
                    self.last_reasoning_summary = None
                    if hasattr(resp, "output"):
                        for item in getattr(resp, "output", []) or []:
                            if getattr(item, "type", None) == "reasoning":
                                # summary may be a list of blocks with .text
                                summary_list = getattr(item, "summary", None)
                                if isinstance(summary_list, (list, tuple)):
                                    parts: List[str] = []
                                    for s in summary_list:
                                        t = None
                                        try:
                                            t = getattr(s, "text", None)
                                        except Exception:
                                            t = None
                                        if t is None and isinstance(s, dict):
                                            t = s.get("text")
                                        if isinstance(t, str) and t:
                                            parts.append(t)
                                    if parts:
                                        self.last_reasoning_summary = "".join(parts).strip() or None
                                # If no summary_list, ignore
                except Exception:
                    self.last_reasoning_summary = None

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
            print(
                f"Responses API (non-stream) error: {self._redact_api_keys(str(e))}"
            )
        # If Responses failed and we didn't return text, raise to caller
        raise RuntimeError("OpenAI Responses API request failed; see logs for details")
    
    async def generate_stream(self, messages: Sequence[Message], **kwargs):
        """Generate streaming response using Responses API when available, else Chat Completions."""
        prepared_kwargs = self._prepare_kwargs(kwargs)
        # Support per-call model override without mutating provider default
        model_override = prepared_kwargs.pop("model", None)
        chosen_model = model_override or self.model

        raw_session_key = prepared_kwargs.pop("session_id", None)
        if isinstance(raw_session_key, str):
            session_key = raw_session_key.strip() or None
        elif raw_session_key is not None:
            session_key = str(raw_session_key).strip() or None
        else:
            session_key = None

        system_prompt = ""
        if messages:
            first_msg = messages[0]
            if isinstance(first_msg, dict) and first_msg.get("role") == "system":
                try:
                    system_prompt = str(first_msg.get("content", ""))
                except Exception:
                    system_prompt = ""

        # Try Responses streaming first
        try:
            responses_api = getattr(self.client, "responses", None)
            if responses_api is not None:
                session_identifier = None
                if session_key:
                    session_identifier = await self._ensure_responses_session(
                        session_key,
                        chosen_model,
                        system_prompt,
                    )
                # Prefer the streaming helper if available
                if hasattr(responses_api, "stream"):
                    try:
                        responses_kwargs = self._prepare_responses_kwargs(prepared_kwargs)

                        def _mk_stream_ctx(override_tier: Optional[str] = None):
                            kwargs_local = dict(responses_kwargs)
                            if override_tier:
                                kwargs_local["service_tier"] = override_tier
                            if session_identifier:
                                kwargs_local.setdefault("session", session_identifier)
                            input_messages = self._build_session_scoped_input(messages, session_identifier)
                            return responses_api.stream(
                                model=chosen_model,
                                input=list(input_messages),
                                **kwargs_local
                            )

                        stream_ctx = _mk_stream_ctx()
                        # The SDK streaming is an async context manager in recent versions
                        async with stream_ctx as stream:
                            total_text = ""
                            # reset last reasoning summary for this request
                            self.last_reasoning_summary = None
                            async for event in stream:
                                etype = getattr(event, "type", "")
                                # Emit text (output) deltas only
                                delta = getattr(event, "delta", None)
                                if delta and (etype.endswith("output_text.delta") or "output_text" in etype):
                                    # Robustly extract text from delta across SDK shapes
                                    s = None
                                    try:
                                        s = getattr(delta, "text", None)
                                    except Exception:
                                        s = None
                                    if s is None:
                                        try:
                                            # Some SDKs represent delta as dict-like
                                            s = delta.get("text") if hasattr(delta, "get") else None
                                        except Exception:
                                            s = None
                                    if s is None and isinstance(delta, str):
                                        s = delta
                                    if s:
                                        s = str(s)
                                        total_text += s
                                        yield s
                                # Emit reasoning deltas if present
                                if delta and (etype.endswith("reasoning.delta") or "reasoning" in etype):
                                    rs = None
                                    # Some SDKs shape delta as { reasoning: { text: ... } }
                                    try:
                                        rs = getattr(delta, "text", None)
                                    except Exception:
                                        rs = None
                                    if rs is None and hasattr(delta, "get"):
                                        try:
                                            # Attempt nested extraction
                                            nested = delta.get("reasoning") if hasattr(delta, "get") else None
                                            if nested is not None and hasattr(nested, "get"):
                                                rs = nested.get("text")
                                            if rs is None:
                                                rs = delta.get("text")
                                        except Exception:
                                            rs = None
                                    if rs is None and isinstance(delta, str):
                                        rs = delta
                                    if rs:
                                        rs = str(rs)
                                        # Use a sentinel prefix to mark reasoning events for the API layer
                                        yield "\x00REASONING:" + rs
                                # Capture reasoning summary if included with the response
                                try:
                                    resp_obj = getattr(event, "response", None)
                                    if resp_obj is not None and hasattr(resp_obj, "output"):
                                        for item in getattr(resp_obj, "output", []) or []:
                                            if getattr(item, "type", None) == "reasoning":
                                                summary_list = getattr(item, "summary", None)
                                                if isinstance(summary_list, (list, tuple)):
                                                    parts: List[str] = []
                                                    for s in summary_list:
                                                        t = None
                                                        try:
                                                            t = getattr(s, "text", None)
                                                        except Exception:
                                                            t = None
                                                        if t is None and isinstance(s, dict):
                                                            t = s.get("text")
                                                        if isinstance(t, str) and t:
                                                            parts.append(t)
                                                    if parts:
                                                        self.last_reasoning_summary = "".join(parts).strip() or None
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
                        status = getattr(e, "status_code", None)
                        is_429 = (status == 429) or ("429" in str(getattr(e, "status", ""))) or ("429" in str(e))
                        st = prepared_kwargs.get("service_tier") or getattr(self, "service_tier", None)
                        if is_429 and st == "flex":
                            # retry with backoff on flex
                            for i in range(3):
                                await asyncio.sleep((2 ** i) + random.random() * 0.25)
                                try:
                                    async with _mk_stream_ctx("flex") as stream:
                                        total_text = ""
                                        async for event in stream:
                                            etype = getattr(event, "type", "")
                                            delta = getattr(event, "delta", None)
                                            if delta and ("output_text" in etype or etype.endswith(".delta")):
                                                s = getattr(delta, "text", None) if hasattr(delta, "text") else (delta.get("text") if hasattr(delta, "get") else (delta if isinstance(delta, str) else None))
                                                if s:
                                                    s = str(s)
                                                    total_text += s
                                                    yield s
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
                                except Exception:
                                    pass
                            # fallback to standard processing
                            try:
                                async with _mk_stream_ctx("auto") as stream:
                                    total_text = ""
                                    async for event in stream:
                                        etype = getattr(event, "type", "")
                                        delta = getattr(event, "delta", None)
                                        if delta and ("output_text" in etype or etype.endswith(".delta")):
                                            s = getattr(delta, "text", None) if hasattr(delta, "text") else (delta.get("text") if hasattr(delta, "get") else (delta if isinstance(delta, str) else None))
                                            if s:
                                                s = str(s)
                                                total_text += s
                                                yield s
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
                            except Exception:
                                pass
                        print(
                            f"Responses API .stream failed, trying create(stream=True): {self._redact_api_keys(str(e))}"
                        )

                if hasattr(responses_api, "create"):
                    responses_kwargs = self._prepare_responses_kwargs(prepared_kwargs)

                    async def _do_stream_request(override_tier: Optional[str] = None):
                        kwargs_local = dict(responses_kwargs)
                        if override_tier:
                            kwargs_local["service_tier"] = override_tier
                        if session_identifier:
                            kwargs_local.setdefault("session", session_identifier)
                        input_messages = self._build_session_scoped_input(messages, session_identifier)
                        return await responses_api.create(
                            model=chosen_model,
                            input=list(input_messages),
                            stream=True,
                            **kwargs_local
                        )

                    try:
                        resp_stream = await _do_stream_request()
                    except Exception as e:
                        status = getattr(e, "status_code", None)
                        is_429 = (status == 429) or ("429" in str(getattr(e, "status", ""))) or ("429" in str(e))
                        st = responses_kwargs.get("service_tier")
                        if is_429 and st == "flex":
                            resp_stream = None
                            for i in range(3):
                                await asyncio.sleep((2 ** i) + random.random() * 0.25)
                                try:
                                    resp_stream = await _do_stream_request("flex")
                                    break
                                except Exception:
                                    resp_stream = None
                            if resp_stream is None:
                                resp_stream = await _do_stream_request("auto")
                        else:
                            raise
                    total_text = ""
                    self.last_reasoning_summary = None
                    async for event in resp_stream:
                        etype = getattr(event, "type", "")
                        delta = getattr(event, "delta", None)
                        # Output text deltas only
                        if delta and (etype.endswith("output_text.delta") or "output_text" in etype):
                            s = None
                            try:
                                s = getattr(delta, "text", None)
                            except Exception:
                                s = None
                            if s is None:
                                try:
                                    s = delta.get("text") if hasattr(delta, "get") else None
                                except Exception:
                                    s = None
                            if s is None and isinstance(delta, str):
                                s = delta
                            if s:
                                s = str(s)
                                total_text += s
                                yield s
                        # Emit reasoning deltas if present
                        if delta and (etype.endswith("reasoning.delta") or "reasoning" in etype):
                            rs = None
                            try:
                                rs = getattr(delta, "text", None)
                            except Exception:
                                rs = None
                            if rs is None and hasattr(delta, "get"):
                                try:
                                    nested = delta.get("reasoning") if hasattr(delta, "get") else None
                                    if nested is not None and hasattr(nested, "get"):
                                        rs = nested.get("text")
                                    if rs is None:
                                        rs = delta.get("text")
                                except Exception:
                                    rs = None
                            if rs is None and isinstance(delta, str):
                                rs = delta
                            if rs:
                                rs = str(rs)
                                yield "\x00REASONING:" + rs
                        try:
                            resp_obj = getattr(event, "response", None)
                            if resp_obj is not None and hasattr(resp_obj, "output"):
                                for item in getattr(resp_obj, "output", []) or []:
                                    if getattr(item, "type", None) == "reasoning":
                                        summary_list = getattr(item, "summary", None)
                                        if isinstance(summary_list, (list, tuple)):
                                            parts: List[str] = []
                                            for s in summary_list:
                                                t = None
                                                try:
                                                    t = getattr(s, "text", None)
                                                except Exception:
                                                    t = None
                                                if t is None and isinstance(s, dict):
                                                    t = s.get("text")
                                                if isinstance(t, str) and t:
                                                    parts.append(t)
                                            if parts:
                                                self.last_reasoning_summary = "".join(parts).strip() or None
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
            print(f"OpenAI Responses streaming error: {self._redact_api_keys(str(e))}")
            # Return a simple fallback message (with sanitized error)
            safe_err = self._redact_api_keys(str(e))
            yield f"# Error: Could not stream response due to: {safe_err}"

    @staticmethod
    def _redact_api_keys(message: str) -> str:
        """Redact any api-like tokens (sk-*) from error/log messages."""
        if not isinstance(message, str):
            return message
        try:
            return re.sub(r"sk-[A-Za-z0-9_\-]{10,}", "sk-****redacted****", message)
        except Exception:
            return message


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
        self.sessions: Dict[str, List[Message]] = {}
        # Session metadata used for usage tracking and budgeting
        # { session_id: { 'approx_chars': int, 'approx_tokens': int, 'model': Optional[str] } }
        self.session_meta: Dict[str, Dict[str, Any]] = {}
        # Track last seeded context hash per session to avoid resending identical blobs
        self._session_context_hash: Dict[str, str] = {}
        # Default heuristic for model context budget (tokens). Final per-session
        # limit is computed dynamically based on the active model.
        from .config import SearchConfig
        try:
            mdl = getattr(self, "provider", None)
            # Prefer provider.model when available; otherwise use configured default
            current_model = None
            try:
                current_model = getattr(mdl, "model", None)
            except Exception:
                current_model = None
            self.default_context_tokens = int(SearchConfig.get_model_context_tokens(current_model))
        except Exception:
            # Safe fallback
            self.default_context_tokens = 128000
        # Debug flags (opt-in via env)
        self._debug_enabled = str(os.getenv("AXON_LLM_DEBUG", "")).lower() in ("1", "true", "yes", "on")
        self._stats_debug_enabled = str(os.getenv("AXON_LLM_STATS_DEBUG", "")).lower() in ("1", "true", "yes", "on")

    def _debug(self, msg: str):
        if self._debug_enabled:
            print(msg)

    def _debug_stats(self, msg: str):
        if self._stats_debug_enabled:
            print(msg)

    def _get_or_init_session(self, session_id: Optional[str], system_prompt: str) -> Optional[List[Message]]:
        if not session_id:
            return None
        messages = self.sessions.get(session_id)
        if messages is None:
            messages = [cast(Message, {"role": "system", "content": system_prompt})]
            self.sessions[session_id] = messages
            self.session_meta[session_id] = {
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
        messages.append(cast(Message, {"role": role, "content": content}))
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
        # Accumulate token usage if available
        last_usage = getattr(self.provider, 'last_usage', None)
        if isinstance(last_usage, dict):
            pt = last_usage.get('prompt_tokens') or last_usage.get('input_tokens') or 0
            ct = last_usage.get('completion_tokens') or last_usage.get('output_tokens') or 0
            prev_tokens = int(meta.get('approx_tokens', 0) or 0)
            new_tokens = int((pt or 0) + (ct or 0))
            total_tokens = prev_tokens + new_tokens
            try:
                meta['approx_tokens'] = total_tokens
            except Exception:
                pass

    def _should_include_context(self, session_id: Optional[str], context: Optional[str]) -> bool:
        if not session_id:
            return False
        if not isinstance(context, str) or not context.strip():
            return False
        try:
            h = hashlib.sha256(context.encode('utf-8')).hexdigest()
            last = self._session_context_hash.get(session_id)
            return h != last
        except Exception:
            return True

    def _record_context_hash(self, session_id: Optional[str], context: Optional[str]) -> None:
        if not session_id:
            return
        if not isinstance(context, str) or not context:
            return
        try:
            h = hashlib.sha256(context.encode('utf-8')).hexdigest()
            self._session_context_hash[session_id] = h
        except Exception:
            pass

    def _build_minimal_messages(
        self,
        session_id: Optional[str],
        system_prompt: str,
        user_content: str,
    ) -> List[Message]:
        """
        Build a minimal input message list for the provider to reduce prompt bloat.
        Always seed with a system prompt followed by the current user request so we
        never rely on provider-side response chaining.
        """
        system_message = cast(Message, {"role": "system", "content": system_prompt})

        if not session_id:
            return [system_message, cast(Message, {"role": "user", "content": user_content})]

        history = self.sessions.get(session_id)
        if not history:
            return [system_message, cast(Message, {"role": "user", "content": user_content})]

        # Rebuild the stored conversation, refreshing the system prompt while keeping
        # prior assistant/user turns that were cached via _append_and_prune.
        reconstructed: List[Message] = []
        for idx, msg in enumerate(history):
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if idx == 0 and role == "system":
                # Ensure we honor the call-site system prompt (may differ slightly)
                reconstructed.append(system_message)
            else:
                reconstructed.append(
                    cast(Message, {"role": role, "content": content})
                )

        if not reconstructed or reconstructed[0].get("role") != "system":
            reconstructed.insert(0, system_message)

        # Ensure the current user request is present even for helper calls that did
        # not persist the turn into session history (e.g., lightweight classifiers).
        if not reconstructed or reconstructed[-1].get("role") != "user" or reconstructed[-1].get("content") != user_content:
            reconstructed.append(cast(Message, {"role": "user", "content": user_content}))

        return reconstructed

    def _resolve_session_limit_tokens(self, session_id: Optional[str]) -> int:
        """Return the per-session context-token limit based on the session's active model.

        Falls back to the instance default if model cannot be resolved.
        """
        try:
            from .config import SearchConfig
            # Resolve a model preference stored in session meta or on provider
            model_name = None
            if session_id and session_id in self.session_meta:
                meta = self.session_meta.get(session_id) or {}
                m = meta.get('model')
                if isinstance(m, str) and m:
                    model_name = m
            if not model_name:
                try:
                    model_name = getattr(self.provider, 'model', None)
                except Exception:
                    model_name = None
            limit = int(SearchConfig.get_model_context_tokens(model_name))
            return limit
        except Exception:
            return int(self.default_context_tokens)

    def _is_near_context_limit(self, session_id: Optional[str], threshold: float = 0.8) -> bool:
        if not session_id:
            return False
        meta = self.session_meta.get(session_id) or {}
        approx_tokens = int(meta.get('approx_tokens', 0) or 0)
        limit_tokens = self._resolve_session_limit_tokens(session_id)
        return approx_tokens > int(limit_tokens * threshold)

    def get_last_reasoning_summary(self) -> Optional[str]:
        try:
            return getattr(self.provider, 'last_reasoning_summary', None)
        except Exception:
            return None

    def get_session_stats(self, session_id: str) -> Dict[str, Any]:
        # Optional debug: Print what we're looking for and what we have
        self._debug_stats(f"📊 LLM Service: get_session_stats - Looking for: {session_id}")
        self._debug_stats(f"📊 LLM Service: Available sessions: {list(self.session_meta.keys())}")
        
        # First try exact match
        meta = self.session_meta.get(session_id)
        if meta is not None:
            tokens = int(meta.get('approx_tokens', 0) or 0)
            self._debug_stats(f"📊 LLM Service: Found exact match with {tokens} tokens")
            return {
                "session_id": session_id,
                "approx_tokens": tokens,
                "approx_chars": int(meta.get('approx_chars', 0) or 0),
                "limit_tokens": int(self._resolve_session_limit_tokens(session_id)),
                "near_limit": self._is_near_context_limit(session_id),
            }
        
        # If no exact match, optionally attempt smart matching.
        # IMPORTANT: For specific chat sessions (chatId != 'global'), we return zeros instead of
        # borrowing usage from other sessions. This prevents a new chat from inheriting prior usage.
        if ':' in session_id:
            parts = session_id.split(':')
            chat_id_suffix = parts[-1]
            base_prefix = ':'.join(parts[:-1]) if len(parts) > 1 else session_id

            # Strict behavior for per-chat sessions: if this chat hasn't produced any LLM calls yet,
            # do NOT fallback to other sessions. Show zero until this session accumulates usage.
            if isinstance(chat_id_suffix, str) and chat_id_suffix.lower() != 'global':
                self._debug_stats("📊 LLM Service: No exact stats for per-chat session; returning zeros (no fallback)")
                return {
                    "session_id": session_id,
                    "approx_tokens": 0,
                    "approx_chars": 0,
                    "limit_tokens": int(self.default_context_tokens),
                    "near_limit": False,
                }

            self._debug_stats(f"📊 LLM Service: Looking for sessions matching chat suffix: {chat_id_suffix} or base prefix: {base_prefix}")
            best_match = None
            max_tokens = 0

            for existing_session_id, session_meta in self.session_meta.items():
                tokens = int(session_meta.get('approx_tokens', 0) or 0)
                self._debug_stats(f"📊 LLM Service: Checking session: {existing_session_id} (tokens: {tokens})")

                if existing_session_id.endswith(chat_id_suffix) or chat_id_suffix in existing_session_id:
                    self._debug_stats(f"📊 LLM Service: Found chat suffix match: {existing_session_id} with {tokens} tokens")
                elif existing_session_id.startswith(base_prefix):
                    self._debug_stats(f"📊 LLM Service: Found base prefix match: {existing_session_id} with {tokens} tokens")
                else:
                    continue

                if tokens > max_tokens:
                    max_tokens = tokens
                    best_match = (existing_session_id, session_meta)

            if best_match:
                best_session_id, best_meta = best_match
                tokens = int(best_meta.get('approx_tokens', 0) or 0)
                self._debug_stats(f"📊 LLM Service: Using best match: {best_session_id} with {tokens} tokens")
                return {
                    "session_id": best_session_id,
                    "approx_tokens": tokens,
                    "approx_chars": int(best_meta.get('approx_chars', 0) or 0),
                    "limit_tokens": int(self._resolve_session_limit_tokens(best_session_id)),
                    "near_limit": self._is_near_context_limit(best_session_id),
                }
        
        self._debug_stats(f"📊 LLM Service: No match found, returning empty stats")
        # No match found, return empty stats for the requested session
        return {
            "session_id": session_id,
            "approx_tokens": 0,
            "approx_chars": 0,
            "limit_tokens": int(self._resolve_session_limit_tokens(session_id)),
            "near_limit": False,
        }

    def _resolve_model(self, session_id: Optional[str], requested_model: Optional[str]) -> Optional[str]:
        """Choose a model for this call, tracking per-session model preference.

        - If a session_id is provided and a requested_model is given, store it for the session and use it.
        - If a session_id is provided and no model is given, reuse the stored session model if present.
        - Otherwise, return the requested_model (which may be None) and let the provider default apply.
        """
        if not session_id:
            return requested_model
        meta = self.session_meta.get(session_id)
        if meta is None:
            # Initialize a minimal meta entry if needed
            self.session_meta[session_id] = {
                'approx_chars': 0,
                'approx_tokens': 0,
            }
            meta = self.session_meta[session_id]
        if requested_model:
            meta['model'] = requested_model
            return requested_model
        stored = meta.get('model')
        return stored if isinstance(stored, str) else requested_model
    
    def _create_provider(self, provider: str, **kwargs) -> Optional[LLMProvider]:
        """Create LLM provider instance."""
        print(f"Creating LLM provider: {provider}")
        
        if provider == "openai":
            api_key = kwargs.get("api_key") or os.getenv("OPENAI_API_KEY")
            # Normalize common formatting issues (quotes/newlines/spaces/zero-width chars)
            if isinstance(api_key, str):
                api_key = api_key.strip()
                # Remove surrounding quotes if present
                if (api_key.startswith('"') and api_key.endswith('"')) or (
                    api_key.startswith("'") and api_key.endswith("'")
                ):
                    api_key = api_key[1:-1].strip()
                # Strip any embedded newlines or carriage returns
                api_key = api_key.replace("\n", "").replace("\r", "")
                # Remove zero-width and BOM characters that sometimes sneak in from copy/paste
                try:
                    import re as _re
                    api_key = _re.sub(r"[\u200B-\u200D\uFEFF]", "", api_key)
                except Exception:
                    pass
            model = kwargs.get("model", SearchConfig.get_default_llm_model())
            print(f"OpenAI API key found: {bool(api_key)}")
            if api_key:
                # Optional organization/project support for project-scoped keys
                organization = (
                    kwargs.get("organization")
                    or os.getenv("OPENAI_ORG")
                    or os.getenv("OPENAI_ORGANIZATION")
                )
                project = kwargs.get("project") or os.getenv("OPENAI_PROJECT")
                if organization:
                    print("Using OpenAI organization from env/config")
                if project:
                    print("Using OpenAI project from env/config")
                print(f"Creating OpenAI provider with model: {model}")
                return OpenAIProvider(
                    api_key,
                    model,
                    organization=organization,
                    project=project,
                    service_tier=SearchConfig.get_openai_service_tier(),
                    timeout=float(SearchConfig.get_openai_timeout_seconds()),
                )
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

    @staticmethod
    def _redact_api_keys(message: str) -> str:
        """Redact any api-like tokens (sk-*) from error/log messages."""
        if not isinstance(message, str):
            return message
        try:
            # Replace long sk- tokens with a safe placeholder
            return re.sub(r"sk-[A-Za-z0-9_\-]{10,}", "sk-****redacted****", message)
        except Exception:
            return message

    async def generate(self, messages: Sequence[Message], **kwargs) -> str:
        """Generate response from messages using the configured provider."""
        if not self.provider:
            raise RuntimeError("No LLM provider configured")
        return await self.provider.generate(messages, **kwargs)

    async def ask(self, question: str, context: str = "", session_id: Optional[str] = None, model: Optional[str] = None, **kwargs) -> str:
        """General Q&A. Uses provider if available, otherwise a simple fallback."""
        system_prompt = (
            "You are Axon, an expert assistant for answering questions about code, "
            "notebook outputs, datasets, and results. Be concise and precise. "
            "Do not invent files or environments."
        )
        # Include context only when needed to avoid prompt bloat; rely on Responses chaining otherwise
        include_context = self._should_include_context(session_id, context)
        ctx_text = context if include_context else None
        user_content = (
            f"Question: {question}\n\n" + (f"Context:\n{ctx_text}" if ctx_text else "")
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
            resolved_model = self._resolve_model(session_id, model)
            if session_msgs is not None:
                self._append_and_prune(session_id, "user", user_content)
                minimal_msgs = self._build_minimal_messages(session_id, system_prompt, user_content)
                response = await self.provider.generate(
                    minimal_msgs,
                    max_tokens=3000,  # Increased for detailed summaries (was 800)
                    temperature=0.2,
                    store=True,
                    model=resolved_model,
                )
                self._update_session_usage(session_id)
                if include_context:
                    self._record_context_hash(session_id, context)
                self._append_and_prune(session_id, "assistant", response)
                return response
            else:
                response = await self.provider.generate(
                    [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content},
                    ],
                    max_tokens=3000,  # Increased for detailed summaries (was 800)
                    temperature=0.2,
                    store=True,
                    model=resolved_model,
                )
                if include_context:
                    self._record_context_hash(session_id, context)
                return response
        except Exception as e:
            print(f"LLMService.ask error: {e}")
            return "Sorry, I couldn't generate an answer right now. Please try again."

    async def ask_stream(self, question: str, context: str = "", session_id: Optional[str] = None, model: Optional[str] = None, **kwargs):
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
        # Include context only when needed; rely on Responses chaining across turns
        include_context = self._should_include_context(session_id, context)
        ctx_text = context if include_context else None
        user_content = (
            f"Question: {question}\n\n" + (f"Context:\n{ctx_text}" if ctx_text else "")
        )

        try:
            self._get_or_init_session(session_id, system_prompt)
            resolved_model = self._resolve_model(session_id, model)
            total = ""
            if session_id:
                self._append_and_prune(session_id, "user", user_content)
            minimal_msgs = self._build_minimal_messages(session_id, system_prompt, user_content)
            async for chunk in self.provider.generate_stream(
                minimal_msgs,
                max_tokens=3000,  # Increased for detailed summaries (was 900)
                temperature=0.2,
                store=True,
                model=resolved_model,
                session_id=session_id,
            ):
                if chunk:
                    total += chunk
                    yield chunk
            if session_id:
                self._update_session_usage(session_id)
                if include_context:
                    self._record_context_hash(session_id, context)
                self._append_and_prune(session_id, "assistant", total)
        except Exception as e:
            yield f"(error) {e}"
    
    async def generate_search_terms(
        self, 
        user_query: str, 
        attempt: int = 1, 
        is_first_attempt: bool = True,
        session_id: Optional[str] = None,
    ) -> List[str]:
        """Generate search terms for dataset search."""
        if not self.provider:
            return self._extract_basic_terms(user_query)
        
        try:
            prompt = self._build_search_prompt(user_query, attempt, is_first_attempt)
            system = "You are a biomedical search expert specializing in finding relevant datasets in biological databases."
            if session_id:
                minimal_msgs = self._build_minimal_messages(session_id, system, prompt)
                response = await self.provider.generate(
                    minimal_msgs,
                    max_tokens=200,
                    temperature=0.3,
                    store=False,
                    model=self._resolve_model(session_id, None),
                )
                try:
                    self._update_session_usage(session_id)
                except Exception:
                    pass
            else:
                response = await self.provider.generate([
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt}
                ], max_tokens=200, temperature=0.3)
            
            return self._parse_comma_separated_response(response)[:5]
            
        except Exception as e:
            print(f"LLM search terms generation error: {e}")
            return self._extract_basic_terms(user_query)
    
    async def simplify_query(self, complex_query: str, session_id: Optional[str] = None) -> str:
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
            if session_id:
                minimal_msgs = self._build_minimal_messages(session_id, "You are a biomedical research assistant that simplifies complex queries for dataset search. Always prioritize disease/condition names and technical terms. Return only the simplified query, no formatting or explanations.", prompt)
                response = await asyncio.wait_for(
                    self.provider.generate(
                        minimal_msgs,
                        max_tokens=100,
                        temperature=0.2,
                        store=False,
                        model=self._resolve_model(session_id, None),
                    ),
                    timeout=25.0  # 25 second timeout
                )
                try:
                    self._update_session_usage(session_id)
                except Exception:
                    pass
            else:
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
        session_id: Optional[str] = None,
        model: Optional[str] = None
    ) -> str:
        """Generate code for a given task description."""
        if not self.provider:
            return self._generate_fallback_code(task_description, language)
        
        lang = (language or "python").strip()
        # Avoid resending identical context across chained turns
        include_context = self._should_include_context(session_id, context)
        ctx_text = context if include_context else None
        prompt = f"""
You are an expert programmer specializing in data analysis and bioinformatics.
Generate clean, executable {lang} code for the following task.

Task: {task_description}
Language: {lang}

{f"Context: {ctx_text}" if ctx_text else ""}

Requirements:
- Return ONLY {lang} code, no markdown or prose
- Keep it concise; include only imports/libraries actually used
- Do NOT duplicate setup already present in CONTEXT
- Avoid broad try/except; only guard truly optional I/O (e.g., existence checks)
- Keep prints/messages minimal
- Respect any dataset access instructions in CONTEXT (do not re-download or re-load duplicates)

Code:
"""
        
        try:
            system_prompt = f"You are an expert programmer. Generate only {lang} code, no explanations."
            self._get_or_init_session(session_id, system_prompt)
            resolved_model = self._resolve_model(session_id, model)
            minimal_msgs = self._build_minimal_messages(session_id, system_prompt, prompt)
            if session_id:
                self._append_and_prune(session_id, "user", prompt)
            response = await self.provider.generate(
                minimal_msgs,
                max_tokens=2000,
                temperature=0.1,
                store=True,
                model=resolved_model,
                session_id=session_id,
            )
            if session_id:
                self._update_session_usage(session_id)
                if include_context:
                    self._record_context_hash(session_id, context)
                self._append_and_prune(session_id, "assistant", response)
            if (lang or "").lower() == "python":
                return self.extract_python_code(response) or self._generate_fallback_code(task_description, language)
            else:
                code = self.extract_code_generic(response)
                return code or self._generate_fallback_code(task_description, language)
            
        except Exception as e:
            print(f"Error generating code: {e}")
            return self._generate_fallback_code(task_description, language)
    
    async def generate_code_stream(
        self, 
        task_description: str, 
        language: str = "python",
        context: Optional[str] = None,
        notebook_edit: bool = False,
        session_id: Optional[str] = None,
        model: Optional[str] = None,
        reasoning: Optional[Dict[str, Any]] = None,
    ):
        """Generate code with streaming for a given task description."""
        
        if not self.provider:
            # For fallback, yield the entire code at once
            fallback_code = self._generate_fallback_code(task_description, language)
            yield fallback_code
            return
        
        # Use different prompts for notebook edits vs full code generation
        lang = (language or "python").strip()
        # Decide whether to include the full context blob for this session
        include_context = self._should_include_context(session_id, context)
        ctx_text = context if include_context else None
        if notebook_edit:
            prompt = f"""
You are editing a specific section of code in a Jupyter notebook. 

TASK: {task_description}
LANGUAGE: {lang}

{f"CONTEXT: {ctx_text}" if ctx_text else ""}

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
            # Enhanced prompt with better structure for full code generation (concise style)
            prompt = f"""
You are an expert programmer specializing in data analysis and bioinformatics.
Generate concise, executable {lang} code for the following task.

TASK: {task_description}
LANGUAGE: {lang}

{f"CONTEXT: {ctx_text}" if ctx_text else ""}

CRITICAL REQUIREMENTS (concise):
1. Return ONLY {lang} code — no markdown or prose
2. Include only used libraries; do NOT re-import items already in CONTEXT
3. Be terse: a few short comments only when necessary
4. Avoid broad try/except; let exceptions surface unless handling specific, likely cases (e.g., missing file)
5. Limit prints to at most 1–2 lines total
6. Save outputs to appropriate directories (results/, figures/) without extra wrappers
7. Ensure valid syntax; no trailing prose or fences

DATASET ACCESS RULES (DEFER TO CONTEXT):
- If CONTEXT specifies how to access data (e.g., a 'DATA ACCESS CONTEXT' section, preloaded dataset
  variables, or 'data_dir = Path("data")' with specific filenames), you MUST follow that pattern.
- Do NOT download data again if previous steps already handled downloading or loading.
- For remote datasets: assume files are present under the specified data_dir in CONTEXT; if missing, raise a clear FileNotFoundError (do not re-download).
- For local datasets: assume variables are already loaded when CONTEXT indicates so; do not rebuild
  paths or reload unless the TASK explicitly requests it.
- Only perform network downloads if the TASK explicitly states to download and CONTEXT does not
  already include download/setup code for the same data.

ERROR HANDLING (minimal):
- Avoid wrapping whole cells in try/except
- If you must guard, check file existence explicitly, or catch the specific expected exception only

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
            system_prompt = f"You are an expert programmer specializing in bioinformatics and data analysis. Generate ONLY executable {lang} code, using only libraries actually used. Do not repeat setup already present in CONTEXT. Never include explanations, markdown, or non-code text. Ensure valid syntax and proper directory structure."
            session_msgs = self._get_or_init_session(session_id, system_prompt)
            resolved_model = self._resolve_model(session_id, model)
            total = ""
            if session_msgs is not None:
                self._append_and_prune(session_id, "user", prompt)
                minimal_msgs = self._build_minimal_messages(
                    session_id, system_prompt, prompt
                )
                async for chunk in self.provider.generate_stream(
                    minimal_msgs,
                    max_tokens=3000,
                    temperature=0.1,
                    store=True,
                    model=resolved_model,
                    session_id=session_id,
                    **({"reasoning": reasoning} if reasoning else {}),
                ):
                    if chunk:
                        total += chunk
                        yield chunk
                self._update_session_usage(session_id)
                if include_context:
                    self._record_context_hash(session_id, context)
                self._append_and_prune(session_id, "assistant", total)
            else:
                async for chunk in self.provider.generate_stream([
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ], max_tokens=3000, temperature=0.1, store=True, model=resolved_model, session_id=session_id, **({"reasoning": reasoning} if reasoning else {})):
                    yield chunk
                if include_context:
                    self._record_context_hash(session_id, context)
                
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

    def extract_code_generic(self, response: str) -> Optional[str]:
        """Extract any code block from LLM response, language-agnostic."""
        import re
        m = re.search(r"```[a-zA-Z0-9_+-]*\s*\n(.*?)\n```", response, re.DOTALL)
        if m:
            return m.group(1).strip()
        # If no fenced code, fall back to returning the whole response as-is
        return response.strip() if response and response.strip() else None
    
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
        context: Optional[str] = None,
        session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Generate tool calling instructions."""
        if not self.provider:
            return {"error": "LLM not available for tool calling"}
        
        try:
            # Apply context deduplication like other methods
            include_context = self._should_include_context(session_id, context)
            ctx_text = context if include_context else ""

            prompt = f"""Generate instructions for calling the tool '{tool_name}' with the following parameters:

Parameters: {json.dumps(parameters, indent=2)}

{("Context: " + ctx_text) if ctx_text else ""}

Return a JSON object with:
- tool_name: the name of the tool
- parameters: the parameters to pass
- description: what this tool call will do

JSON response:"""

            if session_id:
                minimal_msgs = self._build_minimal_messages(session_id, "You are a tool calling expert that generates precise tool invocation instructions.", prompt)
                response = await self.provider.generate(
                    minimal_msgs,
                    max_tokens=300,
                    temperature=0.1,
                    store=False,
                    model=self._resolve_model(session_id, None),
                )
                try:
                    self._update_session_usage(session_id)
                except Exception:
                    pass
                if include_context:
                    self._record_context_hash(session_id, context)
            else:
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
    
    async def analyze_query(self, query: str, session_id: Optional[str] = None) -> Dict[str, Any]:
        """Analyze a query to extract components and intent. Chains to session when provided."""
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
            
            system = "You are a biomedical query analyzer that extracts structured information from research questions."
            if session_id:
                # Chain to session without polluting stored history
                minimal_msgs = self._build_minimal_messages(session_id, system, prompt)
                response = await self.provider.generate(
                    minimal_msgs,
                    max_tokens=300,
                    temperature=0.1,
                    store=False,
                    model=self._resolve_model(session_id, None),
                )
                try:
                    self._update_session_usage(session_id)
                except Exception:
                    pass
            else:
                response = await self.provider.generate([
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt}
                ], max_tokens=300, temperature=0.1)
            
            try:
                return json.loads(response)
            except json.JSONDecodeError:
                return self._basic_query_analysis(query)
            
        except Exception as e:
            print(f"Query analysis error: {e}")
            return self._basic_query_analysis(query)

    async def analyze_query_stream(
        self,
        query: str,
        session_id: Optional[str] = None,
        *,
        max_tokens: int = 600,
    ):
        """Streaming version of analyze_query that emits reasoning deltas and final JSON.

        Yields dict events:
        - {"type": "status", "status": "thinking"}
        - {"type": "reasoning", "delta": "Thought 1 > ..."}
        - {"type": "analysis", "analysis": {...}}
        - {"type": "error", "message": str}
        - {"type": "done"}
        """
        if not self.provider:
            yield {"type": "status", "status": "thinking"}
            analysis = self._basic_query_analysis(query)
            yield {"type": "analysis", "analysis": analysis, "fallback": True}
            yield {"type": "done"}
            return

        system = (
            "You are a biomedical query analyzer that extracts structured metadata from the user's request.\n"
            "Think step-by-step and stream each thought as `Thought <n> > ...`.\n"
            "When you are ready with the final result, output `<final>{JSON}</final>` containing ONLY valid JSON."
        )

        include_context = self._should_include_context(session_id, query)
        user_prompt = (
            "Analyze this biomedical research query and return a JSON object with:\n"
            "- intent: main research goal\n"
            "- entities: key biological entities mentioned\n"
            "- data_types: required data types\n"
            "- analysis_type: recommended analysis plan (ordered list)\n"
            "- complexity: simple/medium/complex\n\n"
            f"Query: {query}\n\n"
            "Follow the streaming format instructions carefully."
        )

        self._get_or_init_session(session_id, system)
        resolved_model = self._resolve_model(session_id, None)

        processed_reasoning_len = 0
        total_text = ""
        final_idx = -1
        reasoning_lines: List[str] = []
        pending_reasoning_line = ""

        async def emit_new_reasoning(new_text: str):
            nonlocal pending_reasoning_line
            if not new_text:
                return
            pending_reasoning_line += new_text
            while True:
                newline_idx = pending_reasoning_line.find("\n")
                if newline_idx == -1:
                    break
                line = pending_reasoning_line[:newline_idx].rstrip()
                pending_reasoning_line = pending_reasoning_line[newline_idx + 1 :]
                if not line:
                    continue
                if line.startswith("Thought"):
                    reasoning_lines.append(line)
                    yield_event = {"type": "reasoning", "delta": line + "\n"}
                    yield yield_event

        async def stream_generator():
            nonlocal total_text, final_idx, processed_reasoning_len
            yield {"type": "status", "status": "thinking"}

            async def handle_chunk(chunk: str):
                nonlocal total_text, final_idx, processed_reasoning_len
                if not chunk:
                    return []
                events = []
                total_text += chunk
                if final_idx == -1:
                    idx = total_text.find("<final>")
                    if idx != -1:
                        final_idx = idx
                reasoning_end = final_idx if final_idx != -1 else len(total_text)
                reasoning_slice = total_text[processed_reasoning_len:reasoning_end]
                processed_reasoning_len = reasoning_end
                if reasoning_slice:
                    async for evt in emit_new_reasoning(reasoning_slice):
                        events.append(evt)
                return events

            async def parse_final_json() -> Optional[Dict[str, Any]]:
                nonlocal total_text, final_idx
                if final_idx == -1:
                    return None
                json_portion = total_text[final_idx + len("<final>") :]
                end_idx = json_portion.find("</final>")
                if end_idx == -1:
                    return None
                raw_json = json_portion[:end_idx].strip()
                try:
                    result = json.loads(raw_json or "{}")
                except Exception:
                    return None
                if reasoning_lines:
                    summary = "\n".join(reasoning_lines)
                    if isinstance(result, dict) and summary:
                        result.setdefault("reasoning_summary", summary)
                return result if isinstance(result, dict) else None

            async def iterate_messages():
                nonlocal pending_reasoning_line, total_text, final_idx, processed_reasoning_len
                user_content = user_prompt
                if session_id:
                    self._append_and_prune(session_id, "user", user_content)
                minimal_msgs = self._build_minimal_messages(session_id, system, user_content)
                async for chunk in self.provider.generate_stream(
                    minimal_msgs,
                    max_tokens=max_tokens,
                    temperature=0.1,
                    store=True,
                    model=resolved_model,
                    session_id=session_id,
                ):
                    events = await handle_chunk(chunk)
                    for evt in events:
                        yield evt
                    maybe_json = await parse_final_json()
                    if maybe_json:
                        if include_context and session_id:
                            self._record_context_hash(session_id, query)
                        if session_id:
                            self._append_and_prune(
                                session_id,
                                "assistant",
                                json.dumps(maybe_json, ensure_ascii=False),
                            )
                        self._update_session_usage(session_id)
                        yield {"type": "analysis", "analysis": maybe_json}
                        return
                # Exhausted stream without <final>; fall back
                fallback = self._basic_query_analysis(query)
                if reasoning_lines:
                    fallback["reasoning_summary"] = "\n".join(reasoning_lines)
                if session_id:
                    self._append_and_prune(
                        session_id,
                        "assistant",
                        json.dumps(fallback, ensure_ascii=False),
                    )
                self._update_session_usage(session_id)
                yield {"type": "analysis", "analysis": fallback, "fallback": True}

            async for evt in iterate_messages():
                yield evt
            yield {"type": "done"}

        async for event in stream_generator():
            yield event

    async def classify_intent(self, text: str, context: Optional[dict] = None, session_id: Optional[str] = None) -> Dict[str, Any]:
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
                # Chain to existing session if available for provider-side tracking,
                # but do not store this exchange in conversation state
                resp = await self.provider.generate(
                    [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    max_tokens=120,
                    temperature=0.0,
                    store=False,
                    metadata={"session_id": session_id or "", "action": "intent"},
                )
                # Best-effort: update session meta with new response id/usage for tracking
                try:
                    self._update_session_usage(session_id)
                except Exception:
                    pass
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
        task_type: str = "general",
        session_id: Optional[str] = None
    ) -> dict:
        """
        Generate a plan for any task based on current context and state.
        This can be called at any point during analysis to plan next steps.
        """
        if current_state is None:
            current_state = {}
        if available_data is None:
            available_data = []

        # Apply context deduplication like other methods
        include_context = self._should_include_context(session_id, context)
        ctx_text = context if include_context else ""

        prompt = f"""
You are an expert AI assistant that can plan and execute various tasks. Given a question, current context, and available data, create a plan for the next steps.

Question: {question}

{("Context: " + ctx_text) if ctx_text else ""}

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
            system = "You are an expert AI assistant that can plan and execute various tasks. Create specific, actionable plans based on the given context."
            if session_id:
                minimal_msgs = self._build_minimal_messages(session_id, system, prompt)
                response = await self.provider.generate(
                    minimal_msgs,
                    max_tokens=1000,
                    temperature=0.1,
                    store=False,
                    model=self._resolve_model(session_id, None),
                )
                try:
                    self._update_session_usage(session_id)
                except Exception:
                    pass
                if include_context:
                    self._record_context_hash(session_id, context)
            else:
                response = await self.provider.generate([
                    {"role": "system", "content": system},
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
                    try:
                        reasoning_summary = getattr(self.provider, "last_reasoning_summary", None)
                    except Exception:
                        reasoning_summary = None
                    if reasoning_summary:
                        plan["reasoning_summary"] = reasoning_summary
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

    async def generate_plan_stream(
        self,
        question: str,
        context: str = "",
        current_state: Optional[dict] = None,
        available_data: Optional[list] = None,
        task_type: str = "general",
        session_id: Optional[str] = None,
        *,
        max_tokens: int = 1200,
    ):
        """Streaming plan generation with reasoning deltas and structured output."""
        if current_state is None:
            current_state = {}
        if available_data is None:
            available_data = []

        if not self.provider:
            plan = self._generate_fallback_plan(question, task_type)
            yield {"type": "status", "status": "thinking"}
            yield {"type": "plan", "plan": plan, "fallback": True}
            for idx, step in enumerate(plan.get("next_steps", [])):
                yield {"type": "plan_step", "index": idx, "step": step}
            yield {"type": "done"}
            return

        include_context = self._should_include_context(session_id, context)
        ctx_text = context if include_context else ""

        def _safe_dump(value: Any, max_chars: int = 1200) -> str:
            try:
                dumped = json.dumps(value, ensure_ascii=False, indent=2)
            except Exception:
                dumped = str(value)
            if len(dumped) > max_chars:
                return dumped[: max_chars - 3] + "..."
            return dumped

        user_prompt = (
            "You are planning the next analysis actions. Stream each reasoning step as `Thought <n> > ...`.\n"
            "When ready, output `<final>{JSON}</final>` with the following structure:\n"
            "{\n"
            "  \"task_type\": string,\n"
            "  \"priority\": \"high|medium|low\",\n"
            "  \"next_steps\": [string,...],\n"
            "  \"estimated_time\": string,\n"
            "  \"dependencies\": [string,...],\n"
            "  \"success_criteria\": [string,...],\n"
            "  \"analysis_metadata\": {\n"
            "    \"intent\": string,\n"
            "    \"entities\": [string,...],\n"
            "    \"data_types\": [string,...],\n"
            "    \"analysis_type\": [string,...],\n"
            "    \"complexity\": \"simple|medium|complex\"\n"
            "  }\n"
            "}\n"
            "Add a `reasoning_summary` field mirroring your key thoughts.\n\n"
            f"Question: {question}\n\n"
            f"Context: {ctx_text or '[none]'}\n\n"
            f"Current State: {_safe_dump(current_state)}\n\n"
            f"Available Data: {_safe_dump(available_data)}\n\n"
            f"Task Type: {task_type}\n"
        )

        system = (
            "You are an expert planner for biomedical data analysis."
            " Stream concise thoughts before producing the final JSON plan."
        )

        self._get_or_init_session(session_id, system)
        resolved_model = self._resolve_model(session_id, None)

        processed_reasoning_len = 0
        total_text = ""
        final_idx = -1
        reasoning_lines: List[str] = []
        pending_reasoning_line = ""

        async def emit_new_reasoning(new_text: str):
            nonlocal pending_reasoning_line
            if not new_text:
                return
            pending_reasoning_line += new_text
            while True:
                newline_idx = pending_reasoning_line.find("\n")
                if newline_idx == -1:
                    break
                line = pending_reasoning_line[:newline_idx].rstrip()
                pending_reasoning_line = pending_reasoning_line[newline_idx + 1 :]
                if not line:
                    continue
                if line.startswith("Thought"):
                    reasoning_lines.append(line)
                    yield {"type": "reasoning", "delta": line + "\n"}

        async def stream_generator():
            nonlocal total_text, final_idx, processed_reasoning_len
            yield {"type": "status", "status": "thinking"}

            async def handle_chunk(chunk: str):
                nonlocal total_text, final_idx, processed_reasoning_len
                events = []
                if not chunk:
                    return events
                total_text += chunk
                if final_idx == -1:
                    idx = total_text.find("<final>")
                    if idx != -1:
                        final_idx = idx
                reasoning_end = final_idx if final_idx != -1 else len(total_text)
                reasoning_slice = total_text[processed_reasoning_len:reasoning_end]
                processed_reasoning_len = reasoning_end
                if reasoning_slice:
                    async for evt in emit_new_reasoning(reasoning_slice):
                        events.append(evt)
                return events

            async def parse_final_json() -> Optional[Dict[str, Any]]:
                nonlocal total_text, final_idx
                if final_idx == -1:
                    return None
                json_portion = total_text[final_idx + len("<final>") :]
                end_idx = json_portion.find("</final>")
                if end_idx == -1:
                    return None
                raw_json = json_portion[:end_idx].strip()
                try:
                    plan = json.loads(raw_json or "{}")
                except Exception:
                    return None
                if isinstance(plan, dict):
                    if reasoning_lines and not plan.get("reasoning_summary"):
                        plan["reasoning_summary"] = "\n".join(reasoning_lines)
                    meta = plan.setdefault("analysis_metadata", {})
                    if isinstance(meta, dict):
                        meta.setdefault("intent", "analysis")
                        meta.setdefault("entities", [])
                        meta.setdefault("data_types", [])
                        meta.setdefault("analysis_type", [])
                        meta.setdefault("complexity", "medium")
                    return plan
                return None

            async def iterate_messages():
                nonlocal pending_reasoning_line, total_text, final_idx, processed_reasoning_len
                user_content = user_prompt
                if session_id:
                    self._append_and_prune(session_id, "user", user_content)
                minimal_msgs = self._build_minimal_messages(session_id, system, user_content)
                async for chunk in self.provider.generate_stream(
                    minimal_msgs,
                    max_tokens=max_tokens,
                    temperature=0.1,
                    store=True,
                    model=resolved_model,
                    session_id=session_id,
                ):
                    events = await handle_chunk(chunk)
                    for evt in events:
                        yield evt
                    maybe_plan = await parse_final_json()
                    if maybe_plan:
                        if include_context and session_id:
                            self._record_context_hash(session_id, context)
                        if session_id:
                            self._append_and_prune(
                                session_id,
                                "assistant",
                                json.dumps(maybe_plan, ensure_ascii=False),
                            )
                        self._update_session_usage(session_id)
                        yield {"type": "plan", "plan": maybe_plan}
                        for idx, step in enumerate(
                            maybe_plan.get("next_steps", [])
                        ):
                            yield {
                                "type": "plan_step",
                                "index": idx,
                                "step": step,
                            }
                        return
                # Fallback mode
                fallback = self._generate_fallback_plan(question, task_type)
                if reasoning_lines and not fallback.get("reasoning_summary"):
                    fallback["reasoning_summary"] = "\n".join(reasoning_lines)
                if session_id:
                    self._append_and_prune(
                        session_id,
                        "assistant",
                        json.dumps(fallback, ensure_ascii=False),
                    )
                self._update_session_usage(session_id)
                yield {"type": "plan", "plan": fallback, "fallback": True}
                for idx, step in enumerate(fallback.get("next_steps", [])):
                    yield {"type": "plan_step", "index": idx, "step": step}

            async for evt in iterate_messages():
                yield evt
            yield {"type": "done"}

        async for event in stream_generator():
            yield event
    
    async def generate_data_type_suggestions(
        self,
        data_types: List[str],
        user_question: str,
        available_datasets: List[Dict[str, Any]],
        current_context: str = "",
        session_id: Optional[str] = None,
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
            
        # Apply context deduplication like other methods
        include_context = self._should_include_context(session_id, current_context)
        ctx_text = current_context if include_context else ""

        prompt = f"""
You are an expert bioinformatics and data science assistant. Based on the selected data types and user question, provide dynamic analysis suggestions.

User Question: {user_question}

Selected Data Types: {', '.join(data_types)}

Available Datasets: {json.dumps(available_datasets, indent=2)}

{("Current Context: " + ctx_text) if ctx_text else ""}

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
            system = "You are an expert bioinformatics assistant that provides specific, actionable analysis suggestions based on data types and research questions."
            if session_id:
                minimal_msgs = self._build_minimal_messages(session_id, system, prompt)
                response = await self.provider.generate(
                    minimal_msgs,
                    max_tokens=1500,
                    temperature=0.3,
                    store=False,
                    model=self._resolve_model(session_id, None),
                )
                try:
                    self._update_session_usage(session_id)
                except Exception:
                    pass
                if include_context:
                    self._record_context_hash(session_id, current_context)
            else:
                response = await self.provider.generate([
                    {"role": "system", "content": system},
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


# Global LLM service instances keyed by configuration
_llm_services: Dict[str, LLMService] = {}

def get_llm_service(provider: str = "openai", **kwargs) -> LLMService:
    """Get or create the LLM service instance for the given configuration."""
    # Create a key from provider and sorted kwargs
    key_parts = [provider]
    for k in sorted(kwargs.keys()):
        key_parts.append(f"{k}={kwargs[k]}")
    key = "|".join(key_parts)

    if key not in _llm_services:
        _llm_services[key] = LLMService(provider=provider, **kwargs)

    return _llm_services[key] 
