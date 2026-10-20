# Sent resumes per application (KAN-267)

Status: **design complete; built: the duplicate checks, downloads that keep
nothing, snapshots and the freeze of replaced or deleted uploads** (build
order steps 1, 2, 3, 5 and 6, migrations `d642d93fcfbc` and
`5a6e419367b8`). Not built: the application link (step 4), and with it
every screen that opens a sent resume (View Resume, the rebuilt note, Show
Original Text). It changes how sent resumes (KAN-208)
are kept, links each application to the resume it went out with, stops
recording plain downloads, freezes an upload's sent resumes as JSON once
the upload is replaced or deleted, and stops duplicate resumes at upload
and at Generate. `resume.md`, "Sent resumes", describes what is built today; this
file is the plan that replaces it. Every decision is final unless this file
says otherwise; the decisions are listed at the end.

## Goal

For every application, the student can see which resume they sent, and open
it as a PDF, for as long as the application exists. Storage stays as small as
we can make it.

A student applies with one of two kinds of resume:

| Kind | What we keep | Why |
|---|---|---|
| **Uploaded resume** (their own file, at most 5) | While the upload exists: a pointer to its file (`storage_path`). Once the student replaces or deletes the upload: a parsed copy, gzipped JSON in Postgres, and the file is deleted (flow 9) | While the upload exists its file must stay anyway, so pointing at it costs nothing and is exact. After that, the file would stay only for the record |
| **Built resume** (generated or tailored by WorkIt) | A frozen copy of its content: gzipped JSON in Postgres, rendered to a PDF again when the student opens it | We made it, so we can make it again; about 2 KB, not a 33 KB PDF |

A built resume's copy is exact. An upload's parsed copy is not: it keeps
most of the words but loses the layout and any section the parser does not
know (below, "What a parsed copy keeps"). The page says so when it shows
one.

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
- **Parse every uploaded resume into JSON at send time.** While the upload
  exists, its file is stored anyway, so a parsed copy saves nothing and
  only loses formatting. A parsed copy replaces the file only once the
  upload is gone (flow 9).
- **Freeze an upload's sent resume one month after the job posting
  closes.** It frees no storage: while the upload exists its file must
  stay, and once it is replaced or deleted flow 9 has already frozen it.
  It would only swap an exact record for an approximate one.
- **Store built resumes themselves as JSON.** A built resume is live: its
  choice rows point at the experience bank, so a bank fix shows on every
  resume (ADR 0001). Only the *sent* copy is frozen. Size is not a reason
  either way: a built resume's choice rows and a snapshot are both a few KB.
- **Keep recording downloads.** They date from before Apply Now, when a
  download was the only way a resume left WorkIt. Now every application
  records its own resume, so a download record is only noise in the list.

### What a parsed copy keeps

Measured on the seven real resumes in `backend/tests/fixtures/`, counting
the content words that reach `bank_import.read`'s result (dates and
section headings left out, since the parser turns them into fields):

| Layout | Words kept | Lost |
|---|---|---|
| 5 single-column layouts | 98–100% | "Minor in Writing", a second major |
| Two-column layout | 85% | The whole "Career Objective" paragraph, part of one job |

These are the parser's own test files, tuned until they pass, so an unseen
layout does worse. Always lost: any section it does not read (summary,
objective, publications, volunteer work, languages, interests), the header
(the copy prints the profile's), and the layout (it prints in Jake's
template). A scan with no text reads as nothing; flow 9 then keeps the file.

## Data model

```
applicant_profiles
  ├── resumes            + text_hash (sha256 of the resume's text)
  ├── resume_snapshots   NEW: one per distinct content, from a built resume
  │     or a replaced or deleted upload (`source`)
  │     content_hash, source, data (gzipped JSON)  UNIQUE (applicant_id, content_hash)
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
| `source` | string | `built` (exact) or `upload` (parsed, approximate); CHECK on the two values. A column, not only a JSON field, so the list can say which without unzipping |
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
- **A row changes once, at most**: flow 9 swaps an upload's `storage_path`
  for a `snapshot_id`. "A sent resume never changes" becomes "its content
  never changes"; the freeze changes where it is kept.

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
2. `resume_snapshots` (with RLS and the `source` CHECK),
   `sent_resumes.snapshot_id`, nullable `storage_path`, the
   `sent_resumes_one_file` CHECK.
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

### An upload's snapshot

Made by flow 9 from the upload's `raw_text`, just before its file is
replaced or deleted:

```json
{
  "v": 1,
  "source": "upload",
  "template": "jakes",
  "identity": { "name": "...", "email": "...", "phone": "...", "links": [] },
  "view": { "sections": [...], "skills": [...] },
  "raw_text": "..."
}
```

- `view` comes from `bank_import.read(raw_text)`, the reading upload
  already does, turned into a `ResumeView` by a new
  `resume_view.view_from_reading(entries, skills)`: sections in `SECTIONS`
  order, entries and bullets in the file's order, every bullet shown. Ids
  are made from each item's position, so the same text always gives the
  same view and the same hash.
- `identity` is the profile's at the moment of the freeze: the parser does
  not read the file's header.
- `raw_text` is kept too (about 1–2 KB gzipped), so the student can read
  every word of the file even where the parse lost one.
- `content_hash` is sha256 of the whole JSON above, sorted keys. Two sent
  resumes of one file get one snapshot.

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
   written: `{"detail": {"message": "Duplicate Resume found: <name>",
   "resume_id": "<id>"}}`. `<name>` is the existing row's
   `original_filename`, the name the Resumes page shows.
4. Else the cap check as today (`check_room`, 409 at 5).
5. Upload, insert with `text_hash`. A unique-index violation at commit (a
   race) answers the same 409 and removes the uploaded file.

`PUT /applicants/{id}/resumes/{rid}` (Import Updated Resume) does the same
check against every *other* resume of the applicant, then sets the new
`text_hash`. A file with the same text as the row it replaces is allowed:
that is how a student swaps in a new layout. Before the row takes the new
file, flow 9 freezes the sent resumes of the old one, and the old file is
deleted once nothing uses it.

Frontend: `apiErrorMessage` (`frontend/src/lib/auth.ts`) reads only a string
`detail`; it learns to read `detail.message`. On the Resumes page a
duplicate upload or Import Updated Resume opens Generate's pop-up
("Duplicate Resume found: <name>", OK); intake shows it as its error line,
and onboarding goes on, since the file is already there. The Apply picker
(not built) selects the duplicate.

### 2. Generate

A duplicate is refused. The student sees a pop-up, "Duplicate Resume found:
<name>", and nothing else happens.

`POST /applicants/{id}/built-resumes` (the router, not
`service.generate`):

1. Work out the new resume's choices without writing them: the same
   `all_chosen(bank)` and copy hiding `generate` does today. Split
   `generate` into "plan the choices" and "write them" for this.
2. Build its view (`build_view`). No render, no file.
3. Build the view of each of the applicant's built resumes (base and
   tailored) from the same bank, *now*, and compare it with the new one
   (`built_resumes.same_resume`). Built: the views are compared as they
   are, which says what equal hashes would without hashing. Nothing can be
   stored to compare against: an edit in the editor, or in the bank,
   changes a resume's content.
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

Speed: hashing one view takes 0.27 ms (measured on the sample resume), and
comparing two is cheaper. The time is the database reads: the student's
built resumes, then all their choices in one query per kind (entries,
bullets, skills; `_choices_of`), so the check is four queries whatever the
number of resumes. Generate already loads the bank.

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

The dialog (`jobs/apply-button.tsx`; every Apply Now opens it since KAN-290) keeps its steps. What changes:

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
- **Your Resume Is Ready** downloads nothing (decided with step 3): resume
  files come from Resumes & Experiences only. Its **Open in Resumes** link
  opens a built resume's editor (its Download), or the Resumes view for an
  upload, in a new tab. The missing-character warning shows as today.
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

Built, ahead of step 4 (the picker only): "Did You Apply?" lists the
resumes under "Resume You Sent", plus No Resume, starting on the one sent
at Apply (No Resume after Apply Without a Resume), and the student can
change it. Yes keeps a resume other than the one sent as a sent resume for
the posting (`applyWithResume`), then marks the job applied as before.
Step 4 adds the `sent_resume_id` the route takes; until then the job
posting's "You sent <name>" (its last sent resume) is the only record of
which one, and No Resume after a send changes nothing.

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
  "file_name", "rebuilt", "original_text"}`. Nothing is stored. `rebuilt`
  is true for an upload's snapshot, and `original_text` is then its file's
  text: the page (step 4) says "Rebuilt from your uploaded file. The
  layout and some sections may differ from what you sent." with a **Show
  Original Text** link that shows it.

Built (step 3): `rebuilt` is read off the row, not the snapshot (a
snapshot row with no content hash: an uploaded resume's row never has
one), so the list needs no join; the `source` column is the database's
own record. A send that just rendered its PDF answers that PDF; a repeat
send renders the snapshot again, so every send answers the file.

No screen downloads a sent resume's file yet: the Apply dialog links to
Resumes & Experiences instead (flow 4). `openSentResume(sid)`, the server
action for GET .../file, comes with step 4's View Resume, which opens a
sent resume to look at. `POST .../sent-resumes` and auto apply's resume
route answer the file in the same two shapes; auto apply uses it.

Where the student sees it:

- The job posting's page: "You sent <name> on <date>" becomes a link.
- The Applications list (`(seeker)/applications/list.tsx`) and an
  application's own page (`/applications/[jobId]`): **View Resume** when the
  application has a `sent_resume_id`. Their resume column reads that link
  instead of "the resume last sent to its posting". Fetch the file only on
  click: a snapshot renders on each open.

Built ahead of step 4 (`applications/view-resume.tsx`): View Resume on the
list, the grid cards and What You Sent, for the posting's last sent resume
(no `sent_resume_id` yet). It opens a dialog with the PDF in a frame (GET
.../file?download=false; a snapshot's PDF is kept for the next open, a
stored file's link asked for again), the rebuilt note with Show Original
Text, and for a Word file a pointer to Resumes & Experiences. Step 4 only
swaps which sent resume each application names.

### 8. Delete

- **A sent resume:** remove the row; then remove its snapshot if no other
  sent resume uses it, or its file if `file_in_use` says nothing does
  (built today for files). No screen deletes one now that downloads keep
  nothing; the route stays.
- **An uploaded resume:** flow 9 freezes its sent resumes, then the row and
  its file go. When the freeze keeps the file (no text, or nothing read),
  the file stays as today while a sent resume points at it, and it does not
  count toward the 5.
- **A built resume:** nothing changes for sent resumes; the snapshot is a
  copy and does not need it.
- **An application** (unsave, dequeue): the sent resume stays.
- **The account:** everything cascades from `applicant_profiles`, as today.

### 9. Freeze an upload's sent resumes

When an upload is replaced (flow 1's PUT) or deleted, its file would stay
only for the sent resumes that point at it. They become snapshots instead,
and the file goes. New `sent_resumes.freeze_upload(session, applicant_id,
resume)`, called by both routes **before** the row loses its file:

1. Find the sent resumes whose `storage_path` is the row's current file.
   None → nothing to do.
2. Read `resume.raw_text` (it is the current file's text) with
   `bank_import.read`. Empty text, or a reading with no entries and no
   skills → **keep the file**: there is nothing to rebuild from, and the
   file stays as today while a sent resume uses it.
3. Build the upload's snapshot (above) and get or create it, as Apply does.
4. Set each of those sent resumes' `snapshot_id`, and `storage_path` NULL,
   in one UPDATE.
5. Flush. The route commits it with the replace or the delete, so the
   freeze and the file change happen together or not at all.
6. After the commit, the routes' existing `file_in_use` check removes the
   file, since no row points at it any more. A failed removal orphans a
   file, as today, but loses no record.

Nothing is rendered and nothing is downloaded: the text is already on the
row. Only uploads replaced or deleted after this ships are frozen. A sent
resume that points at an older replaced file (no row holds its text) stays
a file.

## Rows written before this change

Sent resumes kept before this change have a PDF (or a Word file) in Storage
and no snapshot, and some have no job posting (downloads). They stay as they
are and open through flow 7's file branch. We cannot turn a PDF back into a
snapshot. No cleanup and no special handling: they are few and stop growing
once this ships.

## API summary

| Route | Change |
|---|---|
| `POST /applicants/{id}/resumes` | Text hash check: 409 "Duplicate Resume found: <name>" with `resume_id`; stores `text_hash` |
| `PUT /applicants/{id}/resumes/{rid}` | Same check against the other resumes |
| `POST /applicants/{id}/built-resumes` | Live hash check: 409 "Duplicate Resume found: <name>" with `built_resume_id`; writes nothing |
| `POST /applicants/{id}/sent-resumes` | `job_posting_id` required, `format` gone. Built: a snapshot, no Storage. Answers the file as `data` (built) or `url` (uploaded) |
| `GET /applicants/{id}/sent-resumes/{sid}/file` | `{url, file_name}` (with `?download=false` to view) or `{data, content_type, file_name, rebuilt}` |
| `GET /applicants/{id}/sent-resumes` | Each sent resume adds `rebuilt` (true for an upload's snapshot) |
| `PUT /applicants/{id}/resumes/{rid}`, `DELETE .../{rid}` | Freeze the old file's sent resumes first (flow 9); the file goes once nothing uses it |
| `GET .../built-resumes/{rid}/render`, `.../docx` | Unchanged; the editor's Download now uses them |
| `POST /jobs/{job_id}/applied` | Optional `{"sent_resume_id"}` |
| `POST /applicants/{id}/applications/{job_id}/resume` (auto apply) | The file in the same two shapes; sets `sent_resume_id` |
| `GET /applicants/{id}/applications` | Each application adds `sent_resume_id` and the sent resume's `name` |

The extension reads `GET /applicants/{id}/resumes` and `.../{rid}`.
Neither changes: `text_hash` stays in the database and no response sends it.

## Build order

Each step is one PR with its migration, code, tests and docs.

1. **Upload duplicates.** Migration 1, extraction before the upload, the
   hash check in POST and PUT, `apiErrorMessage` reading `detail.message`,
   the message on the Resumes page.
2. **Downloads keep nothing.** The editor's Download on `render` and
   `docx`; `useResumeDownload` without `sendBuiltResume`; `POST
   .../sent-resumes` requiring `job_posting_id` and dropping `format`. No
   migration. It ships before step 3 so no new download PDFs pile up.
3. **Snapshots.** Built: migration 2 (`5a6e419367b8`), `view_from_json`,
   `send_built` writing snapshots (it no longer takes Storage), flow 7's
   two shapes, the Apply dialog's file, `prepare_resume`'s response.
   `openSentResume` moved to step 4.
4. **Application link.** Migration 3, `POST /jobs/{id}/applied` with
   `sent_resume_id`, `prepare_resume` setting it, Upload in the Apply
   picker, and the job posting page's "You sent" as a link. Built ahead of
   it: the Did You Apply? picker and View Resume on the Applications list,
   its cards and an application's page, both on the posting's last sent
   resume.
5. **Generate duplicates.** The live hash check on Generate, and its
   "Duplicate Resume found: <name>" pop-up on the Resumes page.
6. **Freeze replaced uploads.** Built with step 3: `view_from_reading`,
   `freeze_upload` in PUT (before the new file is uploaded, so a failed
   freeze stores nothing) and DELETE, `rebuilt` and `original_text` in the
   responses. The "Rebuilt from your uploaded file" note and Show Original
   Text come with step 4's View Resume.

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
  (3, 4); "a row never changes" becomes "its content never changes", with
  the freeze as the one change (6).
- `backend/CLAUDE.md`: Import Updated Resume and the delete freeze before
  the file goes (6).
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
- Upload of the same file twice: the second answers 409 with "Duplicate
  Resume found: <name>", leaves no file in Storage and no row.
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
- Replace an upload that two sent resumes point at: both get one `upload`
  snapshot, `storage_path` NULL, and the old file is removed after the
  commit. Delete the upload instead: the same.
- The frozen copy holds the parsed entries, the profile's header and the
  file's `raw_text`; its file answers a PDF with `rebuilt` true.
- An upload with no text, or one the parser reads nothing from: replace or
  delete keeps its file, and the sent resume still opens through its URL.
- A failed commit of the replace or the delete leaves the sent resumes on
  the file and the file in place.
- Replace an upload no sent resume uses: no snapshot, the old file goes as
  today.

## Decisions

| Question | Decision |
|---|---|
| Built resumes: PDF or snapshot? | Gzipped JSON snapshot, rendered again on view |
| Uploaded resumes | Point at the uploaded file while the upload exists; when it is replaced or deleted, freeze its sent resumes as a parsed JSON copy (with its text) and delete the file. No text or nothing read: keep the file |
| Freeze one month after the job posting closes | No: it frees no storage (the file stays while the upload exists) |
| Upload duplicates | Text hash of `raw_text`, no byte hash; 409 "Duplicate Resume found: <name>" |
| Old uploads | No backfill of `text_hash` |
| Generate duplicates | Refused; pop-up "Duplicate Resume found: <name>", nothing else |
| Plain downloads | Keep nothing; only sends are sent resumes |
| Where a student downloads a resume file | Resumes & Experiences only; the Apply dialog links there and downloads nothing |
| Sent resumes kept before this change | No cleanup, no special handling |
