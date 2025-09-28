"""Helpers for computing dataset similarity scores using the LLM service."""

from __future__ import annotations

import json
import textwrap
from typing import Dict, Iterable, List, Sequence, Tuple

from .llm_service import get_llm_service


def _condense_text(value: str, max_chars: int = 420) -> str:
    """Condense whitespace and truncate long descriptions for prompts."""
    if not value:
        return ""
    collapsed = " ".join(value.split())
    if len(collapsed) <= max_chars:
        return collapsed
    return textwrap.shorten(collapsed, width=max_chars, placeholder="…")


def _parse_scores(response: str) -> Dict[int, float]:
    """Parse JSON scores from the model response."""
    def _load_json(payload: str) -> Dict[str, object]:
        try:
            data = json.loads(payload)
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            start = payload.find("{")
            end = payload.rfind("}")
            if start != -1 and end != -1 and end > start:
                try:
                    data = json.loads(payload[start : end + 1])
                    return data if isinstance(data, dict) else {}
                except json.JSONDecodeError:
                    return {}
            return {}

    data = _load_json(response)
    scores_list = None
    if "scores" in data and isinstance(data["scores"], list):
        scores_list = data["scores"]
    elif isinstance(data, dict):
        # Some models may return a dict of index->score directly
        if all(isinstance(k, str) for k in data.keys()):
            try:
                return {
                    int(idx): _sanitize_score(val)
                    for idx, val in data.items()
                }
            except Exception:
                scores_list = None

    parsed: Dict[int, float] = {}
    if isinstance(scores_list, list):
        for entry in scores_list:
            if not isinstance(entry, dict):
                continue
            try:
                idx = int(entry.get("index"))
                score = _sanitize_score(entry.get("score"))
            except Exception:
                continue
            parsed[idx] = score
    return parsed


def _sanitize_score(value: object) -> float:
    try:
        score = float(value)
    except (TypeError, ValueError):
        return 0.0
    if score > 1.0:
        if score <= 100.0:
            score = score / 100.0
        else:
            score = 1.0
    if score < 0.0:
        score = 0.0
    return min(1.0, score)


async def score_items_with_llm(
    query: str,
    items: Sequence[Tuple[int, str]],
    *,
    batch_size: int = 10,
    temperature: float = 0.1,
) -> Dict[int, float]:
    """Score dataset descriptions against a query using the shared LLM service.

    Args:
        query: User query text.
        items: Sequence of ``(index, description)`` pairs.
        batch_size: Number of items to include per LLM call.
        temperature: Sampling temperature for the model.

    Returns:
        Mapping of dataset index to similarity score in the range [0.0, 1.0].
    """

    if not items:
        return {}

    llm_service = get_llm_service()
    results: Dict[int, float] = {}

    for start in range(0, len(items), batch_size):
        batch = items[start : start + batch_size]
        dataset_descriptions: List[str] = []
        for position, (idx, raw_text) in enumerate(batch, start=1):
            condensed = _condense_text(raw_text)
            dataset_descriptions.append(
                f"{position}. INDEX {idx}: {condensed or 'No description provided.'}"
            )

        user_prompt = (
            "You evaluate how relevant each dataset is to the user's query.\n"
            "For every dataset, assign a numeric relevance score between 0.0 (unrelated)"
            " and 1.0 (perfect match). Use increments of roughly 0.05.\n\n"
            "Return ONLY valid JSON with this exact structure:\n"
            "{\n  \"scores\": [\n    {\"index\": <dataset index>, \"score\": <float 0-1>}\n  ]\n}\n"
        )

        datasets_block = "\n".join(dataset_descriptions)
        user_content = (
            f"Query: {query}\n\nDatasets:\n{datasets_block}\n\n"
            "Provide the JSON response now."
        )

        try:
            response = await llm_service.generate(
                [
                    {
                        "role": "system",
                        "content": (
                            "You score biomedical dataset relevance and must respond with JSON only."
                        ),
                    },
                    {"role": "user", "content": user_content},
                ],
                max_tokens=400,
                temperature=temperature,
                store=False,
            )
        except Exception as exc:
            print(f"⚠️ LLM similarity scoring failed: {exc}")
            continue

        parsed = _parse_scores(response)
        results.update(parsed)

    return results


__all__ = ["score_items_with_llm"]

