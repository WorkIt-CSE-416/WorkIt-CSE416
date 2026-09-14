'''
builds necessary tools from SQLAlchemy to talk with database 
'''

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
    '''
    Base model of SQLAlchemy schemas 
    '''


@lru_cache
def get_engine() -> AsyncEngine:
    '''
    once per process. Reach postgres directly 
    '''
    settings = get_settings()

    # establish the connection to talk with Postgres
    return create_async_engine(
        settings.app_url,
        poolclass=NullPool, # open as new connection
        connect_args={  # connect with Supabase
            "statement_cache_size": 0,
            "prepared_statement_cache_size": 0,
        },
    )


@lru_cache
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    """
    once per process, configures and makes a session 
    """
    return async_sessionmaker(
        bind=get_engine(),
        expire_on_commit=False,
        autoflush=False,
    )


async def get_session() -> AsyncIterator[AsyncSession]:
    """
    once per chat request from FastAPI whenever a shcema is declared
    """
    async with get_sessionmaker()() as session:
        yield session
