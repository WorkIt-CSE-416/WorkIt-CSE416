"""
Scout's configuration: the SCOUT_* environment variables.

Scout's own, not the API's: the API only says where its .env file is
(`ScoutSettings(_env_file=...)`). Every value has a default, so the API still
starts with nothing set; the defaults are a local Ollama. Production values,
and why they differ: ../CLAUDE.md.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # Tried once when the primary is rate-limited, down or unreachable. Unset
    # means no fallback: the user sees Scout's error message instead.
    fallback_base_url: str | None = None
    fallback_model: str | None = None
    fallback_api_key: str | None = None
    fallback_reasoning_effort: str | None = None

    # Messages one account may send per UTC day. The cap is what keeps a free
    # product free.
    daily_turns: int = 50
