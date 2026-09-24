'''
Stub of Supabase's auth.users, so the account tables' foreign key on it has a
table to resolve against in Base.metadata.

Supabase owns and migrates the real table; this declares only the one column
our foreign keys point at. alembic/env.py's include_object drops every
non-public schema, so autogenerate never creates, alters or drops it. Never
query it through this stub or add columns to it — read identity from the
verified token (app/deps.py) instead.
'''
from sqlalchemy import Column, Table, Uuid

from app.db import Base

auth_users = Table(
    "users",
    Base.metadata,
    Column("id", Uuid, primary_key=True),
    schema="auth",
)
