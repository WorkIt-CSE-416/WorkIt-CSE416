"""
Environment configuration for SQLAlchemy
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


def to_asyncpg(url: str) -> str:
    """Rewrite a Postgres URL to name the asyncpg driver.

    Supabase hands you `postgresql://…`. SQLAlchemy needs to know which DBAPI
    to load, and it reads that from the scheme, so the async engine requires
    `postgresql+asyncpg://…`. Passing the URL through unchanged is the single
    most common first-hour error: SQLAlchemy loads a *sync* driver, fails to
    find one, and the traceback says nothing about the scheme.

    Idempotent, and accepts the older `postgres://` spelling.
    """
    scheme, separator, rest = url.partition("://")

    if not separator:
        raise ValueError(f"Not a database URL: {url!r}")

    # A scheme that already names a driver ("postgresql+asyncpg") is left alone
    # so this can run over an already-correct value without doubling it.
    if "+" in scheme:
        return url

    return f"postgresql+asyncpg://{rest}"


class Settings(BaseSettings):
    """Everything the API reads from the environment."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # The TRANSACTION pooler, port 6543. What the running app uses. Serverless
    # and short-lived connections need a pooler, and Supavisor's transaction
    # mode is why app/db.py disables prepared statements.
    database_url: str | None = None

    # The SESSION pooler, port 5432. What Alembic uses. DDL takes locks and
    # wants one serial conversation with the database; running migrations
    # through the transaction pooler is unreliable.
    direct_url: str | None = None

    @property
    def app_url(self) -> str:
        if not self.database_url:
            raise RuntimeError(
                "DATABASE_URL is not set. Copy .env.example to .env and fill it "
                "in from the Supabase dashboard (Project Settings → Database)."
            )

        return to_asyncpg(self.database_url)

    @property
    def migration_url(self) -> str:
        if not self.direct_url:
            raise RuntimeError(
                "DIRECT_URL is not set. Alembic needs the session pooler (port "
                "5432), not the transaction pooler. See .env.example."
            )

        return to_asyncpg(self.direct_url)


@lru_cache
def get_settings() -> Settings:
    """Read the environment once per process."""
    return Settings()
