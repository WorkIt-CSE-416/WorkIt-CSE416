"""
Environment configuration, imported by other files and migration
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def to_asyncpg(url: str) -> str:
    """
    parse a supabase connection url into url with asyncpg,
    so it can connect to supabase
    """
    scheme, separator, rest = url.partition("://")

    if not separator:
        raise ValueError(f"Not a database URL: {url!r}")

    # A scheme that already names a driver ("postgresql+asyncpg") is left alone
    # so this can run over an already-correct value without doubling it.
    if "+" in scheme:
        return url

    return f"postgresql+asyncpg://{rest}"


# env from the root directory
ENV_FILE = Path(__file__).parents[2] / ".env"


def default_scraper_feed() -> Path:
    """
    scraper/feed.json when a local scraper run has written one, else the
    committed snapshot in backend/data/. A Vercel deploy only ships backend/,
    so it always gets the snapshot.
    """
    local = ENV_FILE.parent / "scraper" / "feed.json"
    if local.is_file():
        return local
    return Path(__file__).parents[1] / "data" / "feed.json"


class Settings(BaseSettings):
    """Everything the API reads from the environment."""

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # the transaction pooler of Supabase, same as DATABASE_URL
    database_url: str | None = None

    # The session pooler for alembic to use for migrations
    direct_url: str | None = None

    # Supabase project URL and service-role key. Storage uploads and the Auth
    # admin API (signup) both use them, and the URL is where the JWKS that
    # verifies access tokens is published.
    supabase_url: str | None = None
    supabase_service_key: str | None = None

    gemini_api_key: str | None = None
    embedding_provider: Literal["gemini", "ollama"] = "ollama"
    ollama_embedding_url: str = "http://localhost:11434"
    ollama_embedding_model: str = Field(default="nomic-embed-text:v1.5", min_length=1)
    embedding_timeout_seconds: float = Field(default=120, gt=0)

    # AI usage limits (app/services/usage.py). A use counts only when the
    # model call succeeds. Each feature has a cap per student per UTC day and
    # a share of the daily pool, the day's uses across all students.
    ai_daily_pool: int = 1000
    ai_scout_cap: int = 3
    ai_intake_cap: int = 15
    ai_tailor_cap: int = 2
    ai_parsing_cap: int = 1
    # The editor assistant (KAN-221): its share is on top of the spec's four,
    # which already sum to the pool, so a busy day can overshoot it by 10%.
    ai_assistant_cap: int = 10
    ai_tailor_share: float = 0.4
    ai_intake_share: float = 0.3
    ai_scout_share: float = 0.2
    ai_parsing_share: float = 0.1
    ai_assistant_share: float = 0.1

    # The scraper's output, which app/scripts/import_jobs.py loads into the
    # database by default. Data — nothing from scraper/ is imported, so it
    # stays out of this build.
    scraper_feed: Path = Field(default_factory=default_scraper_feed)

    @property
    def app_url(self) -> str:
        if not self.database_url:
            raise RuntimeError(
                "DATABASE_URL is not set"
            )

        return to_asyncpg(self.database_url)

    @property
    def migration_url(self) -> str:
        if not self.direct_url:
            raise RuntimeError(
                "DIRECT_URL is not set."
            )

        return to_asyncpg(self.direct_url)

    @property
    def supabase_auth_url(self) -> str:
        """Base URL of the project's Auth service; also the tokens' `iss`."""
        if not self.supabase_url:
            raise RuntimeError(
                "SUPABASE_URL is not set."
            )

        return f"{self.supabase_url.rstrip('/')}/auth/v1"


@lru_cache
def get_settings() -> Settings:
    """Read the environment once per process."""
    return Settings()
