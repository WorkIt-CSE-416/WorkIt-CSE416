# CLAUDE.md — routers

API endpoint definitions. Each file is one domain, registered in `app/main.py`
via `app.include_router()`.

## Pattern

Every router follows the same structure:

1. Create an `APIRouter()` instance
2. Define endpoints as `async def` functions
3. Use `Depends(get_session)` for database access — one session per request
4. Use `get_supabase()` for Supabase Storage operations (file uploads)
5. Import the router in `main.py` and register it with `app.include_router()`

## Current routers

| File | Prefix | What it does |
|------|--------|--------------|
| `auth.py` | `/auth` | `POST /signup` creates the Supabase auth user, then the applicant profile or the company + owner membership; `GET /me` returns the caller's account; `GET /oauth/status` and `POST /oauth/account-type` let a Google/LinkedIn sign-in pick Applicant or Company and finish what `/signup` does for a password account |
| `jobs.py` | `/jobs` | Public `GET` of published scraped jobs from `job_postings` (`company_id` NULL), newest `posted_at` first, without descriptions, in the feed's `JobListing` shape with the row's UUID as `id`. `?location=` (repeated; `US` or `US-CA`, 60 at most) keeps jobs with a `job_locations` row in any of those places. `?work_style=`, `?experience=` (`internship`, `new_grad`), `?job_type=` (repeated, any of), `?posted_within=` (days) and a pay range, `?min_pay=` and `?max_pay=` with `?pay_per=` (`hour` or `year`), narrow it further, and so do `?start_term=` (seasons: `summer-2027`, or a bare year; `season_of` turns the terms postings use, "June 2027", into seasons) and `?visa=` (`sponsors`, or `not_ruled_out`, which hides no-sponsorship and citizens-only postings and keeps the ones that say nothing) (`JobFilters`, `matching`). `GET /count` takes the same filters (`read_filters`, shared with the list) and says how many jobs they keep, uncapped, for the All Filters panel's "Show N jobs". `GET /facets` counts every option across the whole feed, seasons not yet over and in calendar order, for the filter row; pay compares as yearly figures (`YEARLY`: hour x 2,080, week x 52, month x 12), a posting matching when its range overlaps the one asked for, in USD only. `GET /locations` lists every country and state that has a published job, with readable labels (a country's name, a state's name alone: "United States", "California", "Other" for `ZZ`) and counts, each country followed by its states and `ZZ` last, for the job board's Location filter, which nests the states under their country. `GET /{job_id}` (registered last, so the named paths match first) returns one with its description for its own page, 404 when it isn't open; it and `scout.py` use `fetch_listing`, which loads one by UUID or by the apply URL that was its id before. The rows get there through `app/scripts/import_jobs.py` |
| `company_jobs.py` | `/company/jobs` | `POST` saves a new job (draft or published), `GET` lists summaries a page at a time (`limit`/`offset`) or loads one, `PUT /{job_id}` updates one if its `updatedAt` still matches (409 otherwise), `POST /{job_id}/status` pauses, resumes or closes one. All scoped to the caller's company; another company's job is a 404. Depends on `get_company_member`, so only active company members get in |
| `resumes.py` | `/applicants/{applicant_id}/resumes` | Upload (POST), list (GET), delete (DELETE) resumes; extracts text from PDF/DOCX and parses into structured JSON. `POST .../parse` returns the parse with no Storage or DB write, for the profile's review dialog; upload then takes the reviewed copy as a `parsed_json` form field instead of re-parsing. `GET .../{resume_id}` returns one resume's `parsed_json` (the list omits it); `PUT .../{resume_id}` replaces it with a full `ParsedResume` body — every edit made on the profile; a section left out of the body comes back empty, which is why it is a PUT and not a PATCH. That body and upload's reviewed `parsed_json` are client-supplied, so both are capped at 256 KB of JSON (`MAX_PARSED_JSON_BYTES`, 413). `PUT .../{resume_id}/default` makes it the primary resume (`applicant_profiles.default_resume_id`; the list reports it as `is_default`). `GET .../{resume_id}/file` returns a 5-minute signed URL: inline for a PDF, a download under the original filename for a DOCX |
| `avatars.py` | `/applicants/{applicant_id}/avatar` | Profile photo: re-encoded to WebP, stored in the private `Avatar` bucket, served as a signed URL. See `../../db/avatar.md` |
| `scout.py` | `/scout` | `POST /chat`: one Scout turn, streamed as NDJSON `ScoutEvent`s. Applicants only, with a daily per-account cap. Hands Scout the applicant's parsed resume and, given a `job_id`, that job. A model that is down answers 200 with an `error` event. See `../../../scout/CLAUDE.md` |
| `profiles.py` | `/applicants/{applicant_id}/profile` | `GET` returns the applicant's identity fields (name, email, phone, headline, URLs); `PATCH` updates only the fields present in the body via `model_fields_set`. Ownership-guarded |

## Conventions

- **Blocking SDK calls use `asyncio.to_thread`.** The Supabase Storage SDK is
  synchronous. Wrapping it in `to_thread` keeps the event loop free for other
  requests. Pass the callable and arguments separately:
  `await asyncio.to_thread(client.storage.from_(BUCKET).upload, path, contents, opts)`.

- **Validate at the boundary.** File type and size checks happen before any
  upload or DB write. Size checks use `file.read(MAX_SIZE + 1)` to avoid
  loading arbitrarily large files into memory.

- **Clean up on failure.** If the DB commit fails after a file was uploaded to
  Storage, the endpoint deletes the orphaned file before returning the error.

- **Protected routes depend on `get_current_account`** (`app/deps.py`), which
  verifies the Supabase access token and loads the account. Identity comes
  from that, never from a path parameter or body field. A path that names an
  `applicant_id` is checked against the token's account before anything
  else runs (`_assert_applicant_owns`, `_assert_can_edit`).

- **Storage buckets are made in the dashboard, not by migrations.** A new
  bucket's name and settings go in its `db/*.md` note — `Resume` and
  `Avatar` exist today. A route pointing at a bucket that does not exist
  fails with a 502 on the first upload.

- **CPU-heavy work goes through `asyncio.to_thread` too.** Image decoding is
  as blocking as a synchronous SDK call; `avatars.py` runs Pillow that way.

## Adding a new router

1. Create `app/routers/<domain>.py` with an `APIRouter()` instance
2. Import and register it in `app/main.py`
3. Add it to the table above
