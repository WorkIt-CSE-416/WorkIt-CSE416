# Sent resumes per application (KAN-267)

Status: **design, not built.** It changes how sent resumes (KAN-208) are kept,
links each application to the resume it went out with, and stops duplicate
resumes at upload and at Generate. `resume.md`, "Sent resumes", describes what
is built today; this file is the plan that replaces it.

## Goal

For every application, the student can see which resume they sent, and open
it as a PDF, for as long as the application exists. Storage stays as small as
we can make it.

A student applies with one of two kinds of resume:

| Kind | What we keep | Why |
|---|---|---|
| **Uploaded resume** (their own file, at most 5) | A pointer to the file already in Storage (`storage_path`) | The file exists already; pointing at it costs nothing |
| **Built resume** (generated or tailored by WorkIt) | A frozen copy of its content: gzipped JSON in Postgres, rendered to a PDF again when the student opens it | We made it, so we can make it again; about 2 KB, not a 33 KB PDF |

## Why this shape

Measured on the sample resume (Jake's template, `resume_render/sample.py`):

| Stored | Size |
|---|---|
| The PDF | 33 KB (gzip saves under 4%) |
| The render input as JSON | 8.5 KB |
| The same JSON, gzipped | 2 KB |

Today every built-resume send renders a PDF and uploads it to the `Resume`
bucket, and a repeat is merged only within one job posting. One unchanged
resume sent to 40 job postings is 40 identical PDFs. For 1,000 students with
50 applications each, that is about 1.65 GB, past the free plan's 1 GB of
Storage. Snapshots of the same sends are about 100 MB of database at most, and
far less with the hash reuse below.

Options we rejected:

- **Keep PDFs, but share one file per hash.** About 165 MB for the same
  students. Exact and fast to open, but still 15 times the snapshot size.
- **Parse uploaded resumes into JSON too.** The uploaded file is already
  stored and costs nothing more; a parsed copy would only lose formatting.
- **Store built resumes themselves as JSON.** A built resume is live: its
  choice rows point at the experience bank, so a bank fix shows on every
  resume (ADR 0001). Only the *sent* copy is frozen.

## Data model

```
applicant_profiles
  ├── resumes            + file_hash (sha256 of the uploaded bytes)
  ├── resume_snapshots   NEW: one per distinct built-resume content
  │     content_hash, data (gzipped JSON)        UNIQUE (applicant_id, content_hash)
  ├── sent_resumes       one row per send: name then, time, job posting
  │     storage_path  → an uploaded resume's file     ┐ exactly one
  │     snapshot_id   → resume_snapshots              ┘ (new CHECK)
  │     built_resume_id / uploaded_resume_id: the source, a record only
  └── job_applications   + sent_resume_id → sent_resumes (ON DELETE SET NULL)
```

### `resumes.file_hash`

- `String`, nullable. sha256 of the uploaded file's bytes, hex.
- Partial unique index on `(applicant_id, file_hash) WHERE file_hash IS NOT
  NULL`. The database, not only the code, stops two equal uploads, so two
  tabs uploading at once cannot both win.
- Rows uploaded before this column have `NULL` and are never matched. A
  backfill would have to download every file from Storage; see Open
  questions.

### `resume_snapshots` (new table)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `applicant_id` | uuid FK → `applicant_profiles`, `ON DELETE CASCADE` | |
| `content_hash` | string | sha256 of the snapshot JSON (below) |
| `data` | bytea | gzip of the snapshot JSON |
| `created_at` | timestamptz | |

- `UNIQUE (applicant_id, content_hash)`: one snapshot per distinct content.
- RLS enabled with no policies, as every new table (root `CLAUDE.md`, Auth).
- `bytea`, not `jsonb`: we never query inside a snapshot, and we choose the
  compression ourselves. Postgres compresses a value only once it passes
  about 2 KB, and its own compressor (pglz) is usually weaker than gzip on
  JSON; this is not measured yet.

### `sent_resumes` changes

- New `snapshot_id` → `resume_snapshots`, `ON DELETE RESTRICT`, indexed. The
  service removes a snapshot only when no sent resume uses it (as
  `file_in_use` does for files).
- `storage_path` becomes nullable.
- New CHECK `sent_resumes_one_file`: `num_nonnulls(storage_path, snapshot_id)
  = 1`. Rows written before this change all have a `storage_path`, so the
  CHECK holds for them.
- `content_hash`, `built_resume_id`, `uploaded_resume_id`, `job_posting_id`,
  `name` keep their meaning.

### `job_applications.sent_resume_id`

- Nullable FK → `sent_resumes`, `ON DELETE SET NULL`, indexed (for the SET
  NULL).
- `NULL` means the student applied without a resume, or applied before this
  existed.
- It is the answer to "which resume did this application use". A posting can
  have several sent resumes (the student picked one, then another); this
  column says which one they applied with.

### Migrations

Three, each additive, so the code deployed before them keeps working. Apply
each before the deploy that writes it. Claude writes and checks them with
`--sql`; the user runs `uv run alembic upgrade head`.

1. `resumes.file_hash` and its partial unique index.
2. `resume_snapshots` (with RLS), `sent_resumes.snapshot_id`, nullable
   `storage_path`, the `sent_resumes_one_file` CHECK.
3. `job_applications.sent_resume_id`.

Downgrade of 2 deletes the sent resumes that have a snapshot (the old table
cannot hold them) before `storage_path` goes back to NOT NULL.

## The snapshot

### What it holds

Exactly what `render(view, identity, template)` and `render_docx(view,
identity)` read, at the moment of sending:

```json
{
  "v": 1,
  "format": "pdf",
  "template": "jakes",
  "identity": { "name": "...", "email": "...", "phone": "...", "links": [["linkedin_url", "https://..."]] },
  "view": { "sections": [...], "skills": [...] }
}
```

- `identity` is the header from the profile at that moment
  (`load_header_identity`). A later profile change does not reach it.
- `view` is `dataclasses.asdict(ResumeView)`: bullet text already resolved to
  the chosen variant, hidden items already left out.
- `v` is the snapshot format's version, for a reader that must handle an
  older shape later.

### The hash

`content_hash` is `sent_resumes.content_hash()` as it is today: sha256 of
`template`, `identity` and `view` (plus `format` when it is not PDF), with
sorted keys. Reusing it means a new snapshot and an old sent PDF of the same
content have the same hash.

### Reading it back

New `resume_view.view_from_json()`: the inverse of `asdict`, turning ISO dates
back into `date`, GPA strings into `Decimal`, id strings into `UUID`, lists
into tuples. A round-trip test (`view_from_json(asdict(v)) == v`) guards it.

### What "the same resume" means after a re-render

The content is exact: every word, date and order is the one sent. The pixels
can drift only if the renderer changes:

- **The template file** is already pinned: `test_jakes_preamble_is_byte_for_byte`
  fails on any edit to `jakes.tex`. Rule: a changed template gets a new
  template id (`jakes-2`), and the old one stays in the code while a
  snapshot names it.
- **The body code** (`resume_render/jakes.py`) and Tectonic's version are not
  pinned. A change there can move a line break in an old snapshot. We accept
  this: the record is what was said, not the exact layout.

## Flows

### 1. Upload (Resumes page, and from the Apply picker)

`POST /applicants/{id}/resumes`, before the Storage upload:

1. Hash the bytes.
2. A resume of this applicant with the same `file_hash` → **409**, nothing
   written: `{"detail": {"message": "Resume Duplicate found at <name>",
   "resume_id": "<id>"}}`. `<name>` is the existing row's
   `original_filename`, the name the Resumes page shows.
3. Else the cap check as today (`check_room`, 409 at 5).
4. Upload, insert with `file_hash`. A unique-index violation at commit (a
   race) answers the same 409 and removes the uploaded file.

`PUT /applicants/{id}/resumes/{rid}` (Import Updated Resume) does the same
check against every *other* resume of the applicant, then sets the new
`file_hash`. The old file stays while a sent resume points at it (built
today).

Frontend: `apiErrorMessage` (`frontend/src/lib/auth.ts`) reads only a string
`detail`; it learns to read `detail.message`. The upload UI names the
duplicate, and the Apply picker selects it.

The hash catches the *same file* only. A resume exported again from Word has
new bytes (a PDF stores its creation time), so it counts as a new file.

### 2. Generate

`POST /applicants/{id}/built-resumes` (the router, not
`service.generate`):

1. Build the new resume as today, but before the commit, compute its
   content hash (`load_view` + `content_hash`, no render).
2. Compute the same hash for each of the applicant's other built resumes,
   *now*. It cannot be stored: an edit in the editor or in the bank changes
   it.
3. A match → **409**, rolled back: `{"detail": {"message": "This is the same
   as “<name>”.", "built_resume_id": "<id>"}}`. The UI offers to open that
   resume.

Tailor's own Generate (`routers/tailor.py`, when the student has no base
resume) skips the check: it runs only when there is no other resume to
match. Tailor's Done edits the posting's one tailored resume in place, so it
never makes a duplicate.

Cost: one bank load and one `build_view` per built resume, no render.
Students have a handful.

### 3. Apply Now (the job posting's page)

The dialog (`jobs/[jobId]/apply-button.tsx`) keeps its steps. What changes:

- **Pick a resume** lists built and uploaded resumes as today, plus
  **Upload a resume**: flow 1, then that resume is picked. At the cap, the
  picker asks which of the 5 to replace (flow 1's PUT). A duplicate selects
  the existing one.
- **Apply** calls `POST .../sent-resumes` as today:
  - Uploaded: a sent resume with the file's `storage_path` (built today).
  - Built: render once (the student needs the file to attach), get or create
    the snapshot (`INSERT ... ON CONFLICT (applicant_id, content_hash) DO
    NOTHING`, then select), then a sent resume with `snapshot_id`. **No
    upload to Storage.** A repeat for the same posting and snapshot returns
    the last sent resume, as today.
- **Your Resume Is Ready** gives the file from the response (below), not a
  signed URL.
- **Did You Apply?** → Yes calls `POST /jobs/{id}/applied` with
  `{"sent_resume_id": "<id>"}`.

A student who chose **Apply Without a Resume** sees the picker on the Did
You Apply? step, with "I didn't send a resume" as one choice.

### 4. Mark applied

`POST /jobs/{job_id}/applied` takes an optional body `{"sent_resume_id"}`.

- The sent resume must be this applicant's and linked to this posting, else
  404.
- Sets `stage = applied` (as today) and `sent_resume_id` in the same upsert.
  A second call with a resume sets the resume but keeps the first
  `applied_at`.
- No body: as today, so the deployed frontend keeps working during the
  rollout.

### 5. Auto apply

`pipeline.prepare_resume` calls `send_built` / `send_uploaded` as today, and
sets the application's `sent_resume_id` in the same commit: the application
row exists already (`queued` or `needs_you`), and a run that starts again
gets the same sent resume back. A skipped application keeps the link, which
does no harm. Its response carries the file the same way as flow 6. The
extension does not call it yet (the runner is planned,
`auto-apply/architecture.md` §5); base64 bytes suit it better than a URL,
since it must build a `File` for the form anyway.

### 6. Open a sent resume

`GET /applicants/{id}/sent-resumes/{sid}/file` answers one of:

- **A file row** (uploaded, or a PDF kept before this change):
  `{"url": "<5-minute signed URL>", "file_name"}`, as today.
- **A snapshot row:** gunzip, `view_from_json`, render (about 0.3 s), and
  answer `{"data": "<base64>", "content_type", "file_name"}`. Nothing is
  stored.

The frontend turns `data` into a Blob URL (`URL.createObjectURL`) and opens
or downloads it, the same way the editor's preview already takes base64 from
`GET .../render`. One helper, `openSentResume(sid)`, hides the two shapes.

Where the student sees it:

- The job posting's page: "You sent <name> on <date>" becomes a link.
- The Applications board: each applied card gets **View Resume** when its
  application has a `sent_resume_id`. Fetch the file only on click.

### 7. Delete

- **A sent resume:** remove the row; then remove its snapshot if no other
  sent resume uses it, or its file if `file_in_use` says nothing does
  (built today for files).
- **An uploaded resume:** as today: its file stays while a sent resume points
  at it. A replaced or deleted upload whose file a sent resume keeps does not
  count toward the 5.
- **A built resume:** nothing changes for sent resumes; the snapshot is a
  copy and does not need it.
- **An application** (unsave, dequeue): the sent resume stays.
- **The account:** everything cascades from `applicant_profiles`, as today.

## Rows written before this change

Sent resumes from built resumes kept before this change have a PDF in
Storage and no snapshot. They stay as they are and open through flow 6's
file branch. We cannot turn a PDF back into a snapshot. Decided: no cleanup
and no special handling for them; they are few and stop growing once
snapshots ship.

## API summary

| Route | Change |
|---|---|
| `POST /applicants/{id}/resumes` | 409 with `detail.message` and `resume_id` for an equal file; stores `file_hash` |
| `PUT /applicants/{id}/resumes/{rid}` | Same check against the other resumes |
| `POST /applicants/{id}/built-resumes` | 409 with `detail.message` and `built_resume_id` for an equal resume |
| `POST /applicants/{id}/sent-resumes` | Built: snapshot, no Storage. The response gives the file as `data` (built) or `url` (uploaded) |
| `GET /applicants/{id}/sent-resumes/{sid}/file` | `{url, file_name}` or `{data, content_type, file_name}` |
| `POST /jobs/{job_id}/applied` | Optional `{"sent_resume_id"}` |
| `POST /applicants/{id}/applications/{job_id}/resume` (auto apply) | The file the same way as above |
| `GET /applicants/{id}/applications` | Each application adds `sent_resume_id` (and the sent resume's `name`) |

The extension reads `GET /applicants/{id}/resumes` and `.../{rid}`; both
only gain `file_hash`, which it ignores. Nothing it reads changes shape.

## Build order

Each step is one PR with its migration, code, tests and `CLAUDE.md` updates.

1. **Upload duplicates.** Migration 1, the hash check in POST and PUT,
   `apiErrorMessage` reading `detail.message`, the message on the Resumes
   page.
2. **Snapshots.** Migration 2, `view_from_json`, `send_built` writing
   snapshots, flow 6's two shapes, `openSentResume` in the frontend, the
   Apply dialog's download, `prepare_resume`'s response.
3. **Application link.** Migration 3, `POST /jobs/{id}/applied` with
   `sent_resume_id`, `prepare_resume` setting it, the Did You Apply?
   picker, Upload in the picker, View Resume on the Applications board and
   the job posting's page.
4. **Generate duplicates.** The live hash check on Generate and its 409 in
   the Resumes page.

## Tests

Behaviour only; no test of a prompt's wording.

- `view_from_json(asdict(view)) == view` for the sample view, with GPA,
  dates, coursework and a variant bullet.
- Two sends of unchanged content to two postings: two sent resumes, one
  snapshot, no Storage upload.
- A changed bullet gives a new snapshot.
- Deleting the last sent resume of a snapshot removes the snapshot; deleting
  one of two keeps it.
- The CHECK refuses a sent resume with both or neither of `storage_path` and
  `snapshot_id`.
- Upload of an equal file: 409 naming the first, no file in Storage, no row.
  The same file from another applicant uploads fine.
- PUT with a file equal to another resume: 409; with a new file: works.
- Generate twice with no edit between: the second answers 409. Edit the
  first, Generate again: works.
- `POST /jobs/{id}/applied` with another applicant's sent resume, or one for
  another posting: 404. Without a body: applied, `sent_resume_id` NULL.
- A sent resume kept before the change still opens through its URL.

## Open questions

1. **Generate duplicates: refuse or warn?** Refusing matches uploads. But a
   student may want a copy to edit apart from the first. A warning with
   "Open it" and "Make a copy anyway" keeps both.
2. **Plain downloads.** Today every download from the Resumes page is a sent
   resume. With snapshots that costs about 2 KB each. Keep recording them, or
   record only Apply and auto apply? Recording only applications makes the
   list mean "what employers got".
3. **Backfill `file_hash`.** Old uploads are never matched until hashed. A
   one-off script (run by the user, since it writes the database) would
   download each file and set the hash. With at most 5 per student, it is
   small.
4. **Byte hash or text hash for uploads.** The byte hash misses a file
   exported again. A hash of the extracted text (`raw_text`, whitespace
   folded) catches it, but also calls two files with the same words and a
   different layout the same.
