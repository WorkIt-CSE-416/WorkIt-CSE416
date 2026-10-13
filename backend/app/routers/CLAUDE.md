# CLAUDE.md — routers

API endpoints. Each file is one domain with one `APIRouter()`, registered in
`app/main.py` with `app.include_router()`. Each router's module docstring is
the reference for its endpoints, query parameters and response shapes; keep it
current when a route changes.

## Conventions

- **Protected routes depend on `get_current_account`** (`app/deps.py`;
  company-scoped ones on `get_company_member`). Identity comes from that,
  never from a path parameter or body field. A path naming an `applicant_id`
  is checked against the token's account before anything else runs
  (`assert_applicant_owns` in `app/deps.py`).
- **Database access is `Depends(get_session)`**, one session per request.
- **Blocking work uses `asyncio.to_thread`**: the Supabase Storage SDK is
  synchronous, and Pillow image decoding is CPU-heavy. Pass the callable and
  its arguments separately:
  `await asyncio.to_thread(client.storage.from_(BUCKET).upload, path, contents, opts)`.
- **Validate at the boundary.** File type and size checks run before any
  upload or database write. Read with `file.read(MAX_SIZE + 1)` so an
  oversized file is never loaded whole. Client-supplied JSON stored as-is is
  size-capped too; a resume's `parsed_json` is no longer client-supplied
  (KAN-211), only the parser's output.
- **Clean up on failure.** If the commit fails after a Storage upload, the
  endpoint deletes the orphaned file before returning the error.
- **Storage buckets are made in the dashboard, not by migrations.** A new
  bucket's name and settings go in its `../../../docs/*.md` note (`Resume` and
  `Avatar` exist). A route pointing at a missing bucket fails with a 502 on the
  first upload.
- **A catch-all path parameter route is registered last** (`GET /jobs/{job_id}`),
  so named paths like `/jobs/facets` match first.
