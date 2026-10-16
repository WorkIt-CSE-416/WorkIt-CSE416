"""
Embeddings: experience banks and job postings as vectors, so they can be
compared by meaning in any field. What a bank is embedded from is
`bank_input.bank_text`.
"""

import logging
import math
from collections.abc import Sequence

import httpx  # general Python library for sending HTTP requests

from app.config import get_settings
from app.models.dto import EMBEDDING_DIMENSIONS

logger = logging.getLogger(__name__)

# Every writer that shares a database must use one provider and model:
# vectors from different models can't be compared, even at equal
# dimensions. Gemini stays fixed for production; local Ollama models are
# configurable, and model_key() names the space a vector came from.
# Changing the model or DIMENSIONS means re-embedding every job and bank.
MODEL = "gemini-embedding-001"

DIMENSIONS = EMBEDDING_DIMENSIONS

BATCH_SIZE = 100
_MAX_CHARS = 6000
_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:batchEmbedContents"


def job_text(title: str, description: str | None) -> str:
    '''what a posting is embedded from: its title, then its description'''
    return f"{title}\n\n{description or ''}".strip()


def model_key() -> str:
    """Identity stored with vectors; equal dimensions alone do not imply compatibility."""
    settings = get_settings()
    model = MODEL if settings.embedding_provider == "gemini" else settings.ollama_embedding_model
    return f"{settings.embedding_provider}:{model}:{DIMENSIONS}"


async def embed(texts: Sequence[str]) -> list[list[float]] | None:
    """One vector per text, or None on provider failure; never fall back to another model.

    Empty input returns []; oversized batches are caller errors. Both providers
    must return finite, 768-dimensional vectors before anything can be stored.
    """
    if len(texts) > BATCH_SIZE:
        raise ValueError(f"embed() takes at most {BATCH_SIZE} texts at a time")
    if not texts:
        return []
    settings = get_settings()
    provider = settings.embedding_provider
    headers = {}
    if provider == "gemini":
        if not settings.gemini_api_key:
            return None
        url = _URL
        headers = {"x-goog-api-key": settings.gemini_api_key}
        body = {
            "requests": [
                {
                    "model": f"models/{MODEL}",
                    "content": {"parts": [{"text": text[:_MAX_CHARS]}]},
                    "taskType": "SEMANTIC_SIMILARITY",
                    "outputDimensionality": DIMENSIONS,
                }
                for text in texts
            ]
        }
    else:
        url = settings.ollama_embedding_url.rstrip("/") + "/api/embed"
        body = {
            "model": settings.ollama_embedding_model,
            "input": [text[:_MAX_CHARS] for text in texts],
            "truncate": True,
        }
    try:
        async with httpx.AsyncClient(timeout=settings.embedding_timeout_seconds) as client:
            response = await client.post(url, json=body, headers=headers)
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.warning("%s embedding failed: HTTP %s", provider, exc.response.status_code)
        return None
    except httpx.HTTPError as exc:
        logger.warning("%s embedding failed: %s", provider, exc)
        return None
    try:
        payload = response.json()
        if not isinstance(payload, dict):
            raise TypeError("response must be an object")
        embeddings = payload.get("embeddings")
        if not isinstance(embeddings, list) or len(embeddings) != len(texts):
            raise ValueError("expected one embedding per input text")
        vectors = []
        for embedding in embeddings:
            if provider == "gemini":
                values = embedding.get("values") if isinstance(embedding, dict) else None
            else:
                values = embedding
            if not isinstance(values, list) or len(values) != DIMENSIONS:
                raise ValueError(f"expected {DIMENSIONS} values per embedding")
            if any(
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                for value in values
            ):
                raise ValueError("embedding values must be finite numbers")
            vectors.append([float(value) for value in values])
        return vectors
    except (TypeError, ValueError, OverflowError) as exc:
        logger.warning("%s embedding returned an invalid response: %s", provider, exc)
        return None
