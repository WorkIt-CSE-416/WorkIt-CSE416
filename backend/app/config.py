"""
Environment configuration, imported by other files and migration
"""

from functools import lru_cache
from pathlib import Path

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

    # Only for a project still signing access tokens with the legacy shared
    # HS256 secret. A project on asymmetric signing keys leaves this unset and
    # is verified against its public JWKS instead (app/security.py).
    supabase_jwt_secret: str | None = None

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
