# WorkIt API

The Python backend. It owns the database; the Next.js app in `frontend/` talks
to it over HTTP and never queries Postgres itself.

Stack: **FastAPI** (the framework) served by **Uvicorn** (the server).
SQLAlchemy and Alembic arrive when the schema settles — see
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

| Command                                     | What it does                          |
| ------------------------------------------- | ------------------------------------- |
| `uv sync`                                   | Install/update deps to match the lock |
| `uv run uvicorn app.main:app --reload`      | Dev server on port 8000, hot reload   |
| `uv add <package>`                          | Add a dependency and update the lock  |
| `uv run <anything>`                         | Run a command inside the venv         |

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
  main.py         The FastAPI application and its routes
db/
  job_posting.md  Schema design notes — rationale, not a source of truth
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
