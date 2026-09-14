# SQLAlchemy 
- AsyncEngine is the object that talks to Postgres, then uses asyncpg to send network to supabase, and a connection pooler like Supavisor :6543 to talk with supabase 


# Alembic 
- verion folder consists of all the migration data 

The full chain for alembic upgrade head

1. CLI reads alembic.ini, finds script_location
2. Builds the EnvironmentContext and populates the context proxy
3. Executes env.py top to bottom
4. Bottom of the file: not offline → run_migrations_online()
5. → asyncio.run(run_async_migrations())
6. → reads the ini section, overwrites sqlalchemy.url with get_settings().migration_url — this is where DIRECT_URL enters
7. → builds the async engine, connects
8. → connection.run_sync(do_run_migrations)
9. → configure_context(connection=connection) → context.configure(...)
10. → context.begin_transaction(), then context.run_migrations()
11. → Alembic walks the revision chain from the database's current revision to head, calling each upgrade()