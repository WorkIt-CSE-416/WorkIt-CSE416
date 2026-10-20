# Sent resumes per application (KAN-267)

Status: **design complete, not built.** It changes how sent resumes (KAN-208)
are kept, links each application to the resume it went out with, stops
recording plain downloads, and stops duplicate resumes at upload and at
Generate. `resume.md`, "Sent resumes", describes what is built today; this
file is the plan that replaces it. Every decision is final unless this file
says otherwise; the decisions are listed at the end.

## Goal

For every application, the student can see which resume they sent, and open
it as a PDF, for as long as the application exists. Storage stays as small as
we can make it.

A student applies with one of two kinds of resume:

| Kind | What we keep | Why |
|---|---|---|
| **Uploaded resume** (their own file, at most 5) | A pointer to the file already in Storage (`storage_path`) | The file exists already; pointing at it costs nothing |
| **Built resume** (generated or tailored by WorkIt) | A frozen copy of its content: gzipped JSON in Postgres, rendered to a PDF again when the student opens it | We made it, so we can make it again; about 2 KB, not a 33 KB PDF |

A sent resume is a record of **what an employer got**: from Apply Now,
"Did You Apply?" and auto apply. A plain download from the resume editor is
not a send and keeps nothing (flow 3).

## Why this shape

Measured on the sample resume (Jake's template, `resume_render/sample.py`):

| Stored | Size |
|---|---|
| The PDF | 33 KB (gzip saves under 4%) |
| The render input as JSON | 8.5 KB |
| The same JSON, gzipped | 2 KB |

Today every built-resume send and every download renders a PDF and uploads
it to the `Resume` bucket, and a repeat is merged only within one job
posting. One unchanged resume sent to 40 job postings is 40 identical PDFs.
For 1,000 students with 50 applications each, that is about 1.65 GB, past
the free plan's 1 GB of Storage. Snapshots of the same sends are about
100 MB of database at most, and far less with the hash reuse below.

Options we rejected:

- **Keep PDFs, but share one file per hash.** About 165 MB for the same
  students. Exact and fast to open, but still 15 times the snapshot size.
- **Parse uploaded resumes into JSON too.** The uploaded file is already
  stored and costs nothing more; a parsed copy would only lose formatting.
- **Store built resumes themselves as JSON.** A built resume is live: its
  choice rows point at the experience bank, so a bank fix shows on every
  resume (ADR 0001). Only the *sent* copy is frozen. Size is not a reason
  either way: a built resume's choice rows and a snapshot are both a few KB.
- **Keep recording downloads.** They date from before Apply Now, when a
  download was the only way a resume left WorkIt. Now every application
  records its own resume, so a download record is only noise in the list.

## Data model

```
applicant_profiles
  ├── resumes            + text_hash (sha256 of the resume's text)
  ├── resume_snapshots   NEW: one per distinct built-resume content
  │     content_hash, data (gzipped JSON)        UNIQUE (applicant_id, content_hash)
  ├── sent_resumes       one row per send: name then, time, job posting
  │     storage_path  → an uploaded resume's file     ┐ exactly one
  │     snapshot_id   → resume_snapshots              ┘ (new CHECK)
  │     built_resume_id / uploaded_resume_id: the source, a record only
  └── job_applications   + sent_resume_id → sent_resumes (ON DELETE SET NULL)
```

### `resumes.text_hash`

- `String`, nullable. sha256 (hex) of the resume's text, not of the file's
  bytes. **The reason:** the same resume uploaded again at a different time
  must be caught. Each export writes a new file (a PDF stores its export
  time, IDs and other metadata), so a byte hash sees a new file each time;
  the text stays the same.
- What is hashed: `raw_text`, which upload already extracts, normalized:
  1. Unicode NFKC, so a PDF's ligature `ﬁ` and the letters `fi` are equal.
  2. Every run of whitespace, line breaks included, becomes one space; the
     ends are trimmed. A new layout that only moves line breaks or column
     gaps gives the same text.
  3. Letter case stays: a case change is an edit.
- **No text, no hash.** An upload with empty `raw_text` (an image-only scan,
  or a file the extractor cannot read) gets `NULL` and is never matched.
- Partial unique index on `(applicant_id, text_hash) WHERE text_hash IS NOT
  NULL`. The database, not only the code, stops two equal uploads, so two
  tabs uploading at once cannot both win.
- Rows uploaded before this column have `NULL` and are never matched. No
  backfill: only uploads after the change are checked.

What the text hash calls a duplicate:

| Upload | Duplicate? |
|---|---|
| The same file picked again | Yes |
| The same resume exported again, at any time | Yes |
| The same words in a new layout or font | Yes. Import Updated Resume replaces the old one instead |
| Any change to the words, even one letter | No |
| The same resume as PDF once and DOCX once | Usually not: the two formats go through different extractors, which can give different text |

**A change to extraction or to the normalization makes old hashes stale.**
After it, an old upload's hash no longer matches a new upload of the same
resume, so a duplicate can get through. It never blocks a real new resume.
Keep `_extract` and the normalization in one place, and note in the
`backend/app/routers/resumes.py` docstring that changing them has this
effect.

### `resume_snapshots` (new table)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `applicant_id` | uuid FK → `applicant_profiles`, `ON DELETE CASCADE` | |
| `content_hash` | string | sha256 of the snapshot's content (below) |
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
- `content_hash` on a snapshot row is its snapshot's hash; on an uploaded
  resume's row it stays `NULL`, which `download_name` already reads as "an
  uploaded file".
- `built_resume_id`, `uploaded_resume_id`, `job_posting_id` and `name` keep
  their meaning. Every new row has a `job_posting_id`: only sends write
  rows now.

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

1. `resumes.text_hash` and its partial unique index.
2. `resume_snapshots` (with RLS), `sent_resumes.snapshot_id`, nullable
   `storage_path`, the `sent_resumes_one_file` CHECK.
3. `job_applications.sent_resume_id`.

Downgrade of 2 deletes the sent resumes that have a snapshot (the old table
cannot hold them) before `storage_path` goes back to NOT NULL.

## The snapshot

### What it holds

Exactly what `render(view, identity, template)` reads, at the moment of
sending:

```json
{
  "v": 1,
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
- No format field: a sent resume is always a PDF. The Word file is only a
  download (flow 3), and downloads keep nothing.

### The hash

`content_hash` is `sent_resumes.content_hash()` as it is today for a PDF:
sha256 of `template`, `identity` and `view`, with sorted keys. Reusing it
means a new snapshot and an old sent PDF of the same content have the same
hash.

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

1. Extract the text (`_extract`). Today this runs after the Storage upload;
   it moves before it, so a duplicate leaves no file behind.
2. Normalize and hash it. Empty text: no hash, skip step 3.
3. A resume of this applicant with the same `text_hash` → **409**, nothing
   written: `{"detail": {"message": "Resume Duplicate found at <name>",
   "resume_id": "<id>"}}`. `<name>` is the existing row's
   `original_filename`, the name the Resumes page shows.
4. Else the cap check as today (`check_room`, 409 at 5).
5. Upload, insert with `text_hash`. A unique-index violation at commit (a
   race) answers the same 409 and removes the uploaded file.

`PUT /applicants/{id}/resumes/{rid}` (Import Updated Resume) does the same
check against every *other* resume of the applicant, then sets the new
`text_hash`. A file with the same text as the row it replaces is allowed:
that is how a student swaps in a new layout. The old file stays while a sent
resume points at it (built today).

Frontend: `apiErrorMessage` (`frontend/src/lib/auth.ts`) reads only a string
`detail`; it learns to read `detail.message`. The upload UI shows the
message, and the Apply picker selects the duplicate.

### 2. Generate

A duplicate is refused. The student sees a pop-up, "Duplicate Resume found:
<name>", and nothing else happens.

`POST /applicants/{id}/built-resumes` (the router, not
`service.generate`):

1. Work out the new resume's choices without writing them: the same
   `all_chosen(bank)` and copy hiding `generate` does today. Split
   `generate` into "plan the choices" and "write them" for this.
2. Build its view (`build_view`) and hash it (`content_hash`). No render, no
   file.
3. Build the view of each of the applicant's built resumes (base and
   tailored) from the same bank, and hash each one, *now*. A built resume's
   hash cannot be stored: an edit in the editor, or in the bank, changes it.
4. A match → **409**, nothing written: `{"detail": {"message": "Duplicate
   Resume found: <name>", "built_resume_id": "<id>"}}`. `<name>` is the
   matching resume's name. The frontend shows the message in a pop-up and
   does nothing else.
5. No match → write the resume and its choices as today.

What the hash covers: the resume's content as it would print (every shown
entry, bullet and skill, in order, with the chosen wording) and the template.
Not the bank as a whole: a bank item that is not on the resume does not
count. The header is the same for every resume of a student, so it never
makes a difference.

When a duplicate happens in practice: a new resume from Generate holds
everything in the bank. An older resume holds only what was in the bank
when it was made, minus what the student hid. So Generate is refused only
when nothing changed since an earlier Generate: the bank gained nothing and
that resume was not edited.

Speed: one hash takes 0.27 ms (measured on the sample resume). The time is
the database reads: the bank once, and the choices of every built resume.
Load all the choices in one query per kind (entries, bullets, skills) rather
than one `load_choices` per resume, so the check is about four queries,
whatever the number of resumes. Generate already loads the bank.

Tailor's own Generate (`routers/tailor.py`, when the student has no base
resume) skips the check: it runs only when there is no other resume to
match. Tailor's Done edits the posting's one tailored resume in place, so it
never makes a duplicate.

### 3. Download (the resume editor)

A download keeps nothing: no sent resume, no snapshot, no file in Storage.

- **PDF:** `GET .../built-resumes/{rid}/render`, which already returns the
  PDF as base64 with `missing_characters`. The frontend makes a Blob URL
  and downloads it under `built_resumes.file_name`.
- **Word:** `GET .../built-resumes/{rid}/docx`, which already returns the
  file as an attachment.
- **The missing-character warning** (user story 53) stays: the render
  answers `missing_characters` before the file is given. Cancel just drops
  the file; there is no sent resume to delete any more.

`useResumeDownload` (`frontend/src/app/(seeker)/resumes/download-menu.tsx`)
stops calling `sendBuiltResume` and `deleteSentResume`. `POST
.../sent-resumes` then requires `job_posting_id` (422 without it), and its
`format` field goes: a send is always a PDF.

A student who sends a downloaded file outside WorkIt (by email, say) has no
record of it until they mark that job applied and pick the resume on "Did
You Apply?" (flow 5), which records it.

### 4. Apply Now (the job posting's page)

The dialog (`jobs/[jobId]/apply-button.tsx`) keeps its steps. What changes:

- **Pick a resume** lists built and uploaded resumes as today, plus
  **Upload a resume**: flow 1, then that resume is picked. At the cap, the
  picker asks which of the 5 to replace (flow 1's PUT). A duplicate selects
  the existing one.
- **Apply** calls `POST .../sent-resumes` with `job_posting_id`, as today:
  - Uploaded: a sent resume with the file's `storage_path` (built today).
  - Built: render once (the student needs the file to attach), get or create
    the snapshot (`INSERT ... ON CONFLICT (applicant_id, content_hash) DO
    NOTHING`, then select), then a sent resume with `snapshot_id`. **No
    upload to Storage.** A repeat for the same posting and snapshot returns
    the last sent resume, as today.
- **Your Resume Is Ready** gives the file from the response (flow 7), not
  only a signed URL. The missing-character warning shows as today.
- **Did You Apply?** → Yes calls `POST /jobs/{id}/applied` with
  `{"sent_resume_id": "<id>"}`.

### 5. Mark applied

`POST /jobs/{job_id}/applied` takes an optional body `{"sent_resume_id"}`.

- The sent resume must be this applicant's and linked to this posting, else
  404.
- Sets `stage = applied` (as today) and `sent_resume_id` in the same upsert.
  A second call with a resume sets the resume but keeps the first
  `applied_at`.
- No body: as today, so the deployed frontend keeps working during the
  rollout.

A student who chose **Apply Without a Resume** sees the picker on the Did
You Apply? step, with "I didn't send a resume" as one choice. Picking a
resume there calls `POST .../sent-resumes` first (flow 4's Apply, without
giving a file), then this route with its id.

### 6. Auto apply

`pipeline.prepare_resume` calls `send_built` / `send_uploaded` as today, and
sets the application's `sent_resume_id` in the same commit: the application
row exists already (`queued` or `needs_you`), and a run that starts again
gets the same sent resume back. A skipped application keeps the link, which
does no harm. Its response carries the file the same way as flow 7. The
extension does not call it yet (the runner is planned,
`auto-apply/architecture.md` §5); base64 bytes suit it better than a URL,
since it must build a `File` for the form anyway.

### 7. Open a sent resume

`GET /applicants/{id}/sent-resumes/{sid}/file` answers one of:

- **A file row** (uploaded, or a PDF kept before this change):
  `{"url": "<5-minute signed URL>", "file_name"}`. Today the link always
  downloads (it is signed with a `download` name); `?download=false` signs
  it without one, so the PDF opens in the browser.
- **A snapshot row:** gunzip, `view_from_json`, render (about 0.3 s), and
  answer `{"data": "<base64>", "content_type": "application/pdf",
  "file_name"}`. Nothing is stored.

The frontend turns `data` into a Blob URL (`URL.createObjectURL`) and opens
or downloads it, the same way the editor's preview already takes base64 from
`GET .../render`. One helper, `openSentResume(sid)`, hides the two shapes.
`POST .../sent-resumes` and auto apply's resume route answer the file in the
same two shapes.

Where the student sees it:

- The job posting's page: "You sent <name> on <date>" becomes a link.
- The Applications list (`(seeker)/applications/list.tsx`) and an
  application's own page (`/applications/[jobId]`): **View Resume** when the
  application has a `sent_resume_id`. Their resume column reads that link
  instead of "the resume last sent to its posting". Fetch the file only on
  click: a snapshot renders on each open.

### 8. Delete

- **A sent resume:** remove the row; then remove its snapshot if no other
  sent resume uses it, or its file if `file_in_use` says nothing does
  (built today for files). No screen deletes one now that downloads keep
  nothing; the route stays.
- **An uploaded resume:** as today: its file stays while a sent resume points
  at it. A replaced or deleted upload whose file a sent resume keeps does not
  count toward the 5.
- **A built resume:** nothing changes for sent resumes; the snapshot is a
  copy and does not need it.
- **An application** (unsave, dequeue): the sent resume stays.
- **The account:** everything cascades from `applicant_profiles`, as today.

## Rows written before this change

Sent resumes kept before this change have a PDF (or a Word file) in Storage
and no snapshot, and some have no job posting (downloads). They stay as they
are and open through flow 7's file branch. We cannot turn a PDF back into a
snapshot. No cleanup and no special handling: they are few and stop growing
once this ships.

## API summary

| Route | Change |
|---|---|
| `POST /applicants/{id}/resumes` | Text hash check: 409 "Resume Duplicate found at <name>" with `resume_id`; stores `text_hash` |
| `PUT /applicants/{id}/resumes/{rid}` | Same check against the other resumes |
| `POST /applicants/{id}/built-resumes` | Live hash check: 409 "Duplicate Resume found: <name>" with `built_resume_id`; writes nothing |
| `POST /applicants/{id}/sent-resumes` | `job_posting_id` required, `format` gone. Built: a snapshot, no Storage. Answers the file as `data` (built) or `url` (uploaded) |
| `GET /applicants/{id}/sent-resumes/{sid}/file` | `{url, file_name}` (with `?download=false` to view) or `{data, content_type, file_name}` |
| `GET .../built-resumes/{rid}/render`, `.../docx` | Unchanged; the editor's Download now uses them |
| `POST /jobs/{job_id}/applied` | Optional `{"sent_resume_id"}` |
| `POST /applicants/{id}/applications/{job_id}/resume` (auto apply) | The file in the same two shapes; sets `sent_resume_id` |
| `GET /applicants/{id}/applications` | Each application adds `sent_resume_id` and the sent resume's `name` |

The extension reads `GET /applicants/{id}/resumes` and `.../{rid}`; both
only gain `text_hash`, which it ignores. Nothing it reads changes shape.

## Build order

Each step is one PR with its migration, code, tests and docs.

1. **Upload duplicates.** Migration 1, extraction before the upload, the
   hash check in POST and PUT, `apiErrorMessage` reading `detail.message`,
   the message on the Resumes page.
2. **Downloads keep nothing.** The editor's Download on `render` and
   `docx`; `useResumeDownload` without `sendBuiltResume`; `POST
   .../sent-resumes` requiring `job_posting_id` and dropping `format`. No
   migration. It ships before step 3 so no new download PDFs pile up.
3. **Snapshots.** Migration 2, `view_from_json`, `send_built` writing
   snapshots, flow 7's two shapes, `openSentResume`, the Apply dialog's
   file, `prepare_resume`'s response.
4. **Application link.** Migration 3, `POST /jobs/{id}/applied` with
   `sent_resume_id`, `prepare_resume` setting it, the Did You Apply?
   picker, Upload in the Apply picker, View Resume on the Applications list,
   an application's page and the job posting's page.
5. **Generate duplicates.** The live hash check on Generate, and its
   "Duplicate Resume found: <name>" pop-up on the Resumes page.

## Docs to update with the code

Each PR updates the rules it changes (root `CLAUDE.md`, Documentation):

- `backend/CLAUDE.md`: "Every download is a sent resume" becomes "only a
  send keeps a sent resume" (step 2); the snapshot and its re-render (3);
  the upload's text hash (1); Generate's duplicate check (5); the
  migrations' deploy order under Deployment (1, 3, 4).
- `frontend/CLAUDE.md`: "A built resume's download goes through
  `sendBuiltResume`" is reversed (2); the tracker's "resume last sent to its
  posting" becomes the application's `sent_resume_id` (4).
- `backend/app/models/CLAUDE.md`, "Sent resumes": the new CHECK, nullable
  `storage_path`, `resume_snapshots`, `job_applications.sent_resume_id`
  (3, 4).
- `docs/resume.md`, "Sent resumes": replaced by a pointer here once step 3
  ships.
- `auto-apply/architecture.md`: `prepare_resume` returns the file and sets
  the link (3, 4).
- `frontend/docs/screens.md`: Applications and the job posting page (4);
  the Resumes page's duplicate messages (1, 5).
- This file: mark each step built as it merges.

## Tests

Behaviour only; no test of a prompt's wording.

- `view_from_json(asdict(view)) == view` for the sample view, with GPA,
  dates, coursework and a variant bullet.
- Two sends of unchanged content to two postings: two sent resumes, one
  snapshot, no Storage upload.
- A changed bullet gives a new snapshot.
- A snapshot row's file renders to a PDF whose text matches the sent view.
- Deleting the last sent resume of a snapshot removes the snapshot; deleting
  one of two keeps it.
- The CHECK refuses a sent resume with both or neither of `storage_path` and
  `snapshot_id`.
- `POST .../sent-resumes` without `job_posting_id`: 422, nothing written.
- Upload of the same file twice: the second answers 409 with "Resume
  Duplicate found at <name>", leaves no file in Storage and no row.
- Upload of the same text in a different file (other line breaks, spacing,
  a ligature): 409. One changed word: uploads.
- An upload with no extractable text: uploads, `text_hash` NULL; a second
  one uploads too.
- The same file from another applicant uploads fine.
- PUT with the text of another resume: 409. With the text of the row it
  replaces, or new text: works.
- Generate twice with no edit between: the second answers 409 with
  "Duplicate Resume found: <name>" and writes no resume. Hide a bullet on
  the first, or add a bank entry, then Generate again: works.
- `POST /jobs/{id}/applied` with another applicant's sent resume, or one for
  another posting: 404. Without a body: applied, `sent_resume_id` NULL.
- `prepare_resume` sets the application's `sent_resume_id`; a second call
  returns the same sent resume.
- A sent resume kept before the change still opens through its URL.

## Decisions

| Question | Decision |
|---|---|
| Built resumes: PDF or snapshot? | Gzipped JSON snapshot, rendered again on view |
| Uploaded resumes | Point at the uploaded file; no parsed copy |
| Upload duplicates | Text hash of `raw_text`, no byte hash; 409 "Resume Duplicate found at <name>" |
| Old uploads | No backfill of `text_hash` |
| Generate duplicates | Refused; pop-up "Duplicate Resume found: <name>", nothing else |
| Plain downloads | Keep nothing; only sends are sent resumes |
| Sent resumes kept before this change | No cleanup, no special handling |
