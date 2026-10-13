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
- **A test that calls the resume routes monkeypatches `resumes.get_supabase`**
  (and `sent_resumes.get_supabase` for sent resumes). The routers call it
  directly rather than through `Depends`, so a dependency override misses it
  and the test uploads to the real bucket. `tests/test_sent_resumes.py`'s
  `storage` fixture is the pattern: an in-memory bucket that records uploads
  and removals.
- **The import's database half is barely tested.** Only its clearing of
  cached keywords is (`tests/test_keyword_match.py`, which runs
  `import_feed` on `get_engine()`, the pattern for more); the rest can get
  tests the same way through the `database` fixture below.

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
- **The test database gets Supabase's search path** (`"$user", public,
  extensions`). pgvector lives in `extensions`, so without it a cosine
  query (`<=>`) fails with "operator does not exist", which production never
  sees (KAN-212).
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
- **The recommender and Scout read the bank, never an uploaded resume**
  (KAN-212). `GET /jobs/recommended` scores against the bank and its
  embedding (`app/services/matching/CLAUDE.md`); Scout's facts come from
  the bank's API shape (`routers/bank.py`'s `bank_response`) through
  `workit_scout.facts`. An uploaded resume only feeds import.
- **A student reaches only the postings the Jobs page lists**
  (`services/postings.py`'s `LISTED`: published and scraped). Tailor (run
  and Done), the keyword match and Apply load a posting through
  `postings.listed`, so a company's draft or a closed posting answers 404
  and its text never reaches a model. The one exception: a tailored
  resume's keyword match against its own posting, which still works after
  the posting closes. A route that loads a `Job_Post` by id alone skips
  this check.
- **Identity fields load through `app/services/identity.py`**
  (`load_identity`), for Scout's model seam and the bank embedding alike.
  A resume's header prints them from `built_resumes.load_header_identity`
  (`resume_render.HeaderIdentity`): display, never model input, so the
  two names stay apart.
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
- **Every resume feature reads the built resume view**
  (`app/services/resume_view.py`, KAN-207): one pure function from the bank
  and a built resume's choices to what the resume shows. The PDF, the Word
  file, Tailor, the sent resume's hash and the editor read that shape; a rule
  about what shows goes there, never into one reader. Built resumes are
  written only through `services/built_resumes.py`.
- **The editor writes a resume's choices in one PATCH**
  (`.../built-resumes/{rid}/choices`, KAN-218): hide, show, move (the
  client renumbers the siblings), the GPA and coursework toggles, typed
  wording and a wording switch, all saved together. Every id is checked
  against the applicant's bank first (404, nothing written). A tray item
  with no row gets one at the end of its siblings, and an entry brings its
  row-less bullets. Typed wording is the resume's one local variant
  (`bank_bullet_variants.built_resume_id`); typing the original back
  deletes it; another resume's local variant is never offered. Fit to One
  Page is `POST .../fit` (`fit_to_one_page`, order from
  `resume_view.fit_order`), which renders between rounds, so it is slow
  (two or three renders) and its tests need Tectonic. Tests:
  `tests/test_resume_editor.py`.
- **Every download is a sent resume** (KAN-208): `POST
  /applicants/{id}/sent-resumes` renders through `services/sent_resumes.py`,
  which hashes the view, template and header text first and returns the last
  sent resume on a repeat for the same built resume. `format: "docx"`
  keeps the Word file the same way (its hash adds the format, so a PDF and
  a Word file of one resume are two sent resumes; a built resume only).
  `GET .../render` and `.../docx` return the file unkept: the editor's
  preview and the tests read them, and no download button calls them. The service takes the
  Storage client from the router and flushes, never commits; when a new row's
  commit fails, the router removes the uploaded file. **Apply** (KAN-220) is
  the same POST with `job_posting_id` and exactly one of `built_resume_id`
  or `uploaded_resume_id` (422 otherwise; 404 for a posting the Jobs page
  does not list). An uploaded resume makes no new file, so a failed commit must not
  remove its file: the router removes only a built sent resume's. **A stored file
  is removed only when `file_in_use` says no row needs it**: the uploaded
  resume delete and the sent resume delete both check it, because a sent
  resume can point at an uploaded resume's file.
- **The resume limit is 5, uploaded plus base resumes**
  (`services/built_resumes.py`'s `check_room`, called by Generate and by
  upload before anything is written; 409 with the reason). Tailored and sent
  resumes do not count.
- **Every model feature counts its daily uses through `app/services/usage.py`**
  (KAN-210): `uses_left` before the call (429 at 0), `count_use` only after
  it succeeds, so a failed or rejected call costs the student nothing.
  What a failure says comes from one `services/ai_messages.AIMessages`
  per route (its own spent, offline and lost lines; the mapping from
  `ScoutUnavailable` is shared). Routes under `/applicants/{id}` check the
  path with `deps.owned_applicant`, or `assert_applicant_owns` when they
  also need the account.
  `count_use` flushes and never commits, like every service: the router
  commits it with the request's other writes (Tailor's generated base
  resume, the keyword cache), and a route that forgets the commit counts
  nothing (`tests/test_usage.py`). Each
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
  counted from the assistant lines the browser sends after the student
  first speaks (an opening question before that is not a follow-up;
  the bank page keeps its opener out of the chat it sends anyway), and a fourth question
  is replaced by a fixed wrap-up line; a reply that fails the schema, or
  drafts another section, is an `error` line and does not count; a field
  the model echoes as an identity placeholder (`[link]`) keeps the card's
  value. **The reply is NDJSON like Scout's, but not streamed token by
  token, on purpose**: the draft is one JSON object that must pass the
  schema and the section check, and a fourth question is swapped for the
  wrap-up line, all before the student reads a word. Streaming the reply
  first would show text that a rejected answer then contradicts, and lose
  the chain's failover once text has gone out. The reply is one short
  sentence, so the wait is the model's, not the stream's. **The prompt wording is still open**: tune it with
  `app.scripts.intake_test_set` against a live model, and re-run that
  script before a new endpoint joins the chain.
- **The keyword match** (KAN-215) is `GET .../built-resumes/{rid}/keyword-match`
  over `services/keywords.py`: a job posting's keywords, extracted once by
  the model and cached on the posting with a hash of its description, and
  the pure count of those the built resume view shows (text and skills,
  whole words, ignoring case). **Only an extraction spends a use, and it
  counts under `TAILOR`**; a cached match is free, for every student. Tailor
  (KAN-217) reads them through the same `keywords.ensure` (the cache, else
  an extraction stored on the posting) and counts its run once, not once
  more for the extraction. Which use an extraction spends stays in each
  router. Tests:
  `tests/test_keyword_match.py` (the cache, its clearing by the import and
  by the hash, an invalid or failed reply counts nothing, the cap).
- **Tailor** (KAN-217) is `routers/tailor.py` over `services/tailor.py`.
  A run (`POST .../tailor`) proposes changes and saves nothing but the
  count; Done (`POST .../tailor/done`) saves the accepted ones on the
  posting's one tailored resume, approved wordings as bullet variants for
  the posting. Rules, each with a test in `tests/test_tailor.py`:
  - **The truth rule is one pure function**, `services/truth_rule.py`'s
    `invented` (tested directly, `tests/test_truth_rule.py`): a wording
    with a number or tool in neither its original bullet nor the bank's
    skills is dropped from the proposals and refused (422) at Done, since
    the browser can send any text. Change what counts as a tool there and
    nowhere else.
  - **A missing keyword that is nowhere in the bank is a question**
    ("Have you used X?"), never words. Yes adds the skill through the
    bank's own routes and shows it, with no AI call.
  - **The model sees handles (b1, e1), never ids**, and no links: an
    entry's link field is left out and the seam removes identity data.
    Postgres text search (`ts_rank`, the posting's words OR'd) ranks the
    bullets: the best 40 go to the model, and the rank proposes each
    entry's bullet order. A posting with no description is read by its
    title, with `weak_match`.
  - **One run is one `TAILOR` use**, counted after the model answers and
    the proposals are built; a keyword extraction inside the run is not a
    second use. A run with no base resume generates one first (saved with
    the count; the 5-resume limit applies).
- **The editor assistant** (KAN-221) is `routers/assistant.py` (`POST
  .../built-resumes/{rid}/assistant`) over `services/assistant.py`. The
  model only **reads** the student's message into one action (fit, hide,
  move_up, move_down, shorter, none); the editor applies it through the
  choices PATCH or Fit, so the route saves nothing but the count. **Every
  line the student reads is the service's fixed text**, never the model's,
  so the assistant cannot reword by talking. The only model text that
  reaches the student is a "Make it shorter" wording, and only when it is
  shorter than what the resume shows, `truth_rule.invented` finds
  nothing against that wording, the bank's original and the skills, and
  it holds no identity placeholder (`placeholders_in`); else the answer is
  `none`. It saves only when the student uses it (as typed
  wording). One `ASSISTANT` use per answered message (cap 10, share 10%:
  on top of the spec's four shares, which already fill the pool, so a busy
  day can overshoot the pool by that much). Tests:
  `tests/test_editor_assistant.py`.
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
- **Apply `bb8c9c6dee0b` with or after KAN-202's review fixes.** It only
  changes two foreign keys (no column the code maps), so either order
  works. Before it, a hard-deleted posting still cascades to tailored
  resumes and their bullet variants.
- **Apply `f2b8d6c4a913` before deploying KAN-217.** It adds
  `bank_bullet_variants` and `built_resume_bullets.variant_id`, which the
  model maps, so Generate's inserts fail on a database without it.
- **Apply `e1c4a7b9d215` before deploying KAN-215.** It adds
  `job_postings.keywords` and `keywords_hash`, which the model maps, so
  company job creation and the feed import fail on a database without them.
- **Apply `5753545063f3` before deploying KAN-207.** It adds
  `applicant_profiles.default_built_resume_id`, which the model maps, so the
  new code's signup INSERT fails on a database without it
  (`app/models/CLAUDE.md`, "A new column reaches the database...").
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
