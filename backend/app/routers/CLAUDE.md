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
| `resumes.py` | `/applicants/{applicant_id}/resumes` | Resume file upload (PDF/DOCX) to Supabase Storage + DB row |

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

- **No auth yet.** Endpoints accept `applicant_id` as a path parameter.
  Once auth lands, identity comes from the verified token, not from the URL.

## Adding a new router

1. Create `app/routers/<domain>.py` with an `APIRouter()` instance
2. Import and register it in `app/main.py`
3. Add it to the table above
