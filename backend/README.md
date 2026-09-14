# WorkIt API

The Python backend. It owns the database; the Next.js app in `frontend/` talks
to it over HTTP and never queries Postgres itself.

Stack: **FastAPI** served by **Uvicorn**, with **SQLAlchemy 2.0** (async, over
asyncpg) for queries and **Alembic** for migrations.

There are no tables yet — the schema is still being designed, and the wiring
landed first on purpose so that work has somewhere to go. See
`frontend/docs/backend-integration.md` for what is decided and what is not.

## Setup

The only prerequisite is **[uv](https://docs.astral.sh/uv/)**. It installs
Python itself, so there is no system Python, `pip` or `venv` to sort out first.

**macOS**

```bash
brew install uv
cd backend
uv sync
uv run uvicorn app.main:app --reload
```

**Windows (PowerShell)**

```powershell
winget install --id=astral-sh.uv -e
cd backend
uv sync
uv run uvicorn app.main:app --reload
```

Only the first line differs. Everything after it is identical on both, which is
why we prefix commands with `uv run` instead of activating the virtualenv.

Then open <http://localhost:8000/health> — you should get `{"status":"ok"}`.

For database access, copy `.env.example` to `.env` and fill in both connection
strings from the Supabase dashboard, then check
<http://localhost:8000/health/db>. Everything except that one endpoint works
without credentials.

Notes:

- No Homebrew or winget? Use the standalone installer:
  `curl -LsSf https://astral.sh/uv/install.sh | sh` on macOS, or
  `irm https://astral.sh/uv/install.ps1 | iex` in PowerShell.
- If `uv` is not found right after installing, restart your terminal.
- `uv sync` is the whole setup: it reads `.python-version` and
  `pyproject.toml`, downloads CPython 3.12 if you lack it, creates `.venv/`,
  and installs the exact versions in `uv.lock`. Re-run it any time
  dependencies change.

## Commands

| Command                                       | What it does                          |
| --------------------------------------------- | ------------------------------------- |
| `uv sync`                                     | Install/update deps to match the lock |
| `uv run uvicorn app.main:app --reload`        | Dev server on port 8000, hot reload   |
| `uv add <package>`                            | Add a dependency and update the lock  |
| `uv run <anything>`                           | Run a command inside the venv         |
| `uv run alembic revision --autogenerate -m x` | Write a migration from the models     |
| `uv run alembic upgrade head`                 | Apply pending migrations              |
| `uv run alembic downgrade -1`                 | Undo the last one                     |
| `uv run alembic current`                      | Which revision the database is on     |
| `uv run alembic check`                        | Fail if models have no migration      |

**You never activate the virtualenv.** `uv run` does it for you, which is the
main reason we use uv: `.venv/bin/activate` on macOS and
`.venv\Scripts\Activate.ps1` on Windows would otherwise mean two sets of
instructions and two ways to forget. Prefix commands with `uv run` and the
platform difference disappears.

## Try the docs

With the server running, open <http://localhost:8000/docs>.

FastAPI reads the type hints on your route functions and generates an
interactive OpenAPI page from them — every endpoint, its parameters, its
response shape, with a button to call it. It is not a separate thing to
maintain; it is your code, reflected. `/redoc` is the same content in a
different layout.

## Running alongside the frontend

Two servers, two terminals, two ports:

| Service       | Port | Start                                         |
| ------------- | ---- | --------------------------------------------- |
| Next.js app   | 3000 | `npm run dev` (from the repo root)            |
| This API      | 8000 | `uv run uvicorn app.main:app --reload`        |

They communicate over plain HTTP — the frontend `fetch`es this API. Nothing
sits between them. Note that `localhost:3000` and `localhost:8000` are
different origins, so a request made from browser JavaScript needs CORS
configured here; one made from a Next.js Server Component does not. That choice
is still open and is recorded in `frontend/docs/backend-integration.md`.

## The database layer

Nothing defines a table yet. `app/db.py` holds the engine, the session factory
and the declarative `Base`; `alembic/versions/` is empty and
`--autogenerate` correctly produces an empty migration until the first model
exists. That is the expected output, not a broken setup.

### Two connection strings, and the port is the difference

| Variable       | Port | Used by     | Why                                                    |
| -------------- | ---- | ----------- | ------------------------------------------------------ |
| `DATABASE_URL` | 6543 | The app     | Transaction pooler; short-lived connections need one    |
| `DIRECT_URL`   | 5432 | Alembic     | Session pooler; DDL locks need one serial conversation |

Do not collapse them. It appears to work until a migration hangs or prepared
statements fail under load. `app/config.py` rewrites both to
`postgresql+asyncpg://` automatically, so paste the URLs exactly as Supabase
gives them.

### Rules that are not negotiable

- **Never add a `sqlalchemy.url` to `alembic.ini`.** That file is committed;
  the password is not. `alembic/env.py` reads `DIRECT_URL` instead.
- **Never edit the schema in the Supabase dashboard.** It bypasses Alembic
  silently and surfaces weeks later as an unrelated failed migration.
- **Import new models in `alembic/env.py`.** A model no import reaches is
  absent from `Base.metadata`, and autogenerate will write a migration
  *dropping* the table it cannot see.
- **Read every generated migration.** Autogenerate does not emit
  `CREATE EXTENSION`, new enum values, index operator classes like
  `gin_trgm_ops`, or anything ltree — and the planned schema uses all four.

### Why env.py filters schemas

`include_name` and `include_object` restrict Alembic to `public`. Without them,
autogenerate treats Supabase's own tables as things to delete, because they are
in the database but not in `Base.metadata`. Verified against a database holding
`auth.users` and `storage.objects`:

```
with the filters:     pass                                    (empty migration)
without the filters:  op.drop_table('objects', schema='storage')
                      op.drop_table('users', schema='auth')
```

Two filters rather than one: `include_name` stops reflection descending into a
foreign schema, `include_object` catches anything that gets through and keeps
working if someone sets `include_schemas=True`.

## Windows and macOS

Both work, from the same `uv.lock`. uv resolves a universal lockfile carrying
platform markers, so one committed lock serves every machine and there is no
per-OS requirements file to keep in sync.

One difference is real and expected: **`uvloop` is not installed on Windows.**
It has no Windows support, so `uvicorn[standard]` declares it
`sys_platform != 'win32'` and uv skips it there. Uvicorn falls back to the
standard library's asyncio event loop — marginally slower under load,
identical in behaviour. Nothing to fix, and `uv sync` will not try to build it.

Everything else — `httptools`, `watchfiles`, `pydantic-core` — ships prebuilt
`win_amd64` wheels, so no C compiler or Visual Studio build tools are needed.
uv also publishes the pinned CPython 3.12 for Windows, so `uv sync` downloads
the same patch version it does on a Mac.

Commands are identical on both, which is the point of prefixing everything with
`uv run` rather than activating the virtualenv.

## Layout

```
app/
  main.py         FastAPI application; /health and /health/db
  config.py       Environment settings, and the asyncpg URL rewrite
  db.py           Engine, session factory, declarative Base
alembic/
  env.py          Migration environment — READ THE HEADER before editing
  versions/       Migrations. Empty until the first model exists
alembic.ini       Alembic config. Deliberately holds no database URL
db/
  job_posting.md  Schema design notes — rationale, not a source of truth
.env.example      Template; copy to .env (gitignored) and fill in
pyproject.toml    Dependencies and project metadata (the package.json)
uv.lock           Exact resolved versions — committed (the lockfile)
.python-version   Pinned interpreter (the .nvmrc)
```

`pyproject.toml` pins `python-preference = "only-managed"` so uv always uses an
interpreter it downloaded, never whatever Python happens to be on your machine.
Homebrew, Conda and the system Python otherwise give five developers five
different builds of "3.12".

**Install dependencies here, never at the repo root**, the same rule
`frontend/` follows. There is no npm script for any of this — root
`package.json` forwards frontend scripts only, on purpose.
