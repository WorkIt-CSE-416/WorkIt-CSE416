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
uv run python -m app.scripts.ship_check ...   the connector's blind read, KAN-386 (by hand, never CI; data outside the repo)
uv run python -m app.scripts.clean_bank_entries  one-off: split "| C++, Go" off older bank titles, drop read skills the catalog lacks; --typed also drops Tailor-added degrees/"AI tools" (dry run unless --apply; local DB only)
uv run python -m app.scripts.fill_report <id>   a fill report's fix brief + form fixture into fill-reports/ (--latest; reads DATABASE_URL, writes nothing)
python3 scripts/fetch_tectonic.py              Tectonic + warm cache into vendor/ (resume PDFs; once per checkout)
```

The container image builds from the repo root, not here (Deployment):
`docker build --platform linux/amd64 -f backend/Dockerfile -t workit-api .`

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
- **KAN-233's contract is two migrations around one deploy.** Apply
  `aa97037c00e5` (moves the rows), merge and deploy, then `uv run alembic
  upgrade head` for `188c8c2d7c14` (drops the old levels). `188c8c2d7c14`
  before the deploy fails every Experience filter and count on the live Jobs
  page (`app/models/CLAUDE.md`, KAN-233).
- **Each close records why** (`job_postings.closed_reason`, KAN-412):
  `gone_from_board`, `board_gone`, `filtered_out` or `replaced`, from the
  scraper's `closings.json` beside the feed (`--closings` names another),
  else `unknown`. A reopen clears it with `closes_at`. **A missing or
  malformed file never stops the run**: its closes are real, so they go in
  as `unknown` and the report says so; a reason not in `CLOSED_REASONS` is
  filed as `unknown` too, so a newer scraper never fails the CHECK and rolls
  back the whole import. The report counts this run's closes by reason. To
  find a bad close, read the jobs one run closed (`closes_at`) by reason,
  then fix its cause and re-run: a job back in the feed reopens. Reopening
  by hand does nothing, since the next import closes a job the feed lacks.
- The feed's `roles` keys (KAN-172) are ignored: `JobListing` doesn't declare
  them, so a new scraper key never fails the import. A job's roles are its
  `job_role_tags`, resolved from its title (KAN-155).
- A `--dry-run` writes and rolls back, leaving dead rows until autovacuum, so
  table sizes read right after one are inflated.
- **After it commits, it extracts keywords** (KAN-392) for published scraped
  jobs with none (`_extract_keywords`, through `keywords.read` and Scout's
  `SCOUT_*` chain): new jobs, and changed ones, whose keywords the upsert
  cleared. At most `--keywords-limit` model calls a run (default
  `KEYWORDS_PER_RUN`, 100; 0 skips), so the backlog spreads over runs and
  quotas; `--keywords-only` runs the pass alone. Each job commits on its
  own and no transaction stays open across a model call. It reads past the
  last id tried, never "still NULL": a job whose reply fails its schema
  stays NULL, and a NULL query read it again forever. It stops at the first
  `ScoutUnavailable` (no model answers) and counts no student's use.

### Tests

- **Never test what an AI prompt says.** No test checks a system prompt's
  wording or the facts text in it, for Scout, intake, Tailor, the editor
  assistant or Read It With AI. Test behaviour instead: what a reply saves,
  counts or refuses. They were removed on 2026-10-18 as upkeep with no
  catch: a wording change broke them and proved nothing. The tests that no
  identity data reaches the model stay (`../scout/CLAUDE.md`, Tests).
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
- **A test that calls a model route swaps the model with
  `tests/fake_models.py`'s `use(fake)`**, which overrides all three
  sizes (`app/services/models.py`) at once, and `clear()` after; a test of
  which size a feature asks for overrides one itself
  (`tests/test_model_sizes.py`, Tailor's split in `tests/test_tailor.py`).
  Overriding `get_llm` alone leaves a route that asks for another size on
  the real model.
- **An auto apply test seeds a hiring system's `apply_url`** (Greenhouse in
  most; `_seed_posting(database, url)` in `tests/test_sent_resumes.py`): the
  queue refuses every host not in `app/auto_apply/hosts.py` with a 404 (a
  job board's posting with the reason, KAN-376). The
  first host rule (Greenhouse only) broke six
  database tests that seeded `example.com`; they skip without the local
  container, so only CI caught it (2026-10-17). Run them with the container
  up before pushing a change to auto apply's queue.
- **The import's database half is barely tested.** Only its clearing of
  cached keywords (`tests/test_keyword_match.py`, which runs `import_feed`
  on `get_engine()`, the pattern for more) and its closes and their reasons
  (`tests/test_import_closings.py`) are; the rest can get tests the same
  way through the `database` fixture below.

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
  not override it in these tests. It also pins `CONNECTOR_API_URL` and
  `CONNECTOR_WEB_URL` to the config defaults (`:8000`, `:3000`), so a `.env`
  serving the connector on other ports doesn't break the connector tests.
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
- **The feed's viewer is a separate override.** `GET /jobs` reads the
  viewer from the token through `get_signed_in_applicant_id`, not
  `get_current_account`, so a test that asks the feed as a student
  overrides both, or the feed serves it as signed out and lists every job
  (`tests/test_tracker.py`'s `student` fixture). A test of the Jobs page
  hiding an applied job passed locally, where the database tests skip, and
  failed in CI (KAN-413).
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
- **Queries** (`app/queries/`): the SQLAlchemy queries a router runs, one
  module per domain (`applications.py`), or a package split by job once it
  grows (`jobs/`: `filters.py`, `listings.py`, `search.py`, `facets.py`,
  `recommendations.py`). No HTTP: no `HTTPException`, no
  `Query()`, no `Depends`; a query returns a value or None and the route
  decides the status code. Before 2026-10-15 `routers/jobs.py` held all of
  it in 1,179 lines, which every jobs change had to read whole.
- **Services** (`app/services/`): logic with no HTTP or database of its own.
  Never in `models/`, whose `__init__` imports every file as a model. Job
  matching: `app/services/matching/CLAUDE.md`.
- **Every AI feature gets its model from `app/services/models.py`**
  (KAN-356), as a FastAPI dependency by size: `get_large_llm` (Tailor's
  rewrite, Read It With AI, the editor assistant), `get_small_llm` (every
  keyword extraction) or `get_llm` (Scout, intake, essay answers). A new
  feature picks a size there; it never builds an `LLM` itself, so the
  `SCOUT_*` settings stay the one place a model is named
  (`../scout/CLAUDE.md`, "Which model, where").
- **Auto apply** (`app/auto_apply/`): KAN-223's layers 1 and 2. Layer 1
  is `rules.py` pure (no session) and `queries.py` database; layer 2 is
  the steps that call them, `pipeline.py`, which every caller imports.
  `stages.py` holds what every step checks first (the application exists,
  its form is open: `open_application`, `get_application`) and the errors
  for it. `written.py` holds the written-answer steps (the questions a tab
  sends, the connector's and the Written Answers page's saves, each checked
  by `checks.py`, and the answer bank); `pipeline.py` re-exports them, so
  callers keep naming them `pipeline.save_answers` and so on, but a test
  that fakes one of their layer-1 calls patches `written`. `resume.py`
  holds the resume steps (`choose_resume`, `prepare_resume`, `FileFailed`),
  re-exported the same way. `review.py` holds the pre-submit review
  (`next_to_review`, `save_review`, `reviewed_answers`, KAN-369): once an
  application's written questions are all answered, the connector's
  `get_review_task` hands its answers out for a re-read, each with its
  version (`answer_version`, a hash of its text), and `save_review` keeps
  the answers whose version still matches, with each flag, as
  `job_applications.answer_review`; an answer edited meanwhile stays due.
  A flag may quote its sentence and mark a wrong company; the tab's flag
  card answers it with `keep` (recorded as `kept`, never flagged again as
  it stands) or `rewrite` (the answer cleared, the flag kept as `rewrite`
  for `get_next_application` to hand over with the question).
  Re-exported the same way; tests: `tests/test_connector_review.py`. A
  question asked in words (kind NULL, "text" to the connector) is
  `models/written_answers.is_text`, for a value or, given the column, in
  SQL: test a question's kind through it, never `kind`'s truth. Unlike a
  service, its functions may
  take a session; its routes still go in `app/routers/`. Its `NotFound`
  and `WrongStage` (`stages.py`, also `pipeline.NotFound`) answer 404 and
  409 from one handler each in
  `app/main.py`: a route lets them through rather than catching them. Read
  `../auto-apply/architecture.md`, "The function layers", before adding one:
  a layer-2 step that skips a layer-1 check lets any caller skip it. Its
  resume step (`prepare_resume`) keeps the file through
  `services/sent_resumes.py`, never Storage or the renderer itself, so a
  resume auto apply sends is a sent resume under Apply's rules (the repeat
  hash, the file kept while a row uses it). **A student's own pick of a queued
  job's resume** (`choose_resume`, `PUT .../applications/{job_id}/resume`,
  KAN-359) is kept the same way, as the sent resume the application names,
  and `prepare_resume` sends it in place of `pick_resume`'s (`chosen_resume`):
  no column of its own. Tests: `tests/test_auto_apply_resume.py`. **Batch
  apply's tab states live on the stage column, with no table of their own**
  (KAN-370): a ready tab stays `queued` (it waits for the student's submit),
  a tab with anything unfilled is `needs_you` (`record_fill`), and
  `next_application`'s `skip` passes over the jobs the extension already
  has open. A new stage value would be an `ALTER TYPE` and a coordinated
  deploy; add one only when a state must outlive its tab.
  **The panel's I didn't submit this** (KAN-401, `POST .../finish
  {"outcome": "unsubmitted", "state"}`) undoes a submit: only an applied
  application, its date cleared, back to the stage its tab had in
  `PUT .../fill`'s words (ready → `queued`, needs_you → `needs_you`). With
  no `state` it goes to `needs_you`, never `queued`: a queued application
  is the batch's next fill, so only a tab the extension says was Ready
  goes back into it. No column keeps the stage before applied; the
  extension, which held the tab, says it (tested in
  `tests/test_applied_at.py`). Tests: `tests/test_batch_apply.py`. **A batch tab's essay questions are
  rows in `written_answers`** (KAN-377): the tab sends the questions its
  form needs written (`PUT .../questions`), the student's own Claude saves
  each answer through the connector, and the tab reads them back
  (`GET .../questions`) to fill them. Only a queued or needs_you application
  takes questions. Tests: `tests/test_written_answers.py`. **A student
  without Claude pastes answers through the same save** (KAN-385,
  `routers/pasted_answers.py`): the Written Answers page lists every
  unanswered question by posting (`pipeline.unanswered_questions`) and
  saves through `pipeline.save_answers`, the connector's own step, so a
  pasted answer passes the same checks and the tab fills it the same way.
  Never give pasted text a save path of its own: it may come from any AI.
  The paste passes `by="student"`, which skips only the copy check against
  the student's own writing samples (that check stops their Claude
  parroting them; a student may paste their own words). Re-checks of a
  saved answer (`ask_questions`, `answer_bank`) leave the copy check out
  for the same reason: the save ran it.
  **Claude's written answer carries its Essay plan and claim check**
  (KAN-369, Apply's evidence-first writer): the plan it was written from
  (type, story, company fact, angle, and its type's slots, each with
  quotes) and the claims the prompt's check listed (`unsupported`), stored
  in `written_answers.review` as `{plan, unsupported}`. `plans.check`
  (pure, `tests/test_plans.py`) holds the plan to the sources the
  connector gave (`written._plan_sources`: the experience as
  `bank_context` writes it, skills, posting, brief facts, the
  application's other saved answers): each quote word for word and at
  least 20 characters folded, every required slot quoted, an optional one
  without dropped, the story a line of the experience leading no other
  answer on the application (anything-else and cover letters may reuse
  one), the company fact one of the brief's on a type that links the
  company; a plan's company fact is the answer's named fact when it names
  none. **A required slot nothing backs is asked, never invented**
  (Apply's Missing fact): their Claude calls `save_fact_question`
  (`written.ask_fact`), which keeps `{"ask": {question, entry_id,
  entry}}` in the unanswered row's `review`, the question opened by
  "Essay fact: " and the entry matched by its heading line as
  `bank_context` writes it. A row waiting on one is not handed to their
  Claude (`queries._not_asked`), and `GET .../questions` and the Written
  Answers page show it as `ask` and `ask_about`. The student's answer
  (`PUT .../essay-facts`, `written.answer_fact`) joins that entry as a
  bullet through `services/bank.py` and clears the ask, so the question
  goes back to their Claude with a fact to quote. A fact that belongs to
  no entry (a favorite book) stays a question for the student, as
  before. Tests: `tests/test_essay_facts.py`. **Story rotation**
  (Apply's decision 13): `get_next_application`'s `led_before` gives, by
  Question type, the stories the student's sent (applied) answers at
  other companies led with, the 3 newest each (`written.led_before`, read
  from the plans in `review`), and the prompt steers the plan off them;
  an answer saved before plans existed steers nothing. The save refuses one
  without the plan or the list, failing the plan, or still holding a
  listed claim; a choice and a paste take none, and the
  student's edit clears it (the check was of Claude's text). The server
  can't redo the check; this makes skipping it a refusal, not silence.
  There is no reader's 1-10 rating any more: Apply dropped it, since it
  raised unsupported claims from 8 to 13.
  A refusal's `Refused.reasons` holds each answer's reasons by question
  name, for the page to show under its box. Tests: `tests/test_pasted_answers.py`.
  **An answer may name the brief fact it uses** (KAN-369): the connector's
  `named_fact`, `save_answers(named=...)`, must fold-match one of the
  company brief's facts, or those of the team brief the posting names
  (the same `brief_for(company, job_id)` the connector hands out, which
  also widens the number check), or the save is refused; it is kept as
  `written_answers.named_fact` (`{"fact", "url"}`), cleared with its answer
  and by the student's own words, and the Written Answers page lists it
  with the answer (`GET .../written-answers`, `pipeline.answered_questions`).
  Tests: `tests/test_named_fact.py`.
  **Each listed answer carries `answered_at`** (KAN-369), when it was last
  saved: the page marks the student's own answers (captured from a form)
  New by it until they have seen them. Tests: `tests/test_captured_answers.py`.
  **Problem reports from the extension's panel** (KAN-403, fix reports
  KAN-369; `routers/fill_reports.py` over `queries/fill_reports.py`, table
  `fill_reports`, migrations `c4e1a9f2d803`, `e5b8d2a7c914`): `POST
  /fill-reports` stores what the student previewed and sent: job system,
  the posting's link, Fill engine version, what opened the card
  (`trigger`), the context (extension version, browser, the engine's
  recognition of the page), each field's structure and what the fill did
  with it (name, label, kind, options, selector, visible, source, the
  planned answer's shape such as `text:12`, status, reason with values out,
  read-back, error, marked, edited), the timeline (steps, errors, stacks)
  and the form's HTML with values out (`html`, at most `HTML_MAX`), and
  their note. **The row names its sender** (`account_id`, cascading with
  the account): a student lists their own (`GET /fill-reports/mine`) and
  reads one of theirs (`GET /fill-reports/{id}`; another's is 404). Values
  never reach it by design: the extension takes them out before the
  preview; every model forbids other keys, the shapes are patterns, and
  `scrub` replaces what still looks like an email or a phone in every
  free text. The body is read in chunks and refused past `BODY_MAX` (413),
  never whole. The link is http or https with no sign-in and no fragment,
  and its query keeps only the params that name the posting
  (`schemas/fill_reports.py` POSTING_PARAMS), each an id.
  **Admins** are the emails or account ids on `WORKIT_ADMINS`
  (`app/config.py`; `deps.get_admin`, 403 to anyone else): there is no
  admin role in the database. They list (`GET /admin/fill-reports`, newest
  first, `?job_system=&status=`), read, triage (`PATCH`, status new /
  triaged / fixed and a note) and export a report: `GET
  /admin/fill-reports/{id}/brief` is the Markdown fix brief
  (`services/fill_brief.py`, format in `../docs/fill-reports.md`;
  `tests/fixtures/fill_brief.md` is a golden copy, so a format change
  updates both), `.../fixture` the form's HTML as a text/plain download
  (never served as HTML: it is an employer page's markup). `uv run python
  -m app.scripts.fill_report <id>` (or `--latest`) writes the brief, the
  fixture, its question set and the report to `fill-reports/` (gitignored)
  and names the engine commit the report's engine version was built from.
  Tests: `tests/test_fill_reports.py`, `tests/test_fill_report_briefs.py`.
  **Job system requests from the extension's popup** (KAN-369,
  `routers/job_system_requests.py`, table `job_system_requests`, migration
  `d8a3f5c1e7b2`): `POST /job-system-requests {"host"}` stores the host of
  a job page WorkIt can't fill when the student presses Request this job
  system. Only a bare lower-case host name is taken (any other key, a
  scheme, port or path is 422); the row names no account, though sending
  needs a sign-in. The team ranks the next job systems with `SELECT host,
  count(*) FROM job_system_requests GROUP BY host`; nothing reads it in the
  app. Tests: `tests/test_job_system_requests.py`.
  **Save to WorkIt by a page's link** (KAN-401, `POST /jobs/saved-by-link`
  in `routers/applications.py`, `queries/applications.py`
  `listed_job_by_link`): the extension's toolbar popup on a site it can't
  fill saves the feed's listed job whose apply link is the page, the exact
  link first, else the same link without query, fragment and trailing
  slash (SQL `split_part`/`rtrim`, no index: the feed is small), through
  `save_job`. A page no listed job links to is a 404; it never makes a
  posting. Tests: `tests/test_saved_jobs.py`.
  **A student's writing samples and style card** (KAN-384) are
  `queries/writing.py`, behind `routers/writing_samples.py` (the student's
  add, replace, remove) and the connector's tools (their Claude reads the
  samples and saves the card). Tests: `tests/test_writing_samples.py`.
  **The connector is an MCP server inside this API** (`app/connector/`,
  KAN-377; `../auto-apply/architecture.md` 14.6): the official MCP SDK at
  `/mcp`, with WorkIt as its own OAuth server (`connector/oauth.py`; the
  SDK's endpoints at the root, `/authorize`, `/token`, `/register`,
  `/revoke`, `/.well-known/...`, added path by path, never a catch-all
  mount). Only Claude's own callbacks register (`oauth.CLAUDE_CALLBACKS`;
  loopback only with `connector_loopback_redirects`), so no other page can
  pose as Claude on the consent page. It answers only inside the app's lifespan, so its tests run
  `app.router.lifespan_context(app)` (`tests/test_connector.py`, which
  signs in with the SDK's own client as Claude does). Its tokens reach
  `/mcp` only. Whether a student added it is `GET
  /applicants/{id}/connector` (`oauth.added`: a live refresh token; KAN-387,
  for the extension's add-Claude step; `tests/test_connector_added.py`), and
  the student's Disconnect is `DELETE` on it (`oauth.disconnect`: every
  token and approved sign-in of theirs deleted, so `/mcp` refuses at once). **Its tools are layer 3** (`connector/tools.py`): the
  student comes from the token (`connector/account.py` `current_student`,
  the one dependency every tool module uses), each tool calls one
  layer-2 step (`next_to_write`, `save_answers`; the style card's two tools,
  `connector/style.py`, read and write `queries/writing.py`), and a refusal is a
  `ToolError` with the reason. **A chat is the `chat` value Claude passes
  back** (KAN-381): the server keeps no session, so the per-chat cap
  (`connector_chat_cap`) counts the job ids in that value, and a new chat
  (no value) resumes at the oldest unanswered application. **A change to
  the prompt or the cap is checked by a person's blind read, never an AI
  judge** (KAN-386, `app.scripts.ship_check`): it runs the prompt through
  `claude -p` on the user's own login against the tools' real code with a
  stub in place of the database, then shows the connector's answers against
  another writer's, and a chat's first against its fifth, with the writer
  hidden. The question set, both answer sets and the picks hold a student's
  facts, so they live outside this public repo; only the script is here.
  **Writing rules go in the MCP prompt
  (`connector/prompt.py`), never in a tool's description**, name no
  student, and never list banned words (that primes a model; the save
  checks them, KAN-380), and nothing on this path calls a model. **Every tool takes a title and explicit annotations** (KAN-383, Anthropic's directory refuses a tool without them): `readOnlyHint=True` on a read, so Claude runs it without asking; only `save_*` tools write, each saying `destructiveHint`; `openWorldHint=False` on all. A test lists the tools and checks each one, so a new tool without them fails. **Company
  briefs are shared by every student** (KAN-382, `auto_apply/briefs.py`,
  tools in `connector/briefs.py`): a fact is kept only if WorkIt finds its
  quote on its page, so **every page a brief cites is read through
  `services/page_fetch.py`**, never a bare `httpx` call: the URL comes from
  outside, and the fetcher is what refuses internal addresses, other
  hosts, redirects off them and oversized pages. Tests swap
  `briefs.fetch_page` for a fake; nothing in the suite reads the web.
  **The brief comes before the essays** (as in Apply): while an
  application with a question in words has a company whose brief is
  missing or over 30 days old and not held back (`briefs.needs_research`),
  `get_next_application` answers `research_first` with the company and no
  application; a choice-only application still goes out.
  `get_research_task`, given the same `chat`, puts that held application
  first (`briefs.research_task(skip=)`), so it names the company
  `research_first` named, not an older application's. Tests get every
  company as researched (an autouse fixture in `tests/conftest.py`);
  mark a test `research_gate` to keep the real rule, and stub
  `needs_research` with the other brief calls wherever they are stubbed
  (`scripts/ship_check.py`).
  **Every written question has a Question type** (KAN-369, Apply's
  essay writer made general): `auto_apply/question_types.py` classifies a
  question into one of 15 types or `general`, and each type's guide is a
  file in `auto_apply/type_guides/` whose front matter code reads (its
  summary, company link, default length, match patterns and slots) and
  whose body is guidance `get_next_application` hands out as data (each
  question its type and default length, `guides` by type). A question's
  help text (`written_answers.description`, what the form shows under the
  label, which the tab sends as it sends `max_length`) goes out with it,
  is read with the label to classify it, and a length it states replaces
  the type's default; the prompt holds the stated-limit rules (a word
  limit 75-95%, a sentence range its top, a character cap 80-95%). A guide names
  no student and lists no banned word; change its slots and the save's
  plan check changes with them. Tests: `tests/test_question_types.py`.
  **Every saved answer passes the checks in code first**
  (`app/auto_apply/checks.py`, KAN-380; pure, `tests/test_answer_checks.py`):
  machine-made words, a run copied from the student's writing samples, a
  number not in the bank, posting or question, another application's
  company, a sentence over 30 words, a placeholder, the form's own
  limit (the Fill engine reads it from the live form; the tab sends it as
  `max_length`), and Apply's editor checks (how it was written, talk of
  the posting, time counted from today, signposts, more than 2 numbers,
  low-level detail, a course credited). Each reason says what to change.
  Apply's holds, in WorkIt: an answer needing the student's input is left
  out by their Claude (the row stays Needs you); a high-stakes one
  (`checks.high_stakes`) is saved and filled, and `save_answers` names it
  in `read_first` for the student to read before Submit. `save_answers` refuses the whole save with every failing
  answer's reasons, so nothing failing reaches a tab. **No saved answer is
  filled without passing that form's checks**: when a tab sends the form's
  own limit (`ask_questions`; a question read early had none), each saved
  answer of their Claude's is checked again and a failing one dropped
  (`queries.drop_written`) for their Claude to write again; `answer_bank`
  offers one of their Claude's on another application only if it passes
  that application's checks (the engine checks the form's limit on the page). **An answer about one
  company is offered on that company's forms only** (`checks.company_specific`,
  read through `pipeline.answer_bank`: reuse saved answers through it, never
  from `written_answers` directly). A draft of their Claude's brought
  from Apply with no company (no `first_seen`) that names a company WorkIt
  knows (`written.companies_named`; the student's own places don't count)
  is that company's answer. **The student's own words win**
  (KAN-379): the student's words in a tab (`PUT .../answers`, `own` true:
  written into a field WorkIt didn't fill, or replacing what it filled) set
  the row's `own`, which their Claude's later save never overwrites and
  `answer_bank` offers first, unchecked by the checks meant for their
  Claude's text (only the company rule, no other application's company
  named, and the form's limit on the page apply to them); an edit of an answer WorkIt filled (`own`
  false) stays not own and passes the same checks as their Claude's save;
  the extension plans every batch form with `GET .../answer-bank`, so a
  saved question never reaches their Claude, and every form outside a
  batch with `GET /applicants/{id}/answer-bank?company=` (no application:
  an answer about a company only when the page's company is that one). Seam-2 tests:
  `tests/test_connector_saved_answers.py`. Seam-2 tests:
  `tests/test_connector_checks.py`. The writing samples are KAN-384's;
  until then `pipeline.writing_samples` holds none. **Which job postings it takes is
  one list, `app/auto_apply/hosts.py`** (every hiring system the Fill engine fills, KAN-370): the matches
  and `queue_applications` require its SQL form (`AUTO_APPLY_SUPPORTED` in
  `queries/jobs/filters.py`) and `JobListing.auto_apply` its Python form,
  which the Jobs page reads to show the button. One pattern serves both, so
  they agree; the Python form is tested against URLs, the SQL form only by
  the SQL it sends (on 2026-10-17 the two agreed on all 13,308 listed jobs
  in the dev database). A job board's posting (`JOB_BOARDS`, KAN-376) is
  taken only through the employer's form its text names: `FORM_URL` reads
  it in SQL, the listing carries it as `form_url`, and `auto_apply` checks
  that form (`tests/test_job_board_links.py`).
  matching: `app/services/matching/CLAUDE.md`. Resume PDFs (LaTeX through
  Tectonic): `app/services/resume_render/CLAUDE.md`. A service that reads or
  writes rows (the experience bank, `services/bank.py`) takes the caller's
  session, flushes and never commits, so the router owns the transaction and
  one request can make many changes atomically (an import saving many
  entries).
- **A resume-local skill is not in the bank** (`docs/tailor_resume.md`):
  `load_bank` leaves out every skill a built resume owns
  (`bank_skills.built_resume_id`) unless the caller names that resume in
  `local_to`. Every reader of one built resume names it: `load_view` (the
  PDF, Word, LaTeX, keyword match, Fit, sent resumes), the choices PATCH,
  the editor assistant, Tailor's built source, Generate's duplicate check
  (all resumes), and `GET /bank?built_resume_id=` (the editor page).
  Nothing else does, so Scout, the recommender, Generate and the
  Experiences view never see one. `add_local_skill` writes one and leaves
  the bank's embedding alone. Tests: `tests/test_tailor.py`, "Resume-local
  skills".
- **The experience bank is written only through `services/bank.py`.** It
  holds the ownership scoping, the duplicate check and the clearing of the
  bank embedding on every entry, bullet or skill change; a route or script
  that writes `bank_*` rows itself leaves the recommender on a stale
  embedding. Schema rationale: `../docs/resume.md`, "The experience bank".
  Clear All (KAN-352) is `delete_entries` / `delete_skills`: all or none,
  a 404 when any id is not the applicant's, and the same cascades as one
  delete (bullets, built resumes' choice rows), in one statement.
- **The recommender and Scout read the bank, never an uploaded resume**
  (KAN-212). `GET /jobs/recommended` scores against the bank and its
  embedding (`app/services/matching/CLAUDE.md`); Scout's facts come from
  the bank's API shape (`routers/bank.py`'s `bank_response`) through
  `workit_scout.facts`. An uploaded resume only feeds import.
- **A job's match score comes from `score_jobs`**, the same path everywhere.
  `GET /jobs` enriches each listing with `match` and `highlights` when the
  viewer is a signed-in applicant with a non-empty bank (KAN-309);
  `GET /jobs/recommended` uses `fetch_recommended` (which calls `score_jobs`);
  the Applications page's cards (KAN-256) get theirs through
  `GET .../applications?scored=true`, which narrows it with
  `JobFilters.job_ids`. Home's `GET /jobs/recommended/{id}/home` scores
  its three lists in one `score_job_sets` pass and keeps the result per
  applicant (`queries/jobs/home.py`, KAN-425). One scoring path, one
  number per job.
- **A student reaches only the postings the Jobs page lists**
  (`services/postings.py`'s `LISTED`: published and scraped). Tailor (run
  and its match), the keyword match and Apply load a posting through
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
- **An upload fills the bank** (KAN-240, `../docs/adr/0003-upload-fills-the-experience-bank.md`).
  `POST .../resumes` extracts `raw_text`, reads it with the heuristic
  parser (`services/bank_import.py`'s `read`, pure) and writes it with
  `services/bank.py`'s `import_upload`, in the same transaction as the
  resume row: if the commit fails, nothing is kept and the Storage file is
  removed. The parser's reading is stored nowhere else (`parsed_json` is
  gone). The response's `bank` says what went in (`found`,
  `entries_added`, `skills_added`). A reading never fails an upload: a
  parser crash reads as nothing.
- **Each upload owns its entries and skills; uploads never merge** (ADR
  0005, `../docs/bank_by_resume.md`). `import_upload` deletes what the
  upload owns (`bank_entries.resume_id`, `bank_skills.resume_id`), then
  writes the whole reading as the upload's own, with no `find_duplicate`
  across resumes: the same job on two uploads is two rows, and Generate,
  Tailor's ranking, Scout and the recommender read both (accepted). A
  re-read replaces, so the student's edits to that upload's entries and
  their places on built resumes go, with no warning. Deleting an upload
  deletes its rows (cascade). Upload flushes the `Resume` row first (the
  rows point at it). An item with no owner was made by the student, by
  intake or by Tailor's "Have you used X?" (removed). Add (`POST .../bank/entries`
  and `.../skills`) takes `?resume_id=`: an upload owns the new item, a
  built resume gets a shown choice row; its duplicate check and the skill
  name index (`NULLS NOT DISTINCT`) look at one owner only. `GET /bank`
  sends each item's `resume_ids` (the owner, then the built resumes that
  show it, `load_holdings`) and `resumes`; other `bank_response` callers
  (Scout) send none. Tests: `tests/test_bank_import.py`, "owners" and
  "Add under a resume pick".
- **Onboarding reads a resume before saving it** (KAN-372, ADR 0006).
  `POST .../resumes/preview` runs upload's read (`_extract`, then
  `bank_import.read`) and writes nothing: no Storage file, no row, no bank
  row. The student confirms with the normal upload plus `?replace=matching`,
  which also deletes the other uploads' entries and skills the reading
  matches (`bank.upload_matches`: section, title and organization, or a
  skill's name, ignoring case; never an entry with no owner), so a newer
  resume leaves one copy. The preview lists those rows beside each item.
  Every other upload keeps ADR 0005's no-merge rule. Tests:
  `tests/test_bank_import.py`, "the parse preview and its confirm".
- **Import Again** is `POST /applicants/{id}/bank/import`: the same read on
  a stored upload, replacing what it owns, from intake's Use One I
  Uploaded, the Jobs page's empty-bank card and the Experiences view's
  prompt for an upload that owns nothing. It re-reads `raw_text`, so a
  resume uploaded before a parser fix gets the fix.
- **Import Updated Resume** is `PUT /applicants/{id}/resumes/{resume_id}`
  with a file, from an upload's row on the Resumes view: a newer version replaces the row's
  file and is read as an upload is, replacing what the upload owned. The row keeps its id and
  primary star, and its `created_at` becomes now, the upload date the row
  shows. The file goes to a new Storage path: a sent resume may point at the
  old one, and a sent resume's file never changes, so the old file goes only
  when `file_in_use` says no row needs it. A failed commit removes the new
  file and leaves the row as it was. It replaced Import Again on the row
  (2026-10-18): the stored file never changes, so re-reading it with the
  same parser only said "already in your bank". Tests:
  `tests/test_bank_import.py`.
- **Rename** is `PATCH /applicants/{id}/resumes/{resume_id}` with
  `{"name"}` (KAN-268). It writes `original_filename`, the name every
  screen shows and a DOCX downloads under, so it adds the stored file's
  extension when the name lacks it: without it a renamed DOCX downloads
  as a file no program opens. There is no separate name column, so Import
  Updated Resume names the row after the new file again. Tests:
  `tests/test_bank_import.py`.
- **The model reads a resume only when the student asks** (KAN-222, ADR
  0003): Import Again's `read_with_ai: true`, "Read It With AI". Upload and
  a plain Import Again never fall back to it, even when the parser finds
  nothing. It counts a `PARSING` use only when the reading succeeds,
  committed with the bank writes; it answers 429 at the limit and 503 when
  the model fails, and then writes nothing. The prompt and checks are in
  `services/bank_import.py`; the rules are in `app/utils/CLAUDE.md`, "The
  model upgrade path". Tests: `tests/test_bank_import.py` (the upload's
  writes, the merge, Import Again, no identity data in the prompt, an
  invalid or failed reply writes and counts nothing, the cap and the share).
- **Uploads from before KAN-240 are not backfilled.** Their facts reach the
  bank only when the student clicks Import Again; the Jobs page's empty-bank
  card offers it in one click.
- **Every resume feature reads the built resume view**
  (`app/services/resume_view.py`, KAN-207): one pure function from the bank
  and a built resume's choices to what the resume shows. The PDF, the Word
  file, Tailor, the sent resume's hash and the editor read that shape; a rule
  about what shows goes there, never into one reader. Built resumes are
  written only through `services/built_resumes.py`. Its `touch` sets a
  resume's `updated_at`, the Resumes page's "Last edited" (KAN-258), because
  a write to a choice row leaves the resume's own row as it was:
  `write_choices` and `update_choices` call it, and any new write to a
  resume's choices goes through them or calls it too.
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
  (two to six renders, about 0.3 s each) and its tests need Tectonic. It cuts in steps
  (`FIT_STEPS`): coursework, then bullets past a cap per entry, then the
  bottom entries of a section, each step across every section before the
  next goes deeper. Never cut one section to one-line entries before the
  others give anything: the first rule did, and a long resume came back a
  list of one-line entries. Once it fits, it shows the last round's cuts
  again one at a time while the page still fits (`FIT_PUT_BACK`):
  `lines_over` runs short (a resume 7 lines over was still 6 over after
  about 8 lines were hidden), and without it a test resume lost 3 items
  it had room for. Undo sends the response's `undo` body. Tests:
  `tests/test_resume_editor.py`.
- **Only a send is a sent resume; a download keeps nothing** (KAN-267).
  The editor's Download takes `GET .../built-resumes/{rid}/render` (the PDF,
  base64, with its `file_name`), `.../docx` or `.../tex` (the PDF's LaTeX
  source) and stores nothing. Every
  download was kept as a sent resume (KAN-208) until then, PDF or Word,
  which filled the bucket with files no employer saw. **Apply** (KAN-220)
  is `POST /applicants/{id}/sent-resumes` with `job_posting_id`, now
  required (422 without it), and exactly one of `built_resume_id` or
  `uploaded_resume_id` (422 otherwise; 404 for a posting the Jobs page does
  not list). Sends are PDFs only: `format` went with the Word downloads,
  and Word sent resumes kept before stay as they are.
- **A sent resume's file is a snapshot or a stored file** (KAN-267,
  `../docs/sent_resume.md`; `services/sent_resumes.py` has the rules). A
  built resume's send hashes the view, template and header text first (a
  repeat for the same built resume and posting returns the last sent
  resume), renders the PDF once for the student, and keeps what it is made
  from as a `built` snapshot (`resume_snapshots`, gzipped JSON, about 2 KB;
  one per content, shared across postings). **Nothing goes to Storage**,
  so a failed commit has no file to clean up. An uploaded resume's send
  points at the upload's own file until **Import Updated Resume or the
  delete freezes it** (`freeze_upload`, before the row loses its file, in
  the same commit): its text, parsed, becomes an `upload` snapshot with
  the text itself, and the file goes. A file with no text, or one the
  parser reads nothing from, stays a file. Opening a snapshot renders it
  again (about 0.3 s; 503 without Tectonic), answered as `data` (base64);
  a stored file as a 5-minute `url`. `rebuilt` (no content hash, a
  snapshot) marks an upload's, which is approximate. The service flushes,
  never commits. **A stored file is removed only when `file_in_use` says
  no row needs it**, and a snapshot only when no sent resume does
  (`delete_sent`; its foreign key is RESTRICT).
- **A duplicate resume is refused** (KAN-267, `../docs/sent_resume.md`),
  409 `{"detail": {"message": "Duplicate Resume found: <name>", ...}}`
  with nothing written. **Upload and Import Updated Resume** compare
  `resumes.text_hash` (`routers/resumes.py`'s `text_hash`: sha256 of
  `raw_text`, NFKC, whitespace folded), so the same resume exported again
  is caught although its bytes differ; a byte hash missed that. Extraction
  runs before the Storage upload, so a refusal leaves no file, and the
  check runs before the 5-upload limit. No text, no hash, no check. The
  partial unique index `resumes_text_hash_key` catches two uploads at
  once: the loser's commit fails, it removes its file and answers the same
  409. **Changing `_extract` or `text_hash` makes stored hashes stale**: a
  re-upload of an old resume then gets through (never the reverse).
  Uploads from before KAN-267 have no hash (not backfilled). **Generate**
  (`generate(..., refuse_duplicate=True)`, the route only; Tailor's own
  Generate never refuses) compares the new resume's view with every built
  resume's view built from today's bank (`same_resume`), before writing:
  a resume's content changes with every edit, so no hash is stored. A
  test that needs two resumes from one bank adds a skill between them
  (`tests/test_built_resumes.py`'s `_another`).
- **The resume limit is 5 uploads** (`services/built_resumes.py`'s
  `check_room`, called by upload before anything is written; 409 with the
  reason). Built resumes (base and tailored) and sent resumes do not count,
  so Generate, and Tailor's Generate, are never refused for it. Base
  resumes counted until KAN-268.
- **A student's only resume is the default** (`services/built_resumes.py`'s
  `default_if_only`): upload, Generate (Tailor's too) and both deletes call
  it, so the last resume left after a delete takes the star. With two or
  more it changes nothing. Before it, a student with one resume and no star
  click had no default, and auto apply attached nothing. **Every kind
  counts: uploaded, base and tailored.** It counted base resumes only
  until KAN-267, from before a tailored resume could be the default
  (KAN-268): a tailored resume left alone kept an empty star, and beside
  one upload the upload took the star on every add or delete
  (`tests/test_built_resumes.py`). It is not
  backfilled: an older account with one resume and no default gets it on
  its next add or delete.
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
  value; each turn's context says what `title` and `organization` hold in
  the section (`FIELD_MEANINGS`, matching the card's labels), because
  without it a live model put the university in Education's organization.
  The prompt also says one answer can fill several fields, with examples:
  gpt-oss-120b put all of "PennyWise, a budgeting app for my CSE 316 class"
  in the title, and asked a student who had said "I was a research
  assistant in Professor Smith's AI lab" for their title and organization.
  The test set's `title=` cases check the split.
  The context also lists the facts the section needs (`_NEEDS`) that the
  card has ("never ask about these") and lacks ("ask about these, and
  about nothing else"). `_NEEDS` is what application forms take plus what a
  resume line needs (2026-10-14): Greenhouse requires a school's degree,
  discipline and start and end months, and a job's company, title, start
  and end or "current", so "dates" means a start and an end or "present".
  No hiring system asks for a project's, club role's or award's dates, so
  intake does not; `frontend/src/app/(seeker)/bank/sections.ts` keeps the
  same list for the bank's warnings and visits. The system prompt asks only
  the listed facts ("every other field is optional, never ask for it"):
  it used to order every section's questions as title, organization, dates,
  so a live model asked a finished project for its team. It also writes
  bullets from the first answer that says what the student did, rather
  than asking for one. Education's include the GPA, so a school imported without one gets asked
  for it. The GPA is optional (`_OPTIONAL`): a card without one still counts
  as complete, so after the student declines it the `READY` guard below
  ends the visit instead of asking again. Two code
  guards back the prompt, each with a test, because the local 4B model
  ignored it: a field the card had that the reply blanks keeps the card's
  value (`_keep_filled`, the three end-date fields as one), so saving a
  visit to an imported entry cannot erase it; and when the card had every
  needed fact before the turn and still has them, the reply becomes the
  fixed `READY` line with `done`, so the model gets one turn to ask what
  came of the work and no more. The draft reads a `null` list as empty and
  a blank text field as `null` (`IntakeDraft`'s validators): Groq's
  gpt-oss-120b sent `"coursework": null` and `"organization": ""` on most
  leadership turns, and each failed the whole turn as "the wrong shape".
  For the same reason a blank list item (`"bullets": [""]`) is dropped, and
  an `end_kind` of `month` or `expected` with no `end_month` becomes no
  end: "summer 2024" got both.
  **The code reads a month the model drops** (`_fill_dates`, for sections
  that need dates): when the card still lacks its dates after the reply, a
  month and year in the student's latest line ("August 2023", "Aug 2025",
  "2023-08", "8/2023") fills them if the reading is unambiguous: one month
  for the one missing part (a start earlier than the end, an end not before
  the start, "expected" when it is in the future), two for both, or "still"
  or "currently" for a job still going. A lone month on an undated entry
  stays the model's to ask about, since it could be either end. When the
  code fills the dates, or the card holds them and the model's line still
  asks a date question, the line becomes the next missing fact's `_ASK`
  question, or `READY`. Groq's gpt-oss-20b, the chain's second model,
  dropped "I started in August 2023" one turn in three and asked "What
  month and year did you start?" again; it and Gemini also asked for an end
  the card already had (2026-10-14). `_fill_title` does the same for a
  role said in passing, in Experience and Leadership only ("I was a backend
  intern at Initech", "I served as the treasurer of the Robotics Club"),
  when the model leaves the title empty: a live model filled Initech and
  asked "What was your official title for that role?" (2026-10-14).
  **A line that names a bank entry fills the card from it** (`bank_match`,
  `_from_bank`): the route loads the student's bank, and when the latest
  line holds a telling word of an Experience, Projects or Leadership
  entry's title and of its organization ("the IEEE Micromouse lead" finds
  the project "Micromouse" at "Stony Brook IEEE"), that entry's
  organization, location, dates and bullets go into the card's empty
  fields, and WorkIt's line becomes "I filled in what your bank has on …"
  plus the first fact still missing. When several match, the one sharing
  the most telling words with the line wins (a tie fills nothing): "robot"
  in both "Autonomous Maze Navigation Robot" and "CNN-Powered Object
  Detection Robot" made "the autonomous maze navigation robot" a guess
  that filled nothing (2026-10-14). A
  word list (`_GENERIC`) keeps "intern" or "club" from matching alone. An
  entry whose title has no telling word never matches: a leadership entry
  titled "hi" at "Stony Brook Robotics Club" matched "for my robotics team"
  in a project's visit and put the club on the project. Copies (same
  section, title and organization, as an import saved "as new" leaves)
  match as one entry: a bank holding "Autonomous Maze Navigation Robot"
  twice filled nothing. The matched entry's bullets go in when the card had
  none before the turn, over any the model wrote that turn: speech input
  heard "Thomas Mays navigation robot", the model wrote a bullet from it,
  and that bullet kept the bank's out (2026-10-14).
  **The code matches, not the model, on purpose**: given the bank in its
  context, gpt-oss-120b copied the club and left the dates, and told to
  name the matching entry's number it never did. Code matching also keeps
  the bank out of the prompt, which matters on Groq's free tier (8,000
  tokens a minute for gpt-oss-120b).
  **The reply is NDJSON like Scout's, but not streamed token by
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
  the model and cached on the posting with a hash of its title and the
  description's job part (`job_part`), all the model read, and
  the pure count of those the built resume view shows (text and skills,
  whole words, ignoring case). **Only an extraction spends a use, and it
  counts under `TAILOR`**; a cached match is free, for every student. Tailor
  (KAN-217) reads them through the same `keywords.ensure` (the cache, else
  an extraction stored on the posting) and counts its run once, not once
  more for the extraction. Which use an extraction spends stays in each
  router. **Every extraction uses the small model** (`get_small_llm`,
  KAN-356), Tailor's included: its run routes (JSON and stream) take the
  large model for the rewrite and the small one for `keywords.ensure`, and
  its match route only the small one, so a posting's keywords
  come from one chain whichever path reads them first. Routes pass the
  model in; `ensure` never loads one, so a test's dependency override
  reaches it. **Most postings are read before any student asks** (KAN-392):
  the feed import's keyword pass (The feed import, above), and for a
  company job, a background task after a save that leaves it published
  (`company_jobs._fill_keywords`, in its own session after the response,
  so the composer never waits on a model). A draft is not read: no student
  sees it and its text keeps changing. Either failure only logs, and
  `ensure` stays the fallback. **The import and `cached` hash with one
  function, `posting_text_hash`**: the import's pass (KAN-392) and the
  title-and-job-part hash (KAN-343) landed separately, the import hashing
  the description alone, which left every cache it filled stale to
  Tailor and spent each extraction twice. Tests:
  `tests/test_keyword_match.py` (the cache, its clearing by the import and
  by the hash, an invalid or failed reply counts nothing, the cap, the
  import's pass and the company job's task).
- **Tailor** (KAN-217, `../docs/tailor_resume.md`) is `routers/tailor.py`
  over `services/tailor.py`. `POST .../tailor/match` gives the picked
  source's keyword match (and the posting's tailored resume, if any) for
  the student to pick the missing keywords to add. A run (`POST
  .../tailor`) then rewrites, orders and adds those skills and **saves the
  posting's tailored resume itself, with no confirmation**: proposals,
  Accept and Reject, Done (`.../tailor/done`) and "Have you used X?" were
  removed on 2026-10-25. It answers with `edits`, each change and what it
  replaced, which the editor marks and can revert until Save; the API keeps
  no record of them. **The Tailor screen runs it streamed**, `POST
  .../tailor/stream`: the same steps (`_steps`, one generator both routes
  read) as NDJSON lines, `asking` before the model call, `generating` after
  it, then `done` or `error`. It opens its own session, since the
  request's may close once streaming starts, and runs to the first line
  before it answers, so every refusal before the model call stays an
  HTTP status. Rules, each with a test in `tests/test_tailor.py`:
  - **One tailored resume per posting; a second run replaces it in place**
    (2026-10-26). The run keeps the resume's row (its id, the student's
    name for it, its star), and once the model has answered clears what
    the last run and the student's edits made on it alone
    (`tailor.clear_run`: its own skills and typed wordings) before writing
    every choice afresh; a failed run leaves it as it was. The posting's
    variants stay, since another resume may show one. A source that is the
    posting's own tailored resume answers 422 before any model call: it
    would read the lines the run clears. Two first runs at once: the
    loser's commit fails on `built_resumes_applicant_posting_key` and
    answers 409. It was made once, a second run refused with a 409 to save
    tokens, until the review's Back to Choose Keywords asked for runs again.
  - **The student picks the source** (KAN-318): the match and the run each
    take exactly one of `built_resume_id` or `uploaded_resume_id` (422
    otherwise; 404 for one not the applicant's). A built resume gives its
    choices (and its own skills: a tailored resume can be a source). An
    upload gives the entries and skills it owns (`tailor.upload_source`,
    ADR 0005), built in memory, never saved; every other entry and skill
    waits hidden. It never reads an upload that owns something again: a
    reading replaces what it owns, which would drop those entries. One
    that owns nothing is read into the bank first. An upload the parser
    reads nothing from answers 409. The source never changes.
  - **The truth rule is one pure function**, `services/truth_rule.py`'s
    `invented` (tested directly, `tests/test_truth_rule.py`): a wording
    with a number or tool in neither its original bullet nor what the
    student has already said (`tailor.known`: the resume's skills, the
    picked missing keywords, and the posting's keywords the resume already
    shows anywhere, coursework included) is dropped and counted in
    `dropped`. A missing keyword the student did not pick is in none of
    these, so "backend" on a designer's bullet is dropped while
    "algorithms", in the resume's coursework, passes: in the first live run
    (2026-10-25) the posting-keyword check dropped both rewordings, the
    second for "algorithms" alone. `propose` and `save_variants` read one
    `known` list.
    Both read every bank skill before 2026-10-25, so a wording could bring
    in another upload's skill. Change what counts as a tool there and
    nowhere else.
  - **A run tailors only what the picked resume shows, read once as its
    view** (KAN-318): the router builds `build_view(bank, choices)` once,
    and the rank, the prompt, the handles, the changes, the keyword match
    and the record of edits all read it. So the model sees the resume the
    student sees: its shown entries and bullets in the resume's own order
    and wording, and only its shown skills. `prompt` and `propose` number
    the handles from the same view, or b3 would name two bullets. A run
    never adds an entry or bullet the resume hides, so a pick keeps its
    focus and length. `on_resume`, the bank cut to what shows, was a
    second copy of the view's rule and is gone.
  - **A keyword the student does not pick is never written in.** Picked
    skills (`skills` in the run's body; only missing keywords count, any
    other name is ignored) go on the tailored resume only, as its own
    skills (`bank_skills.built_resume_id`, `place_on`), never into the
    experience bank. The prompt numbers the resume's skills by group
    (`skill_numbers`) and lists the picked ones to place; the model answers
    a group and `after` (a number it copies, 0 for first in the group) for
    each, and `place_skills` checks each placement alone and builds the
    order (the group wins over the number; at most two new groups;
    positions come from code, never the model). A hidden bank skill that
    holds a keyword is no longer offered: it was a card per skill, two
    when two uploads owned one name.
  - **The model sees handles (b1, e1), never ids**, and no links: an
    entry's link field is left out and the seam removes identity data.
    Postgres text search (`ts_rank`, the posting's words OR'd) ranks the
    resume's bullets, and a run orders each entry's bullets by it. A
    posting with no description is read by its title, with `weak_match`.
  - **A run fits Groq's free tier** (8,000 tokens a minute for
    gpt-oss-120b, prompt and reply together): the prompt is estimated at
    four characters a token, and over `PROMPT_TOKENS` (5,000) it leaves out
    the lowest-ranked bullets, keeping every entry's line; the reply asks
    for `REPLY_TOKENS` (3,000) at most. A request a provider still finds too
    large moves down the chain (Scout's `RequestTooLarge`); a reply stopped
    at its cap is `ReplyCutOff`. Each has its own line in
    `services/ai_messages.py`. There is no cap on how many bullets the model
    rewords.
  - **A rewording must keep its bullet** (`keeps_its_bullet`): a third of
    the original's words (three letters or more; a shared start of four
    letters counts) must be in it, or it is dropped and counted in
    `dropped`. The model copies handles, and one copied wrong puts a
    rewording on another bullet; the truth rule passes it when it adds no
    number or tool.
  - **A failed run saves nothing.** The tailored resume, its variants, its
    choices and its own skills go in one commit after the model answers;
    only the posting's keyword cache, and what reading an upload wrote,
    are committed earlier, since they are not the run's.
  - **An order edit names its entry with the organization** ("Software
    Intern, Acme"), since two jobs can share a title.
  - **One run is one `TAILOR` use**, counted after the model answers; a
    keyword extraction inside the run or the match is not a second use.
    **Lifted for now (KAN-319):** the route's `uses_left` check and
    `count_use` are commented out, it answers `uses_left` as the cap, the
    Tailor screen hides its "Each run uses one of today's 2 Tailor runs"
    line, and the three cap tests in `test_tailor.py` are skipped. Restore
    them together. The keyword match in `routers/built_resumes.py` still
    spends `TAILOR` uses.
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
- **The daily job-alert digest** (KAN-298) is
  `app/scripts/send_job_alerts.py`, run daily from a crontab on a
  user-managed EC2 instance, not GitHub Actions
  (`.github/workflows/job-alerts.yml` keeps no schedule of its own
  anymore — `.github/CLAUDE.md`), over `services/job_alerts.py`. It
  reuses auto apply's own matching, not a second implementation:
  `build_digest` calls `routers/jobs.py`'s `fetch_recommended` and
  `auto_apply/rules.py`'s `pick_batch` exactly as `auto_apply/pipeline.py`'s
  own `_matches` does, at the same `MIN_MATCH`/`BATCH_SIZE` (imported, not
  retyped), just without `auto_apply_only=True` — a digest links to
  WorkIt's own `/jobs/{id}` page, never `apply_url`, so it needs no
  ATS-specific knowledge. `send_job_alert` writes one `notifications` row
  (`models/CLAUDE.md`, "notifications") and sends one email through
  `services/email.py`'s `send_email` (AWS SES, the one place a provider
  swap would touch) from the same computed list — never scored twice.
  **Authenticates via the EC2 instance's IAM role, never a stored key**:
  `aws_region`/`ses_from_email` in `config.py` are the only settings, both
  plain values, nothing to rotate — a run from anywhere without that role
  (local dev, GitHub Actions) has `send_email` log and return `False`,
  same as a bounced send. **Still open: the SES account is in its
  sandbox** (production access not yet requested), so a real send to an
  address SES hasn't individually verified is rejected the same
  best-effort way. The AWS/EC2-side setup (SES identity, the IAM role,
  the instance, the crontab) is a human runbook, run by hand, not code:
  the steps are in PR #172's description, not committed here, since
  they're one-time ops setup rather than something future code changes.
  Gated by `applicant_profiles.job_alerts_enabled`, the
  Settings opt-in, default off. One applicant's failure (empty bank, a
  bounced email) is caught and counted, never stopping the run;
  `--dry-run` builds and reports every digest, writing and sending
  nothing. Tests: `tests/test_job_alerts.py`, `tests/test_notifications.py`,
  `tests/test_email.py`.
- **The autofiller's essay-answer generation** (KAN-164) is
  `routers/essay_answer.py` (`POST /applicants/{id}/essay-answer`) over
  `services/essay_answer.py` — the first route `autofiller_extension/`
  needed, since the extension cannot hold a model key itself. The Chrome
  extension reads an open-ended application question straight off the ATS
  page's own DOM (no `job_posting_id`: the posting may not be one WorkIt
  has scraped or a company has posted) and sends the literal question text,
  plus whatever company name/job title it could read from the page and the
  field's own HTML `maxlength`. The model drafts a short paragraph grounded
  in the whole bank (not a ranked subset — a student's bank is small enough
  to use whole, unlike Tailor's posting-ranked bullets); a draft that fails
  `truth_rule.invented` against the whole bank's bullets and skills, or
  holds an identity placeholder, answers 422 and counts nothing — there is
  no safe fallback text to show instead, the way the assistant's `none`
  action has one. Nothing is stored: the question text is never saved
  (`models/CLAUDE.md`'s "autofill_answers" section explains why, and
  already anticipates this feature as the reason a company's own question
  would eventually get its own JSONB-backed slot). One `ESSAY` use per
  generated answer (cap 5, share 10%: on top of the spec's four shares plus
  the assistant's, following the same accepted-overshoot precedent).
- **The Applications Tracker's own writes** (KAN-413,
  `../docs/email_tracker.md`) are `routers/tracker.py` over
  `queries/tracker.py`: the stage menu (`PUT .../applications/{job_id}/stage`,
  applied or later, any direction) and the events (`GET .../events`, with
  `?status=proposed` for Email Updates, `POST
  .../applications/{job_id}/events`, `DELETE .../events/{event_id}` (an
  event added by hand only: one from an email stays as the Inbox's record,
  and its delete answers 404), and an
  update's `POST .../events/{event_id}/accept` and `.../dismiss`), and
  the Inbox's `GET .../emails` (every email, every status) and its
  `PUT .../emails/read` (KAN-427, Mark as Read and Unread, all or none;
  `read_at` keeps the first read, and Accept and dismiss set it too). An
  event moves its application forward only (`advance`, Accept too). **An
  email files itself unless it would move the stage or matched no job**
  (`needs_review`, `file_email`, the Gmail reader's entry point); a stage past
  applied still counts as applied (`dto.APPLIED_STAGES`, the models'
  CLAUDE.md). Tests: `tests/test_tracker.py`.
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
  breaks without it. Moving code to another layer moves its comments with
  it: KAN-260's move out of the routers dropped about twenty, put back in
  a follow-up.
- **A PR that removes imports is checked against today's main before it
  merges.** CI runs on the PR's own head: KAN-260 dropped `select` from
  `routers/bank.py`, KAN-343 added a use of it, each passed alone, and the
  merged `main` raised NameError on every Add under a resume pick
  (2026-10-24). Merge `main` into the branch and run `uv run ruff check .`
  first; F821 catches it. The same goes the other way: two fixes for that
  bug merged ten seconds apart, one restoring the import and one moving
  the query out (`queries/bank.py`'s `owned_upload_id`), and `main` then
  failed lint on the unused import (F401). Check `main` once more right
  before pressing Merge.
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
- **Engine settings are not optional.** `app/db.py` sets `NullPool` (unless
  `DB_POOL_SIZE` is set; Deployment) because Supavisor already pools, and
  `statement_cache_size=0` plus
  `prepared_statement_cache_size=0` because the transaction pooler hands each
  statement to any free backend: a prepared statement made on one is absent on
  the next, and queries fail intermittently under load, never in development.
  asyncpg still names each statement it prepares, and its numbered names
  restart per connection, so `prepared_statement_name_func` gives each a
  `uuid4` name: with a pool, two client connections could otherwise collide
  on one backend (SQLAlchemy's advice for pgbouncer-style poolers).
  Both cache settings go in `connect_args`; passed to `create_async_engine()`
  they raise `TypeError: Invalid argument(s)`. `hide_parameters=True` keeps
  the values a statement sent out of its error's text, which every route's
  `logger.exception` writes to the Vercel logs: a failed answer bank save
  logged a student's gender and disability answers (KAN-283,
  `tests/test_autofill_answers.py`). Debug with the SQL, never by turning it
  off.
- **CI runs the whole migration chain** on an empty Postgres before the
  database tests, so two heads or a broken migration fail the PR. **Still
  open:** `alembic check` (model drift) is not a CI gate yet
  (`alembic/CLAUDE.md`).

## Deployment

**The target is a Cloudflare Container** at `api.workitjobs.ai` (ADR 0004,
KAN-295): `Dockerfile` here, behind the small Worker in `cloudflare/`, on
Workers Paid. **Vercel stays live until the KAN-296 cutover**: its project
(Root Directory `backend`, the app one Vercel Function from `[tool.vercel]
entrypoint` and `vercel.json`) still serves production, and both files are
removed at cutover, not before. Until then a change must work on both.

- **The image builds from the repo root**, `docker build --platform
  linux/amd64 -f backend/Dockerfile -t workit-api .`, because `../scout` is a
  path dependency and a build context of `backend/` cannot reach it.
  `wrangler.jsonc` sets `image_build_context` to `../..` for the same reason.
  **Every `COPY` names its paths** (`backend/app`, `scout/workit_scout`...),
  never a whole folder: `wrangler deploy` pipes the Dockerfile in on stdin
  (`-f -`), so BuildKit never reads `Dockerfile.dockerignore`, and a
  `COPY backend ./` put a laptop's macOS `.venv` over the image's (the first
  dry run failed with `.venv/bin/python: not found`). That ignore file only
  speeds up a plain local `docker build`; there is no root `.dockerignore`,
  since the root holds no tooling. A new folder the API reads at runtime
  needs its own `COPY`. Cloudflare runs linux/amd64 only: build that
  platform on an Apple Silicon Mac. The image is about 450 MB on disk (185 MB
  compressed): the venv 188 MB, Tectonic and its cache 71 MB.
- **A `docker build` that hangs at "load metadata for ghcr.io/..." on a Mac
  is Docker Desktop's keychain credential helper** waiting on a prompt no
  one sees. Build with `DOCKER_CONFIG` pointing at a folder whose
  `config.json` has no `credsStore` (both images are public). Never run
  `docker buildx history ls` while a build runs: on Docker Desktop 4.55 it
  panicked dockerd and stopped every container (2026-10-20).
- **The image uses the base image's Python 3.12, not a uv-managed one**
  (`UV_PYTHON_PREFERENCE=only-system`), installs with `uv sync --frozen
  --no-dev`, and starts the venv's `uvicorn` directly on :8080: `uv run`
  would re-check the lock on every cold start.
- **The image fetches Tectonic at build time** (`scripts/fetch_tectonic.py`)
  and gives `vendor/` to the non-root `api` user, so the warm cache is
  writable in place and no render copies it to `/tmp`. A build that cannot
  fetch it fails (`app/services/resume_render/CLAUDE.md`).
- **The Worker (`cloudflare/`) holds no logic.** It forwards each request to
  one of 3 instances, picked at random (as the library's `getRandom`, until
  Cloudflare ships autoscaling): the API is stateless, so any instance serves
  any request, and three let renders run side by side on `basic`'s 1/4 vCPU.
  `max_instances` in `wrangler.jsonc` is twice `INSTANCES` in `src/index.ts`:
  after a rename (below) the old containers stay awake for `sleepAfter` and
  still count, so an equal cap could refuse the new ones. The cost: each instance cold-starts on its own first request, and
  each stays billed for `sleepAfter` (10 minutes) after its last one.
  Shorter saves memory-hours; longer means fewer cold starts.
- **The containers run in eastern North America, beside the database**
  (Supabase is us-east-1): `constraints.regions: ["ENAM"]` in
  `wrangler.jsonc`. Unconstrained, Cloudflare placed them on the West Coast
  (traffic left at LAX and PDX), each database round trip took 150 ms, and
  pages took 3–9 s (2026-10-21). A location hint on the Durable Object does
  not move its container: the two need not share a location. The Worker
  still gives the objects `locationHint: "enam"`, so the hop to the
  container stays short; a hint places an object only when it is first
  made, so changing it needs new names (now `enam-N`).
- **Secrets are Worker secrets set by CI** (`wrangler secret bulk` with
  `CLOUDFLARE_API_TOKEN`), never `wrangler.jsonc`, which is committed. The
  Worker's `Api` class copies the names in its `FORWARDED` list into the
  container's environment, skipping any the Worker lacks so the code's
  default applies. **A new setting the API reads must join `FORWARDED`**, or
  the container never sees it. **A container keeps the environment it
  started with**, and an `Api` object that finds its container running
  attaches to it as it is, so after a secret change one instance went on
  answering with the old values (2026-10-21). `Api.fetch` therefore stores
  the Worker version (`version_metadata`) its container started under and
  destroys a container from any other version before serving: the first
  request to each instance after a deploy pays a cold start. The swap runs in
  `blockConcurrencyWhile`: `destroy()` is not a storage call, so without it a
  second request read the old version mid-swap and destroyed the container
  again. CI deploys with `npm ci && npm run deploy`
  in `cloudflare/`; `npx wrangler deploy --dry-run` there checks the config
  and builds the image without deploying. Nobody runs `wrangler login` or a
  real deploy from a laptop.
- **Production env vars:** `DATABASE_URL`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_KEY`, and Scout's `SCOUT_*` (`../scout/CLAUDE.md`, "Which
  model, where"); without `SCOUT_*` every Scout reply is "offline".
  `SCOUT_ENDPOINTS_LARGE` and `SCOUT_ENDPOINTS_SMALL` are optional: unset,
  each size runs on the default chain. The
  `AI_*` usage limits are optional (defaults in `app/config.py`). **Never
  `DIRECT_URL`**: migrations run by hand, locally, and the deployed API has no
  business holding that connection. Embeddings use Ollama with
  `nomic-embed-text:v1.5` by default; see `app/services/matching/CLAUDE.md`.
  **Still open:** the deployed API has no Ollama, so until the Vercel project
  sets `EMBEDDING_PROVIDER=gemini` and `GEMINI_API_KEY`, recommendations
  score without the semantic part. The Worker forwards both names when set,
  and sets neither itself: `gemini` without a key would fail matching.
- **`GET /jobs` reads `job_postings`**, filled by the import on a schedule
  (`../.github/CLAUDE.md`). A deploy changes no jobs, and an empty table is an
  empty feed, not an error.
- **`5cc3189af108` (`job_applications`) goes on before the deploy that reads
  it.** Every `GET /jobs` sent with an applicant's token queries that table, so
  deploying first makes the Jobs page answer 500 for every signed-in
  applicant. The new table is unused by the running code, so applying it early
  is safe. It comes after the resume builder's `bb8c9c6dee0b`, not before: the
  shared database already held that chain when KAN-232 merged without its
  table, so this order lets `upgrade head` still create it there. A local
  database that applied `5cc3189af108` first reads the resume builder's tables
  as applied; recreate it from `upgrade head`.
- **`17ea74fa4573` (the `saved` stage, KAN-261) goes on before the deploy
  that writes it.** It only adds an enum value, so the running code never
  meets it and applying it early is safe; deployed first, every Save button
  answers 500. Applied to the shared database on 2026-10-18, with KAN-240's
  `3f7a2c9d1e84` under it, after KAN-240's deploy.
- **Apply `c785e96ac011` (KAN-275) just before the deploy that drops
  `not_ruled_out`.** It clears every saved `not_ruled_out` visa preference
  and narrows the CHECK to `sponsors`. Until the deploy, the old
  onboarding's "Hide Jobs That Rule Me Out" tile fails its save on the
  CHECK. Deployed first is worse: the new `JobPreferences` refuses a saved
  `not_ruled_out`, so every such seeker's Jobs page answers 500 until the
  migration runs.
- **`3aa342c5a064` (`job_applications.sent_resume_id`, KAN-267) goes on
  before the deploy that writes it**, after `5a6e419367b8`: the model maps
  the column, so deployed first, every application insert answers 500. It
  only adds a nullable column, a unique key and a foreign key (and fills
  the column for applied rows), so applying it early is safe. **It reached
  the shared database on 2026-10-21 before its file was committed**, by
  the shell slip `alembic/CLAUDE.md` records: until the file is on `main`,
  Alembic against the shared database fails for anyone without it.
- **Apply `5a6e419367b8` (`resume_snapshots`, KAN-267) before the deploy
  that writes it**, after `d642d93fcfbc`. The model maps
  `sent_resumes.snapshot_id`, so deployed first, every Apply and auto apply
  resume answers 500. It only adds a table, a nullable column and a CHECK
  the existing rows meet, so applying it early is safe.
- **Apply `7c2e9a4b1f63` (`bank_entry_sources`, `bank_skill_sources`,
  KAN-343) before the deploy that writes them.** The models map both
  tables, so deployed first, every upload, Import Again and `GET /bank`
  answers 500. It only adds two tables, so applying it early is safe.
- **`b9e2c4d6f8a1` drops `resumes.embedding`**, the contract half of
  KAN-212: apply it only where the code that stopped mapping the column
  (`d89a4ef`, on `main` since KAN-212) is deployed. Applied first, an older
  deploy's upload INSERT names the column and fails.
- **`89d598a1667d` (KAN-298's notifications) came to main ahead of its
  code**, with the merge revision `c4e8a2f6d1b3` joining it to
  `a7d3e5f1c2b4` (both branch off `b9e2c4d6f8a1`). It was applied to the
  shared database from KAN-298's open branch (`alembic/CLAUDE.md`, "Commit
  the migration in the same PR that applies it"), so its file came to main
  first, unchanged. KAN-298's models have since merged, so main maps
  `notifications` and `applicant_profiles.job_alerts_enabled` again and
  `alembic check` is clean of them.
- **Apply `a7d3e5f1c2b4` (the stages after applied and
  `application_events`, KAN-413) before the deploy that writes them.** It
  only adds enum values and a table, so the running code never meets
  them; deployed first, the Applications Tracker, an application's page and
  Home's numbers answer 500 for every student (they ask for the new
  stages and `GET .../events`). The Jobs page and matches keep working
  either way: their applied-job filter names only the stages before applied
  (`dto.BEFORE_APPLIED`, the models' CLAUDE.md). Merge the migration to
  `main` in its own PR first, then apply it, then test the branch.
- **Apply `dc36d2d2321c` (`application_events.read_at`, KAN-427) before
  the deploy that maps it.** The model selects the column with every event
  row, so deployed first, the Inbox, the Calendar and every application's
  events answer 500. It only adds a nullable column and marks the emails
  already decided as read, so applying it early is safe. It goes to `main`
  in its own PR first, then is applied, then KAN-427 merges.
- **Apply `bd730e8ab454` (`job_postings.closed_reason`, KAN-412) as soon as
  it merges.** It only adds a nullable column and a CHECK every row meets, and
  no code maps it yet, so it is safe for every deploy. The import that writes
  it (why a scraped job closed) follows in its own PR, whose dry-run scrape
  check and every scheduled import fail on a database without it; and the
  model maps it, so a company job's insert fails there too.
- **Batch apply's migrations (KAN-369, `d1a7c3e5f902` through
  `f4a8c1d6e273`) are on main ahead of their code**, so they can be applied
  before the deploy that maps them. The models map
  `applicant_profiles.location` and `experience_banks.removed_skills`, so
  deployed first, every signed-in student request answers 500. They only
  add tables and nullable or defaulted columns (and re-key the new
  `company_briefs`), so applying them early is safe. Until batch apply's
  models merge, `alembic revision --autogenerate` proposes dropping its
  tables and columns: delete those lines from any migration it writes.
- **Apply `a3d7f1c9e2b4` (`bank_skills.built_resume_id`, resume-local
  skills) before the deploy that maps it.** Every skill insert names the
  column, so deployed first, uploads, Import Again and Add skill answer
  500. It only adds a nullable column, a check every row meets and
  indexes, so applying it early is safe. It sits on `c8f2a4e6b913`, which
  goes on after ADR 0005's deploy (below), so apply both in that order.
- **ADR 0005 is two migrations around one deploy.** Apply `b5e1c3a7d920`
  (adds `resume_id` to `bank_entries` and `bank_skills`, fills it from
  single-source rows, swaps the skill name index) before the deploy: the
  models map the column, so deployed first, every bank read and upload
  answers 500. Then merge and deploy, then `uv run alembic upgrade head`
  for `c8f2a4e6b913`, which drops the source tables; applied before the
  deploy, the running code's `GET /bank` and uploads answer 500. An entry
  that came from several uploads stays unowned and shows under no upload
  until Import Again.
- **`9e4b2d7a5c18` (drops `bank_skill_links`, KAN-216's skill links) goes
  on only AFTER the deploy that stopped reading it.** The code before it
  queries the table on every bank load, so applying it first makes the
  Experiences page, Generate, Tailor and Scout answer 500. The order:
  `uv run alembic upgrade 7c2e9a4b1f63`, merge and deploy, then `uv run
  alembic upgrade head`. Skill links were removed because nothing used
  them: an upload never wrote one, and Tailor, the resume view, Generate,
  Scout, the recommender and the embedding all ignored them. A skill is
  one list per student.
- **Apply `d642d93fcfbc` (`resumes.text_hash`, KAN-267) before the deploy
  that writes it.** The model maps the column, so every upload's INSERT
  names it: deployed first, every upload answers 500. It only adds a
  nullable column and an index, so applying it early is safe.
- **Apply `0457dddf041a` (name parts, KAN-326) before the deploy that maps
  them**. The model selects `first_name`,
  `middle_name` and `last_name` with every account row, so deployed first,
  every signed-in request fails, `get_current_account` included. It only
  adds nullable columns and fills them from `full_name`, so applying it
  early is safe. A branch with these models cannot run against the shared
  database until it is applied, so merge the migration to `main` in its own
  PR first, then apply it, then test the branch.
- **Apply `a7d3e5c1b942` (`autofill_answers`, KAN-283) before the deploy
  that reads it.** It sits on KAN-262's `9d3f6b1e4a72`
  (`applicant_profiles.contact_email`), which sits on `c785e96ac011`. It
  only adds a table, so the running code never meets it and applying it
  early is safe; deployed first, onboarding's Continue answers 500 and the
  Profile step never loads saved answers.
- **A new answer bank key needs the API live before the web** (KAN-299).
  The schema forbids keys it does not know (`extra="forbid"`, which catches
  a mistyped key), so a web that sends a new one to an older API gets a 422
  ("Extra inputs are not permitted") on onboarding's Continue and My
  Profile's Save until the API deploy lands. No migration is involved: the
  bank is JSONB. Merging deploys both halves with nothing ordering them; if
  the web lands first, redeploy it after the API, or wait the minutes out.
- **When the feed gains a column: migration, then import, then deploy.** An
  import against the older schema fails on the unknown column and, being one
  transaction, writes nothing.
- **Apply `bb8c9c6dee0b` with or after KAN-202's review fixes.** It only
  changes two foreign keys (no column the code maps), so either order
  works. Before it, a hard-deleted posting still cascades to tailored
  resumes and their bullet variants.
- **Apply `c3e5a7b9d146` (`writing_samples`, `style_cards`, KAN-384)
  before the deploy that reads them.** It only adds tables, so applying it
  early is safe; deployed first, the connector's get_next_application and
  the writing-samples routes answer 500.
- **Apply `f2b8d6c4a913` before deploying KAN-217.** It adds
  `bank_bullet_variants` and `built_resume_bullets.variant_id`, which the
  model maps, so Generate's inserts fail on a database without it.
- **Apply `e1c4a7b9d215` before deploying KAN-215.** It adds
  `job_postings.keywords` and `keywords_hash`, which the model maps, so
  company job creation and the feed import fail on a database without them.
- **Apply `3f7a2c9d1e84` only AFTER deploying KAN-240.** It drops
  `resumes.parsed_json`, which the code before KAN-240 names in every
  upload's INSERT, so applying it first makes every resume upload answer
  500. The order: merge and deploy, then `uv run alembic upgrade head`. The
  Chrome autofiller still reads
  `parsed_json` through `GET .../resumes/{id}`, which now returns no such
  key; its owner is moving it to the bank (`../autofiller_extension/`, not
  ours to change).
- **Apply `5753545063f3` before deploying KAN-207.** It adds
  `applicant_profiles.default_built_resume_id`, which the model maps, so the
  new code's signup INSERT fails on a database without it
  (`app/models/CLAUDE.md`, "A new column reaches the database...").
- **`vercel.json`'s build command fetches Tectonic** (pinned, SHA-256
  checked) and warms its cache into `vendor/`, which the function bundles.
  A build that cannot fetch it fails rather than shipping without TeX
  (`app/services/resume_render/CLAUDE.md`). Removed at the KAN-296 cutover.
- **`../scout` is installed as a non-editable path source.** uv copies it into
  site-packages at build time; an editable install would point at a folder the
  function (or the image's final layout) need not have.
- **The container keeps 5 connections open; Vercel opens one per
  request.** `DB_POOL_SIZE` (`app/config.py`) is 0 by default, which is
  `NullPool`, and the Dockerfile sets 5. Under `NullPool` in the container
  every request spent ~1 s opening its connection, and pages took 3–9 s
  (2026-10-21). A Vercel Function is short-lived, so it keeps `NullPool`.
  `max_overflow` equals the pool size, so three instances hold at most 30
  Supavisor clients, which still pools them onto a few Postgres backends. `pool_pre_ping` and
  `pool_recycle` replace a connection Supavisor has dropped.
- **`/health/db?timing=true` reports `pool`, `first_ms` and `again_ms`**
  (plain `/health/db` runs one query and returns only the status, since the
  route is public), timed
  in-process: `again_ms` is one database round trip from wherever the API
  runs (8–30 ms from ENAM; 150 ms from the West Coast). Read it first when
  the deployed API turns slow. They are in the body because Cloudflare drops
  a `Server-Timing` header.
- **Still open, closes at the KAN-296 cutover:** Vercel's 4.5 MB request-body
  limit against the 5 MB upload cap (`../frontend/CLAUDE.md`, Deployment).
  Cloudflare accepts 100 MB bodies.

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
  come from the row, never the token. The one value copied the other way is
  the sign-in email: `get_current_account` writes the token's onto the row
  when they differ (Settings' Change Email, KAN-326), and keeps the old copy
  if another row holds the new address. Tests: `tests/test_sign_in_email.py`.
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
- **Deleting an account is `DELETE /auth/me`** (KAN-326, Settings' Delete
  Account): every file under `<applicant_id>/` in each bucket of
  `ACCOUNT_BUCKETS` (`routers/auth.py`), sub-folders included (the
  pre-KAN-267 `sent/`), then the auth user, whose foreign keys cascade to
  every row. Files go first because Storage has no cascade. **A new bucket
  keyed by the account joins `ACCOUNT_BUCKETS`**, or deleted accounts leave
  its files behind. Every foreign key to `applicant_profiles` or
  `auth.users` must cascade or set null, or Supabase refuses the delete
  ("Database error deleting user"). Company accounts get a 403 until a
  company owner's delete is designed. Tests: `tests/test_delete_account.py`.

- **Email verification is required** (KAN-293). Signup does not pass
  `email_confirm: True`, and then asks Supabase for the confirmation email
  itself (`auth.resend(type="signup")`): the admin `create_user` sends no
  email of its own, so without that call no new account could ever sign in.
  If the email can't be sent, signup deletes the auth user (the profile row
  cascades) and answers 502, so a retry starts clean. The frontend
  redirects to `/signup/check-email` after signup; the link lands on
  `/auth/confirm`. A taken email returns 201 silently (same response
  shape, dummy id, no profile row) and resends the email, which reaches
  only an account still unconfirmed. Supabase's own CAPTCHA setting stays
  off: its `/resend` would then want a Turnstile token, and signup has
  already spent the one it got. Tests: `tests/test_signup.py`.
- **Turnstile verification on signup** (KAN-293). The `captcha_token` field
  in `SignupRequest` is verified server-side against `TURNSTILE_SECRET_KEY`
  (`app/config.py`). When the key is `None` (local dev), verification is
  skipped.
- **Company signup is gated** (KAN-293). Both `signup()` and
  `complete_oauth_account_type()` reject `AccountType.COMPANY` with 403.
- **Password reset** is handled entirely by the frontend through Supabase's
  `resetPasswordForEmail` and `updateUser`. No API route is involved.

Still open:

- Deleting an account from the Supabase dashboard cascades its rows but
  leaves its Storage files; `DELETE /auth/me` removes both.
- A company account cannot be deleted (403).
- Joining an existing company: no endpoint; the form's Join tab is a
  placeholder.
- Nothing sets a membership's `onboarding_completed_at`, so `/auth/me` always
  reports a company as not onboarded. Whatever builds company onboarding must
  set it.

Accepted risks (KAN-293):

- Per-IP rate limiting: Turnstile is the only bot protection for now. Per-IP
  limiting is a follow-up after the Cloudflare cutover.
- OAuth account linking: with email verification on, an attacker cannot
  confirm someone else's email, so automatic linking is safe.
