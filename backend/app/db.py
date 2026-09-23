'''
builds necessary tools from SQLAlchemy to talk with database
'''
import datetime

from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy import DateTime, func
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.pool import NullPool

from supabase import Client, create_client
from app.config import get_settings


class Base(DeclarativeBase):
    '''
    Base model of SQLAlchemy schemas
    '''

class BaseModel(Base):
    '''
    custom base model to store attributes that every subclass model would have
    '''
    __abstract__ = True
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now())



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

# For the Supabase Storage
@lru_cache
def get_supabase() -> Client:
    """
    Create a Supabase client once via LRU Cache and reuse it for every request
    """
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    return create_client(settings.supabase_url, settings.supabase_service_key)

