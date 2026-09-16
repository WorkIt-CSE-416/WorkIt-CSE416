"""
Alembic environment file that's run top to bottom everytime Alembic runs
"""

import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context
from app.config import get_settings
from app.db import Base
from app import models  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# Schemas Supabase owns
SUPABASE_SCHEMAS = frozenset(
    {
        "auth",
        "storage",
        "realtime",
        "_realtime",
        "supabase_functions",
        "supabase_migrations",
        "extensions",
        "graphql",
        "graphql_public",
        "vault",
        "pgbouncer",
        "pgsodium",
        "pgsodium_masks",
        "cron",
        "net",
    }
)


def include_name(name: str | None, type_: str, parent_names: dict) -> bool:
    """Filter at the schema level, before reflection descends into it.

    Only consulted for schemas when `include_schemas=True`. We keep that off,
    so this is the guard for whoever turns it on later — cheaper to leave here
    than to rediscover the hard way.
    """
    if type_ == "schema":
        return name is None or name == "public"

    return True


def include_object(
    obj: object,
    name: str | None,
    type_: str,
    reflected: bool,
    compare_to: object | None,
) -> bool:
    """Filter individual tables, columns and indexes.

    Belt and braces with include_name: this also catches a reflected object
    that carries an explicit foreign schema, and it keeps working if anyone
    flips `include_schemas` on without reading the note above.
    """
    schema = getattr(obj, "schema", None)

    if schema is not None and schema != "public":
        return False

    return True


def configure_context(**kwargs: object) -> None:
    """Shared configuration, so offline and online modes cannot drift apart."""
    context.configure(
        target_metadata=target_metadata,
        include_name=include_name,
        include_object=include_object,
        # Only reflect the default schema. Alembic's default, set explicitly
        # because on Supabase it is the difference between a clean diff and a
        # migration that drops the platform.
        include_schemas=False,
        # Detect a column whose type changed. Off by default in older Alembic;
        # worth having, and cheap.
        compare_type=True,
        # Left off deliberately. Server defaults like `gen_random_uuid()` and
        # `now()` round-trip through Postgres as differently-spelled but
        # equivalent expressions, so enabling this reports changes on every run
        # for tables nobody touched.
        compare_server_default=False,
        **kwargs,
    )


def run_migrations_offline() -> None:
    """Emit SQL to stdout instead of running it — `alembic upgrade --sql`.

    Useful for review, and for handing DDL to someone with the privileges to
    apply it. Needs no database connection.
    """
    configure_context(
        url=get_settings().migration_url,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    configure_context(connection=connection)

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    configuration = config.get_section(config.config_ini_section, {})

    # Set here rather than in alembic.ini so the password never reaches version
    # control. DIRECT_URL is the SESSION pooler (5432): DDL takes locks and
    # needs one serial conversation, which the transaction pooler cannot give.
    configuration["sqlalchemy.url"] = get_settings().migration_url

    connectable = async_engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
