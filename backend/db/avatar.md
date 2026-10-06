# Profile photo — design

How an applicant's profile photo is accepted, stored and served. Rationale
only: Alembic is the source of truth for the column, and
`app/services/avatar.py` for the exact limits.

## Where the bytes live

**Supabase Storage, private bucket `Avatar`. Postgres holds only the path.**

```
applicant_profiles.avatar_path   '<applicant_id>/<random uuid>.webp'   (nullable)
Storage  Avatar/<applicant_id>/<random uuid>.webp                      (the file)
```

Not a `bytea` column: an image in a row is read by every `SELECT *` on the
table, lands in every backup, and counts against the database size limit,
which on Supabase is far tighter than Storage's. Same split the resumes use.

The column was `avatar_url` from the initial schema and was renamed by
`4f1a9c2e7b30`. It holds a path, not a URL, because the bucket is private: the
only URLs that work are signed ones, and those expire. `company_memberships`
got the same rename (both tables share the `Profile` mixin) but nothing writes
it yet.

## What is accepted

| Rule | Value | Enforced by |
| --- | --- | --- |
| Formats | JPEG, PNG, WebP | Pillow decodes with only those plugins — from the bytes, never the client's content type |
| Upload size | 4 MB | Router (`MAX_UPLOAD_BYTES`), after `read(limit + 1)` |
| Dimensions | ≤ 40 megapixels | Checked from the header before any pixels are decoded |

Rejected on purpose: **HEIC** (Pillow can't decode it without a plugin, most
browsers can't display it, and iOS converts to JPEG when the file picker
restricts types), **GIF** (animation is not wanted in an avatar), **SVG** (can
carry script).

The pixel cap is the one that matters for safety. File size says nothing
about decode cost: a 94 KB PNG can declare 10000×10000 and expand to 100 MB in
memory. 40 MP covers every current phone camera.

4 MB covers what a phone produces, and the upload is transient — see below.
It was 5 MB until the deploy (KAN-146): Vercel refuses request bodies over
4.5 MB before Next runs, so the cap had to fit under that.

## What is stored

**Every upload is re-encoded to a 512×512 WebP at quality 82**, centre-cropped
to a square. Typical output is 20–60 KB; a 9 MB worst-case noise JPEG came
out at 56 KB. So storage per applicant is bounded at one small file however
large the upload was.

Re-encoding also:

- **Strips EXIF**, including GPS coordinates phones embed. EXIF orientation
  is applied to the pixels first, so rotated photos stay upright.
- **Keeps the ICC colour profile**, which carries no personal data; without
  it Display-P3 photos render washed out.
- **Guarantees the stored bytes are an image Pillow wrote**, so a polyglot
  file (valid JPEG header, something else after) cannot survive.

512 px covers the largest avatar on screen (116 CSS px, the profile card) at
3× density.

## Lifecycle

- **Upload** (`PUT /applicants/{id}/avatar`): normalize → upload to a **new**
  random path → lock the profile row, swap the path, commit → delete the old
  file. A new path per upload rather than overwriting, because browsers and
  Supabase's CDN cache by URL. If the commit fails, the new file is deleted.
  If deleting the old file fails, it is logged and orphaned; no data is lost.
- **Read** (`GET`): returns a signed URL valid for one hour — the access
  token's lifetime — or `null`, and the frontend draws initials.
- **Delete** (`DELETE`): clear the column, commit, then remove the file.
- **Account deletion**: the profile row cascades from `auth.users`, but
  Storage objects do not. Nothing cleans up `Avatar/<id>/` yet — the same gap
  resumes have.

## Who can see it

Any signed-in account can view any applicant's photo: `GET` depends on
`get_current_account`, so anonymous requests are a 401, but there is no
ownership check. Only upload and delete are owner-only (`_assert_can_edit`).
If viewing ever needs narrowing — say, recruiters only for applicants who
applied to their company — add the check in `get_avatar`.

## Bucket setup (dashboard, once per Supabase project)

Storage buckets are not schema, so no migration creates them. Create
**`Avatar`** with:

- **Public: off.** Photos are served through signed URLs only.
- **File size limit: 1 MB.** Only the API's re-encoded WebP ever lands here,
  so this is a backstop, not the user-facing limit.
- **Allowed MIME types: `image/webp`.** Same reason.

No Storage RLS policies: the API uploads with the service-role key, which
bypasses them, and nothing else should write to the bucket.

## The limit lives in three places

The 4 MB figure must agree across:

1. `MAX_UPLOAD_BYTES` in `app/services/avatar.py` — the real guard.
2. `MAX_AVATAR_BYTES` in `frontend/src/lib/avatar-rules.ts` — instant
   feedback in the browser.
3. `serverActions.bodySizeLimit` in `frontend/next.config.ts` (`4.5mb`) — must
   stay **above** the other two plus multipart overhead, and at or below
   Vercel's 4.5 MB request-body ceiling. If it drops below,
   Next rejects the request with a generic error before the server action
   runs, and the user never sees the API's message.
