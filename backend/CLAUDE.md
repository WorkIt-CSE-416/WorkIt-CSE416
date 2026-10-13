# CLAUDE.md — backend

The Python API. Loads on top of the root `../CLAUDE.md`, which holds the
repo-wide database and auth guardrails; this file does not repeat them.

## Where this folder sits

`backend/` is the whole Python project: its own `pyproject.toml`, `.venv`,
lockfile and tooling. It shares no code with `frontend/`; the two talk over
HTTP. The scraper is no exception: `app/scripts/import_jobs.py` reads
`scraper/feed.json` (or the committed `data/feed.json` snapshot) as data and
imports none of its code.

**The one exception is `../scout/`**, installed here as the `workit-scout`
package: a library with no database or HTTP of its own, handed everything by
`routers/scout.py`. Read `../scout/CLAUDE.md` before touching Scout.

**Not PostgREST, deliberately.** Queries go to Postgres directly over asyncpg,
because the job search needs ltree containment and trigram ranking, which
PostgREST's filter syntax expresses badly. `supabase-py` is installed only for
**Storage** and the **Auth admin API**; `get_supabase()` in `app/db.py` builds
that one service-role client. Database queries always go through SQLAlchemy.

## Commands

Always `uv run ...`, which runs inside `.venv` without activating it (activate
scripts differ between macOS and Windows). Add dependencies with `uv add`;
`pip install` writes nothing to `pyproject.toml` and the next `uv sync` undoes
it.

```
uv sync                                        install deps from the lock
uv run uvicorn app.main:app --reload           dev server on :8000
uv run pytest                                  the tests in tests/ (database tests: Tests against real Postgres)
uv run ruff check .                            lint (CI runs it)
uv run alembic revision --autogenerate -m msg  write a migration
uv run alembic check                           fail if models lack a migration
uv run alembic upgrade head                    apply migrations (the user runs it, never Claude)
uv run python -m app.scripts.import_jobs       feed.json → job_postings, job_role_tags (--dry-run rolls back)
uv run python -m app.scripts.intake_test_set   intake's fixed test set against the SCOUT_* model (by hand, never CI)
python3 scripts/fetch_tectonic.py              Tectonic + warm cache into vendor/ (resume PDFs; once per checkout)
```

Migrations: read `alembic/CLAUDE.md` before writing one; it has the offline
`--sql` check that needs no credentials. Never run `alembic init` again: it
overwrites `alembic/env.py` and its schema filters.

### The feed import

**Claude never runs it against a shared database**, same rule as `alembic
upgrade`. The user runs it, `--dry-run` first. It upserts on `apply_url`, so a
re-run is safe, and it refuses (exit 2, nothing written) to close more than
half the published scraped jobs at once unless given `--allow-mass-close`. The
module docstring has the steps.

- **It is the only way scraped jobs enter the database**, because it runs the
  location and role resolvers and writes `job_locations` and `job_role_tags`. A
  scraped row written any other way never shows up in the location or role
  filter (`app/models/CLAUDE.md`, the resolver sections). Its report ends with
  the titles that named no role, most jobs first: the list to grow the aliases
  from.
- **It refuses (exit 2, nothing written) when `job_roles` lacks a slug the
  aliases name**, which is what it does before the role migrations
  (`362182aaa4fd`, `ab07572bba38`) are applied. The API reads those tables and
  the weighted `fts` index (`a70c641b2f99`) too, so those migrations are
  applied before the code that reads them deploys. Otherwise every scheduled
  import fails, and the Jobs page's role filter and search answer 500.
- **`824f0b2e3d84` goes on *after* the deploy, alone.** It drops KAN-172's
  `roles` and `role_category` columns, which the code before KAN-155 selects
  on every `GET /jobs` and writes on every import. The order is: apply up to
  `a70c641b2f99`, merge and deploy, then `uv run alembic upgrade head`. A plain
  `upgrade head` before the deploy takes the live Jobs page and the scheduled
  import down.
- The feed's `roles` keys (KAN-172) are ignored: `JobListing` doesn't declare
  them, so a new scraper key never fails the import. A job's roles are its
  `job_role_tags`, resolved from its title (KAN-155).
- A `--dry-run` writes and rolls back, leaving dead rows until autovacuum, so
  table sizes read right after one are inflated.

### Tests

- **A new resume that parses wrong becomes a fixture first.** Add its text to
  `tests/fixtures/` with its expected output in `tests/test_resume_parser.py`
  before touching `app/utils/resume_parser.py`. The heuristics interact: a fix
  for one layout has broken another more than once. Fixtures are real resumes
  cut to start at the first section header, so no contact details are
  committed.
- **A test that calls the resume routes monkeypatches `resumes.get_supabase`.**
  The router calls it directly rather than through `Depends`, so a dependency
  override misses it and the test uploads to the real bucket.
- **The import's database half has no tests yet.** It can now get them through
  the `database` fixture below.

### Tests against real Postgres

A test that reads or writes tables asks for the `database` fixture
(`tests/conftest.py`). It runs against a local Postgres with pgvector, never
Supabase. Start the container once; it can stay up between runs:

```
docker run -d --name workit-test-db -e POSTGRES_PASSWORD=postgres -p 54330:5432 pgvector/pgvector:pg15
uv run pytest
```

- **Each run makes its own database** (`workit_test_<random>`) on that
  container, creates the `auth.users` stub, migrates it to head through
  Alembic, and drops it at the end. Parallel runs from several worktrees share
  the container but never a table. `TEST_DATABASE_URL` points at another server
  (default `postgresql://postgres:postgres@localhost:54330/postgres`).
- **Nothing reaches Supabase.** `conftest.py` sets `DATABASE_URL` and
  `DIRECT_URL` to the test database before the app reads them (exported
  variables beat the root `.env`), and refuses a `TEST_DATABASE_URL` whose host
  is not localhost. The app's own `get_session` uses the test database, so do
  not override it in these tests.
- **Without the container, database tests skip** with a message saying how to
  start it; the rest run. In CI (`CI` set) they fail instead, so a broken
  service never passes as green. CI's backend job runs the same image as a
  service (`../.github/CLAUDE.md`).
- **Cleanup:** after each test, every table the migrations left empty is
  truncated, `auth.users` included. Seeded tables (`job_roles`, `locations`)
  keep their rows; a test that changes a seeded row must put it back.
- **Write them `async def` with `pytestmark = pytest.mark.anyio`** (anyio's
  pytest plugin comes with FastAPI; no pytest-asyncio). Call the API through
  `httpx.AsyncClient(transport=httpx.ASGITransport(app=app))`, which shares the
  test's event loop with the session. `database` yields an
  `async_sessionmaker`: seed with `async with database() as s:`, and
  `s.commit()` so the API's own session sees the rows.
- **Override `get_current_account`, not the token.** It verifies against
  Supabase's keys; return an `AuthenticatedAccount` for a seeded row. A
  profile row needs its `auth.users` row first. `tests/test_database_smoke.py`
  is the pattern.
- **A failed migration fails every database test.** The chain runs from
  scratch on each run, so a migration that only works on top of the shared
  database's history shows up here first.

## Code layout

Find files with a directory listing; these are the rules for where code goes.

- **Routers** (`app/routers/`): one domain per file, registered in
  `app/main.py`. Read `app/routers/CLAUDE.md` before adding or changing a route.
- **SQLAlchemy models and Pydantic schemas are separate layers.** Models
  (`app/models/`) are database rows, schemas (`app/schemas/`) are request and
  response shapes. Collapse them and the first internal column you must hide
  leaks. Read
  `app/models/CLAUDE.md` before adding or editing a model.
- **Services** (`app/services/`): logic with no HTTP or database of its own.
  Never in `models/`, whose `__init__` imports every file as a model. Job
  matching: `app/services/matching/CLAUDE.md`. Resume PDFs (LaTeX through
  Tectonic): `app/services/resume_render/CLAUDE.md`. A service that reads or
  writes rows (the experience bank, `services/bank.py`) takes the caller's
  session, flushes and never commits, so the router owns the transaction and
  one request can make many changes atomically (an import saving many
  entries).
- **The experience bank is written only through `services/bank.py`.** It
  holds the ownership scoping, the duplicate check and the clearing of the
  bank embedding on every entry, bullet or skill change (a skill link is
  not one: the embedding text never says which skill goes with which
  entry); a route or script
  that writes `bank_*` rows itself leaves the recommender on a stale
  embedding. Schema rationale: `../docs/resume.md`, "The experience bank".
- **Import never writes** (KAN-211). `POST /applicants/{id}/bank/import`
  re-reads an uploaded resume's stored `raw_text` with the heuristic parser
  and returns draft entries and skills (`services/bank_import.py` maps them,
  pure); the student saves each through the bank's own routes. It re-parses
  rather than reading `parsed_json`, so a resume uploaded before the parser
  learned a section still imports it. A draft must already be a valid
  `POST /entries` body: the mapper clips text to the field limits and drops
  dates that do not fit together rather than send a draft that answers 422.
- **Model parsing** (KAN-222) is import's `read_with_ai: true`, and its
  fallback when the parser finds no entries. It counts a `PARSING` use only
  when the reading succeeds; the response always carries `read_by` and
  `uses_left`. An asked-for reading answers 429 at the limit and 503 when the
  model fails; the fallback stays quiet and keeps the parser's reading. The
  prompt and checks are in `services/bank_import.py`; the rules are in
  `app/utils/CLAUDE.md`, "The model upgrade path". Tests:
  `tests/test_bank_import.py` (checked drafts, no identity data in the
  prompt, an invalid or failed reply counts nothing, the cap and the share).
- **Every model feature counts its daily uses through `app/services/usage.py`**
  (KAN-210): `uses_left` before the call (429 at 0), `count_use` only after
  it succeeds, so a failed or rejected call costs the student nothing. Each
  route returns the uses left (Scout: a final `usage` NDJSON line). The limits
  are `AI_*` settings in `app/config.py`: a cap per student and a share of
  `AI_DAILY_POOL` per feature, per UTC day, defaults from the spec. The counts
  live in `ai_usage_counters` (one row per account, or the pool with a NULL
  account, per feature and day). Never count in memory: a restart or a second
  Vercel instance resets it. Check-then-count can overshoot by one under
  concurrent requests, on purpose; it errs toward the student.
- **Intake** (KAN-213) is `routers/intake.py` (`POST /intake/turn`) over
  `services/intake.py`, which holds its frozen system prompt. It uses
  Scout's model chain (`get_llm`) and `LLM.complete_json` with the bank's
  entry schema (`schemas/intake.py`'s `IntakeDraft` is `EntryCreate` with an
  optional title), and stores nothing said: the browser sends this entry's
  chat and the card, edits included, every turn. Rules, each with a test in
  `tests/test_intake.py`: at most `MAX_FOLLOW_UPS` (3) questions per entry,
  counted from the assistant lines the browser sends, and a fourth question
  is replaced by a fixed wrap-up line; a reply that fails the schema, or
  drafts another section, is an `error` line and does not count; a field
  the model echoes as an identity placeholder (`[link]`) keeps the card's
  value. **The prompt wording is still open**: tune it with
  `app.scripts.intake_test_set` against a live model, and re-run that
  script before a new endpoint joins the chain.
- **Utils** (`app/utils/`): the resume parser; `app/utils/CLAUDE.md`.
- **Scripts** (`app/scripts/`): commands run by hand,
  `uv run python -m app.scripts.<name>`.
- **`data/places.tsv`** is the location resolver's gazetteer, generated from
  GeoNames by `scripts/build_geonames.py` (CC BY 4.0). Never edit it by hand.
- **`data/feed.json`** is the import's default input when no local scraper run
  has written one (`config.default_scraper_feed()`; `SCRAPER_FEED` overrides).
  It must validate against `app/schemas/jobs.py`: refresh it in the same
  commit as any change there.
- **The schema notes in `../docs/`** (`resume.md`, `avatar.md`,
  `job_posting.md`, `auth.md`) are design rationale, never the source of truth
  for schema.

## Conventions

- **Routes are `async def`.** Blocking work inside an async route stalls the
  event loop for every request; blocking calls go through `asyncio.to_thread`.
- **One session per request**, through `get_session` in `app/db.py`. A shared
  session shares a transaction, and concurrent requests see each other's
  uncommitted writes.
- **Prefer SQLAlchemy Core for queries**, the ORM where object graphs help.
  Core composes the search endpoints' many optional filters cleanly. The ORM's
  lazy loading fails in async code with `MissingGreenlet`: load relationships
  explicitly with `selectinload()`.
- **Comments explain why.** A non-obvious setting gets a sentence on what
  breaks without it.
- **The app starts with no credentials.** `/health` works without the root
  `.env`; only `/health/db` and routes that read real data need it. That lets
  someone work on one half without the other, and makes a failure point at one
  side.
- **A screen whose data is live shows an error when this API fails, never its
  `data.ts` fixture**, which would pass made-up rows off as real. Design new
  endpoints against a screen's `data.ts` fixture shape: it becomes the fetch
  once the endpoint exists, leaving `page.tsx` untouched.

## The database

| Variable               | Used by       | Value                                               |
| ---------------------- | ------------- | --------------------------------------------------- |
| `DATABASE_URL`         | The app       | Transaction pooler, port 6543                       |
| `DIRECT_URL`           | Alembic only  | Session pooler, port 5432; DDL needs one session    |
| `SUPABASE_URL`         | Storage, Auth | Project URL; also where the JWKS lives              |
| `SUPABASE_SERVICE_KEY` | Storage, Auth | Service-role key: bypasses RLS, creates users       |

- **`.env` lives at the repo root, not in `backend/`.** Start it from the root
  `.env.example`; to fill a fresh worktree's, see the root `CLAUDE.md`'s
  Conventions.
- **`ENV_FILE` in `app/config.py` resolves the root path from `__file__`**,
  not the working directory. pydantic's default `env_file=".env"` would find it
  from the root and silently miss it from `backend/`, where uvicorn and alembic
  run.
- **Keep the two URLs separate.** One URL appears to work until a migration
  hangs or prepared statements fail under load. Paste Supabase's strings as
  given (`config.py` rewrites them to `postgresql+asyncpg://`), URL-encoding a
  password containing `@`, `/`, `:` or `#`; otherwise the URL parses wrong and
  the error does not say why.
- **Engine settings are not optional.** `app/db.py` sets `NullPool` because
  Supavisor already pools, and `statement_cache_size=0` plus
  `prepared_statement_cache_size=0` because the transaction pooler hands each
  statement to any free backend: a prepared statement made on one is absent on
  the next, and queries fail intermittently under load, never in development.
  Both cache settings go in `connect_args`; passed to `create_async_engine()`
  they raise `TypeError: Invalid argument(s)`.
- **CI runs the whole migration chain** on an empty Postgres before the
  database tests, so two heads or a broken migration fail the PR. **Still
  open:** `alembic check` (model drift) is not a CI gate yet
  (`alembic/CLAUDE.md`).

## Deployment

Vercel, its own project (Root Directory `backend`), the whole app one Vercel
Function (`[tool.vercel] entrypoint` in `pyproject.toml`; Vercel installs from
`uv.lock`). Chosen in KAN-146 over Render (free tier sleeps and takes ~1 minute
to wake, so sign-in looked broken), Railway, Fly.io and Cloud Run (no usable
free tier). Render with a Dockerfile is the fallback.

- **Production env vars:** `DATABASE_URL`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_KEY`, and Scout's `SCOUT_*` (`../scout/CLAUDE.md`, "Which
  model, where"); without `SCOUT_*` every Scout reply is "offline". The
  `AI_*` usage limits are optional (defaults in `app/config.py`). **Never
  `DIRECT_URL`**: migrations run by hand, locally, and the deployed API has no
  business holding that connection. `GEMINI_API_KEY` is read but unused until
  matching embeds (`app/services/matching/CLAUDE.md`); set it here and as an
  Actions secret then.
- **`GET /jobs` reads `job_postings`**, filled by the import on a schedule
  (`../.github/CLAUDE.md`). A deploy changes no jobs, and an empty table is an
  empty feed, not an error.
- **When the feed gains a column: migration, then import, then deploy.** An
  import against the older schema fails on the unknown column and, being one
  transaction, writes nothing.
- **`vercel.json`'s build command fetches Tectonic** (pinned, SHA-256
  checked) and warms its cache into `vendor/`, which the function bundles.
  A build that cannot fetch it fails rather than shipping without TeX
  (`app/services/resume_render/CLAUDE.md`).
- **`../scout` is bundled as a non-editable path source.** uv copies it into
  site-packages at build time; an editable install would point at a folder the
  function lacks.
- **`NullPool` makes serverless safe**: each invocation opens one connection
  through Supavisor's transaction pooler, so scale-out cannot exhaust Postgres.
  It costs ~0.5 s per `/jobs` request (measured 2026-10-07); cache the
  response if the feed must be faster.
- **Still open:** the 4.5 MB request-body limit against the 5 MB upload cap
  (`../frontend/CLAUDE.md`, Deployment).

## Auth

Supabase Auth issues tokens; this API only verifies them and decides what the
account may do. It never hashes a password or signs a token. Read
`../docs/auth.md` before changing sign-up, sign-in, OAuth, token verification or a
Supabase Auth dashboard setting: it has the flow, the dashboard settings and
why each rule exists.

- **Signup goes through `POST /auth/signup`, never `supabase.auth.signUp()`**,
  so the account type lands in `app_metadata` (only the service-role key can
  write it). If any profile write fails, the route deletes the auth user it
  just made; every write sits inside that one `try`.
- **Whoever acts on a token verifies its signature**, in one place, used by
  every protected route: `get_current_account` (`app/deps.py`), which reads `Authorization: Bearer` (never a cookie) and verifies against
  the project's JWKS, ES256/RS256 only. The legacy HS256 shared secret is
  unsupported on purpose: it can mint tokens.
- **Access decisions read the profile row and `app_metadata`**, never
  `user_metadata`, which the user can edit. `company_id` and onboarding state
  come from the row, never the token.
- **Derive identity from the verified token**, never from a client-supplied
  `company_id`, `profile_id` or role. Company-scoped endpoints check for an
  active membership; role checks are Python guards.
- **Authorization is Python.** SQLAlchemy's role bypasses RLS, so a policy
  written against it is dead code that reads as a security control. RLS stays
  enabled with no policies on every table; data a screen needs goes through an
  endpoint here, never through a policy that "opens up" a table.
- **The Next proxy is not a security boundary.** This API is reachable without
  Next, so every endpoint checks for itself.
- **"Allow new users to sign up" stays ON** in the Supabase dashboard, or
  first-time OAuth sign-in fails with `signup_disabled` (`../docs/auth.md`).

Still open:

- Email verification and password reset: supported by Supabase, not wired up.
- Deleting an account cascades its rows but not its Storage objects
  (`Resume/<id>/`, `Avatar/<id>/`).
- Joining an existing company: no endpoint; the form's Join tab is a
  placeholder.
- Every signup `IntegrityError` answers "An account with this email already
  exists", including a taken `company_profiles.contact_email`. Tell them apart
  by constraint name in `exc.orig`.
- Nothing sets a membership's `onboarding_completed_at`, so `/auth/me` always
  reports a company as not onboarded. Whatever builds company onboarding must
  set it.
