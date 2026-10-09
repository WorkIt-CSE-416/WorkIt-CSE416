"""
Embeddings: resumes and job postings as vectors, so they can be compared by
meaning in any field.
"""

import logging
from collections.abc import Sequence

import httpx        # general Python library for sending HTTP requests

from app.config import get_settings
from app.models.dto import ParsedResume

logger = logging.getLogger(__name__)

MODEL = "gemini-embedding-001"

DIMENSIONS = 768

BATCH_SIZE = 100
_MAX_CHARS = 6000
_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:batchEmbedContents"


def job_text(title: str, description: str | None) -> str:
    '''what a posting is embedded from: its title, then its description'''
    return f"{title}\n\n{description or ''}".strip()


def resume_text(resume: ParsedResume) -> str:
    '''
    what a resume is embedded from: its parsed sections, never the raw text,
    which carries the name, email, phone and links
    '''
    lines = [
        ("Skills: " + ", ".join(s.skill_name for s in resume.skills)) if resume.skills else "",
        *(f"{e.title} at {e.company_name}. {e.description or ''}" for e in resume.experience),
        *(f"{p.project_name}. {p.description or ''}" for p in resume.projects),
        *(" ".join(filter(None, (e.degree, e.field_of_study))) for e in resume.education),
        *(c.cert_name for c in resume.certifications),
    ]
    return "\n".join(line.strip() for line in lines if line.strip())


async def embed(texts: Sequence[str]) -> list[list[float]] | None:
    '''
    one vector per text, in order, for at most BATCH_SIZE texts, so a caller
    with many keeps every batch that succeeded. None when nothing can be
    embedded: no GEMINI_API_KEY, or Gemini refused or was unreachable. The
    caller stores nothing and tries again later
    '''
    if len(texts) > BATCH_SIZE:
        raise ValueError(f"embed() takes at most {BATCH_SIZE} texts at a time")
    key = get_settings().gemini_api_key
    if not key or not texts:
        return None
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
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            # The key goes in a header, not ?key=
            # logged URL.
            response = await client.post(_URL, json=body, headers={"x-goog-api-key": key})
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        # 429 is the free tier's quota; the next
        logger.warning("Gemini embedding failed: %s %s", exc.response.status_code, exc.response.text[:300])
        return None
    except httpx.HTTPError as exc:
        logger.warning("Gemini embedding failed: %s", exc)
        return None
    return [e["values"] for e in response.json()["embeddings"]]
