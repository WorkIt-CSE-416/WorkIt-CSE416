"""
The real-Postgres test database (KAN-203), shared by every test that asks for
the `database` fixture. backend/CLAUDE.md's Tests section has the how-to.

TEST_DATABASE_URL names a local Postgres with pgvector (default: the Docker
container on port 54330). The run creates its own database there, named
per run so parallel runs from several worktrees never share tables, migrates
it to head, and drops it at the end. A host other than localhost is refused:
nothing here may reach Supabase.

DATABASE_URL and DIRECT_URL are pointed at that database before anything
reads them, so the app's own get_session (and Alembic) use it, and a test
that forgets an override still cannot reach the root `.env`'s database.
CONNECTOR_API_URL, CONNECTOR_WEB_URL and CONNECTOR_LOOPBACK_REDIRECTS are pinned
to the config defaults the same way, so a local `.env` serving the connector
elsewhere, or allowing Claude Code's loopback sign-in, changes no test.
"""

import asyncio
import os
import uuid
from pathlib import Path

import asyncpg
import pytest
from sqlalchemy.engine import make_url

DEFAULT_SERVER_URL = "postgresql://postgres:postgres@localhost:54330/postgres"
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
BACKEND = Path(__file__).parents[1]

_server = make_url(os.environ.get("TEST_DATABASE_URL", DEFAULT_SERVER_URL))
if _server.host not in LOCAL_HOSTS:
    raise RuntimeError(
        f"TEST_DATABASE_URL must point at localhost, not {_server.host!r}: "
        "tests drop and truncate tables."
    )
_test_url = _server.set(database=f"workit_test_{uuid.uuid4().hex[:8]}")

# Before any import of app.config: exported variables beat the root .env.
os.environ["DATABASE_URL"] = os.environ["DIRECT_URL"] = _test_url.render_as_string(
    hide_password=False
)
# The connector's own addresses, as the tests call it (tests/test_connector.py's
# API and WEB): a developer's .env pointing them at another port breaks OAuth.
os.environ["CONNECTOR_API_URL"] = "http://localhost:8000"
os.environ["CONNECTOR_WEB_URL"] = "http://localhost:3000"
os.environ["CONNECTOR_LOOPBACK_REDIRECTS"] = "false"


def _dsn(url) -> str:
    return url.set(drivername="postgresql").render_as_string(hide_password=False)


async def _create_database() -> None:
    server = await asyncpg.connect(_dsn(_server))
    try:
        await server.execute(f'CREATE DATABASE "{_test_url.database}"')
        # Supabase's search path, so pgvector's operators (in `extensions`)
        # resolve as they do in production: without it `<=>` is not found.
        await server.execute(
            f'ALTER DATABASE "{_test_url.database}" SET search_path = "$user", public, extensions'
        )
    finally:
        await server.close()

    db = await asyncpg.connect(_dsn(_test_url))
    try:
        # Supabase owns auth.users; the account tables' foreign key needs a stub.
        await db.execute(
            "CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY)"
        )
    finally:
        await db.close()


async def _drop_database() -> None:
    server = await asyncpg.connect(_dsn(_server))
    try:
        await server.execute(f'DROP DATABASE IF EXISTS "{_test_url.database}" WITH (FORCE)')
    finally:
        await server.close()


async def _tables_to_clean() -> list[str]:
    # Every table the migrations left empty. The seeded ones (job_roles,
    # locations) keep their rows, so a test can rely on them.
    db = await asyncpg.connect(_dsn(_test_url))
    try:
        names = await db.fetch(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
            " AND tablename <> 'alembic_version'"
        )
        empty = ["auth.users"]
        for (name,) in names:
            if not await db.fetchval(f'SELECT EXISTS (SELECT 1 FROM public."{name}")'):
                empty.append(f'public."{name}"')
        return empty
    finally:
        await db.close()


async def _truncate(tables: list[str]) -> None:
    db = await asyncpg.connect(_dsn(_test_url))
    try:
        await db.execute(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE")
    finally:
        await db.close()


@pytest.fixture(scope="session")
def _migrated_database():
    try:
        asyncio.run(_create_database())
    except (OSError, asyncpg.PostgresError) as exc:
        message = (
            f"No test Postgres at {_server.render_as_string()} ({exc}). "
            "Start it as backend/CLAUDE.md's Tests section says."
        )
        # CI must run these tests, never skip them.
        if os.environ.get("CI"):
            pytest.fail(message)
        pytest.skip(message)

    try:
        from alembic.config import Config

        from alembic import command
        from app.config import get_settings

        get_settings.cache_clear()
        command.upgrade(Config(str(BACKEND / "alembic.ini")), "head")
        yield asyncio.run(_tables_to_clean())
    finally:
        asyncio.run(_drop_database())


@pytest.fixture
def database(_migrated_database):
    """An async_sessionmaker on the migrated test database. The API's
    get_session uses the same database; every table the migrations left
    empty is emptied again after the test."""
    from app.db import get_engine, get_sessionmaker

    try:
        yield get_sessionmaker()
    finally:
        asyncio.run(_truncate(_migrated_database))
        # The engine holds no connections (NullPool), but its dialect caches
        # per-loop state; a fresh one per test keeps tests independent.
        get_sessionmaker.cache_clear()
        get_engine.cache_clear()


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True)
def _researched(request, monkeypatch):
    """Every company counts as researched, so a test about something else
    gets its application without saving a brief first. Tests marked
    `research_gate` (tests/test_company_briefs.py) keep the real rule."""
    if request.node.get_closest_marker("research_gate") is None:
        from app.auto_apply import briefs

        async def researched(db, company):
            return False

        monkeypatch.setattr(briefs, "needs_research", researched)
