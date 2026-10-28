"""
The model each AI feature calls (KAN-356): one place that builds an `LLM`
from the SCOUT_* settings, so routers and scripts never build their own.

A feature asks for a size, never a model by name (`workit_scout.settings`):

- `get_llm`, the default chain (SCOUT_ENDPOINTS, or the four single
  SCOUT_* fields): Scout, intake, essay answers.
- `get_large_llm` (SCOUT_ENDPOINTS_LARGE, then the default chain): Tailor's
  rewrite, Read It With AI, the editor assistant.
- `get_small_llm` (SCOUT_ENDPOINTS_SMALL, then the default chain): every
  keyword extraction, so one posting's keywords come from one chain
  whichever path reads them first: the keyword match, Tailor, a company
  job's save and the feed import.

Each is a FastAPI dependency, so a test swaps it with
`app.dependency_overrides`; a route takes the one it needs and passes it on.
Each is built on first use and kept, so the API starts whether or not a model
is set up, and a changed .env needs a restart.
"""

from functools import lru_cache

from workit_scout.llm import LLM
from workit_scout.settings import ScoutSettings

from app.config import ENV_FILE


@lru_cache
def get_scout_settings() -> ScoutSettings:
    """SCOUT_* from the environment and the repo's .env, read once."""
    return ScoutSettings(_env_file=ENV_FILE)


@lru_cache
def get_llm() -> LLM:
    return LLM.from_settings(get_scout_settings())


@lru_cache
def get_large_llm() -> LLM:
    return LLM.from_settings(get_scout_settings(), "large")


@lru_cache
def get_small_llm() -> LLM:
    return LLM.from_settings(get_scout_settings(), "small")
