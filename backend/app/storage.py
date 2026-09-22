"""Supabase Storage client, initialised once per process."""

from functools import lru_cache

from supabase import Client, create_client

from app.config import get_settings


@lru_cache
def get_supabase() -> Client:
    """
    Create a Supabase client once via LRU Cache and reuse it for every request
    """
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    return create_client(settings.supabase_url, settings.supabase_service_key)
