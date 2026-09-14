"""Database engine, session factory, and the declarative base.

Nothing here defines a table. `Base` exists so Alembic has metadata to diff
against; it is empty until the schema design settles, and `alembic
revision --autogenerate` correctly produces nothing until then.

When models arrive they go in `app/models/` and import `Base` from here. This
file stays about connections.
"""

from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.config import get_settings


class Base(DeclarativeBase):
    """Declarative base every model inherits from.

    `Base.metadata` is what Alembic compares against the live database, so a
    model that is never imported is invisible to autogenerate. See the import
    note in alembic/env.py.
    """


@lru_cache
def get_engine() -> AsyncEngine:
    '''
    
    '''
    settings = get_settings()

    return create_async_engine(
        settings.app_url,
        poolclass=NullPool,
        connect_args={
            "statement_cache_size": 0,
            "prepared_statement_cache_size": 0,
        },
    )


@lru_cache
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    """
    
    """
    return async_sessionmaker(
        bind=get_engine(),
        expire_on_commit=False,
        autoflush=False,
    )


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request, closed when it ends.

    Use it as `session: Annotated[AsyncSession, Depends(get_session)]`. One
    session per request is the rule — sharing one across requests shares a
    transaction, and concurrent requests then see each other's uncommitted
    writes.
    """
    async with get_sessionmaker()() as session:
        yield session
