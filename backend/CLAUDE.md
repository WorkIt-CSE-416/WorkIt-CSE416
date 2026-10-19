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
- **KAN-233's contract is two migrations around one deploy.** Apply
  `aa97037c00e5` (moves the rows), merge and deploy, then `uv run alembic
  upgrade head` for `188c8c2d7c14` (drops the old levels). `188c8c2d7c14`
  before the deploy fails every Experience filter and count on the live Jobs
  page (`app/models/CLAUDE.md`, KAN-233).
- The feed's `roles` keys (KAN-172) are ignored: `JobListing` doesn't declare
  them, so a new scraper key never fails the import. A job's roles are its
  `job_role_tags`, resolved from its title (KAN-155).
- A `--dry-run` writes and rolls back, leaving dead rows until autovacuum, so
  table sizes read right after one are inflated.

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
- **An auto apply test seeds a Greenhouse `apply_url`** (`_seed_posting(database,
  url)` in `tests/test_sent_resumes.py`): the queue refuses every other host
  (`app/auto_apply/hosts.py`) with a 404. The Greenhouse-only rule broke six
  database tests that seeded `example.com`; they skip without the local
  container, so only CI caught it (2026-10-17). Run them with the container
  up before pushing a change to auto apply's queue.
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
- **Auto apply** (`app/auto_apply/`): KAN-223's layers 1 and 2, in three
  files by kind: `rules.py` pure (no session), `queries.py` database, and
  `pipeline.py` the steps that call them. Unlike a service, its functions may
  take a session; its routes still go in `app/routers/`. Read
  `../auto-apply/architecture.md`, "The function layers", before adding one:
  a layer-2 step that skips a layer-1 check lets any caller skip it. Its
  resume step (`prepare_resume`) keeps the file through
  `services/sent_resumes.py`, never Storage or the renderer itself, so a
  resume auto apply sends is a sent resume under Apply's rules (the repeat
  hash, the file kept while a row uses it). **Which job postings it takes is
  one list, `app/auto_apply/hosts.py`** (Greenhouse for now): the matches
  and `queue_applications` require its SQL form (`AUTO_APPLY_SUPPORTED` in
  `queries/jobs/filters.py`) and `JobListing.auto_apply` its Python form,
  which the Jobs page reads to show the button. One pattern serves both, so
  they agree; the Python form is tested against URLs, the SQL form only by
  the SQL it sends (on 2026-10-17 the two agreed on all 13,308 listed jobs
  in the dev database).
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
- **An upload fills the bank** (KAN-240, `../docs/adr/0003-upload-fills-the-experience-bank.md`).
  `POST .../resumes` extracts `raw_text`, reads it with the heuristic
  parser (`services/bank_import.py`'s `read`, pure) and writes it with
  `services/bank.py`'s `merge_import`, in the same transaction as the
  resume row: if the commit fails, nothing is kept and the Storage file is
  removed. The parser's reading is stored nowhere else (`parsed_json` is
  gone). The response's `bank` says what went in, with `found` (what the
  reading found, written or not) so the screen can tell "read nothing"
  from "already in your bank". A reading never fails an upload: a parser
  crash reads as nothing.
- **Import merges, never copies.** `merge_import` adds an entry the bank
  lacks; one that `find_duplicate` matches gains only the fields it has
  empty and the bullets it lacks (ignoring case and spacing), so what the
  student fixed stays fixed and several resumes add up to one bank. Dates
  fill only as a set, when the bank entry has none: a merge never pairs one
  resume's start with another's end. A fill that clashes with a kept field
  (a GPA above the bank's scale) is dropped, and the bullets still go in.
- **Import Again** is `POST /applicants/{id}/bank/import`: the same read and
  merge on a stored upload, from intake's Use One I Uploaded and the Jobs
  page's empty-bank card. It re-reads `raw_text`, so a resume uploaded
  before a parser fix gets the fix. It can bring back a bullet the student
  deleted; that is the student's explicit click.
- **Import Updated Resume** is `PUT /applicants/{id}/resumes/{resume_id}`
  with a file, from an upload's row on the Resumes view: a newer version replaces the row's
  file and is read and merged as an upload is. The row keeps its id and
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
- **The resume limit is 5 uploads** (`services/built_resumes.py`'s
  `check_room`, called by upload before anything is written; 409 with the
  reason). Built resumes (base and tailored) and sent resumes do not count,
  so Generate, and Tailor's Generate, are never refused for it. Base
  resumes counted until KAN-268.
- **A student's only resume is the default** (`services/built_resumes.py`'s
  `default_if_only`): upload, Generate (Tailor's too) and both deletes call
  it, so the last resume left after a delete takes the star. With two or
  more it changes nothing. Before it, a student with one resume and no star
  click had no default, and auto apply attached nothing. It is not
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
  - **An entry brought back is never a copy of one shown** (`bank.py`'s
    `copy_key`: section, title and organization ignoring case, and the
    same months, which Generate and intake's bank match also use), and it takes its date-order place among its
    section's shown entries (`_bring_back`), not the end. A change names
    its entry with the organization ("Software Intern, Acme"). An import
    saved "as new" left a second Software Engineer Intern at Clever Devices
    off a resume; Tailor offered "Bring back: Software Engineer Intern",
    showed the job twice below an older one, and ran to 2 pages
    (2026-10-14).
  - **One run is one `TAILOR` use**, counted after the model answers and
    the proposals are built; a keyword extraction inside the run is not a
    second use. A run with no base resume generates one first (saved with
    the count).
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
  business holding that connection. Embeddings use Ollama with
  `nomic-embed-text:v1.5` by default; see `app/services/matching/CLAUDE.md`.
  **Still open:** the deployed API has no Ollama, so until the Vercel project
  sets `EMBEDDING_PROVIDER=gemini` and `GEMINI_API_KEY`, recommendations
  score without the semantic part.
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
