"""
Scout's configuration: the SCOUT_* environment variables.

Scout's own, not the API's: the API only says where its .env file is
(`ScoutSettings(_env_file=...)`). Every value has a default, so the API still
starts with nothing set; the defaults are a local Ollama. Production values,
and why they differ: ../CLAUDE.md.
"""

from dataclasses import dataclass
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

# A feature asks for a size, never a model by name, so a provider's renamed
# or retired model is an env change. "large" is for writing and judgment
# (Tailor, Read It With AI, the editor assistant), "small" for plain
# extraction at volume (a job posting's keywords).
Size = Literal["large", "small"]


@dataclass(frozen=True)
class Endpoint:
    """One OpenAI-compatible model endpoint: where it is and which model to ask."""

    base_url: str
    model: str
    # Ollama ignores the key but the SDK insists on one.
    api_key: str | None = None
    reasoning_effort: str | None = None


class ScoutSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="SCOUT_", env_file_encoding="utf-8", extra="ignore"
    )

    # Any OpenAI-compatible endpoint.
    base_url: str = "http://localhost:11434/v1"
    model: str = "qwen3.5:4b"
    api_key: str | None = None
    # "none" turns Qwen's thinking off so replies start at once. Gemini and
    # GPT-5 reject "none" and want "minimal".
    reasoning_effort: str | None = "none"

    # The endpoint chain, tried in order: a JSON list of objects with
    # base_url, model and, optionally, api_key and reasoning_effort. Unset
    # means one endpoint, the one the four fields above name.
    endpoints: list[Endpoint] = []
    # Each size's own chain (SCOUT_ENDPOINTS_LARGE, SCOUT_ENDPOINTS_SMALL),
    # same format. The default chain follows it, so the fallback (Gemini,
    # say) is written once; unset, the size is the default chain alone.
    endpoints_large: list[Endpoint] = []
    endpoints_small: list[Endpoint] = []

    def chain(self, size: Size | None = None) -> list[Endpoint]:
        default = self.endpoints or [
            Endpoint(self.base_url, self.model, self.api_key, self.reasoning_effort)
        ]
        own = {"large": self.endpoints_large, "small": self.endpoints_small}.get(size, [])
        # An endpoint in both is tried once, where the size's chain puts it.
        return [*own, *(e for e in default if e not in own)]
