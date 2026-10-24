# The experience bank by resume (KAN-343)

Status: **built 2026-10-23** (ADR 0005). Each uploaded resume owns its own
entries and skills; nothing is shared or merged across uploads. Apply
migration `b5e1c3a7d920` before the deploy and `c8f2a4e6b913` after it
(`backend/CLAUDE.md`, Deployment). The first design merged every upload
into one bank and recorded each entry's uploads in link tables
(`bank_entry_sources`, `bank_skill_sources`, migration `7c2e9a4b1f63`);
"What changes from the first design" below lists what went.

**Scope: the experience bank only.** Import, the bank's API and the
Experiences view change. Generate, Tailor's ranking, the recommender,
Scout, intake and the autofiller still read every entry in the bank, as
today. The same job on two uploads is two rows, and those readers see both;
that is accepted.

## Goal

A student with three uploads and two built resumes should see one resume's
facts at a time. The Experiences view's **resume dropdown** lists every
uploaded, base and tailored resume and shows only what the picked one
holds. Each upload's entries are its own, so an edit on one upload's view
never changes another's, and an import runs no duplicate check.

## The rule

- **An upload owns what its reading found.** Every entry and skill an
  import writes carries the upload's id (`resume_id`). An import never
  looks for the same entry under another resume and never merges.
- **Two uploads that list the same job hold two entries.** Each is edited
  on its own.
- **An entry or skill no upload owns** (`resume_id` null) was made by
  intake, by Tailor's "Have you used X?", by Add under a built resume, or
  before this change. The Experiences view shows it under the built
  resumes that show it (below, "Unowned entries").
- **Built resumes still point at entries** through their choice rows
  (`built_resume_entries`, `built_resume_skills`, KAN-207). A built resume
  holds what it shows, owns nothing and copies nothing (ADR 0001).
- **Sent resumes are not listed**: a sent resume is a frozen record
  (`sent_resume.md`), not a view of the bank.

| Kind | A resume holds an entry or skill when… | Stored where |
|---|---|---|
| **Uploaded resume** | the entry or skill carries its id | **new:** `bank_entries.resume_id`, `bank_skills.resume_id` |
| **Built resume** (base or tailored) | a choice row shows it | already there: `built_resume_entries`, `built_resume_skills` |

## Schema

| Table | Change |
|---|---|
| `bank_entries` | add `resume_id uuid NULL`, FK `resumes.id` **ON DELETE CASCADE**, index `(applicant_id, resume_id)` |
| `bank_skills` | add `resume_id uuid NULL`, same FK and index |
| `bank_skills` | the unique index `bank_skills_applicant_name_key` becomes `(applicant_id, resume_id, lower(name)) NULLS NOT DISTINCT`: one "Python" per upload, and one among the unowned skills (Postgres 15+; Supabase runs 15) |
| `bank_entry_sources`, `bank_skill_sources` | dropped |

- **One column, not a link table.** The first design needed a link table
  because a merged entry came from several uploads. With no merge, an
  entry has at most one upload.
- **Cascade on the upload's delete:** deleting an upload deletes its
  entries, their bullets and its skills, and so drops them from every
  built resume that showed them.
- **No new table, so no new RLS.** Both tables already have RLS on with no
  policies.
- **Existing data:** the migration sets an entry's or skill's `resume_id`
  when it has exactly one source row. An item with two or more sources, or
  none, stays unowned. Plain SQL; a migration must not run the parser.
- **Order:** the columns are nullable, so migration 1 is safe on the
  running code; apply it before the deploy. Dropping the link tables
  breaks the running code (`load_holdings` reads them on every
  `GET /bank`), so migration 2 goes on only after the deploy, as
  `9e4b2d7a5c18` did for skill links (`backend/CLAUDE.md`, Deployment).

## Writes

| Action | Route | What it does to the bank |
|---|---|---|
| **Upload** | `POST /applicants/{id}/resumes` | Inserts every entry and skill the reading found, owned by the new row. Flush the `Resume` row first (the entries point at it). |
| **Import Updated Resume** | `PUT /applicants/{id}/resumes/{resume_id}` | **Replaces** the upload's entries and skills: delete what it owns, insert the new reading. No warning. |
| **Import Again / Read It With AI** | `POST /applicants/{id}/bank/import` | **Replaces**, as Import Updated Resume does. |
| **Delete an upload** | `DELETE /applicants/{id}/resumes/{resume_id}` | Deletes its entries and skills (cascade). The confirm is unchanged. |
| **Add an entry or skill** | the bank's create routes | Under an upload pick: owned by that upload. Under a built resume pick: unowned, and shown on that built resume (a shown choice row at the end of its section), so it stays in view. |
| **Intake, Tailor's "Have you used X?"** | their own routes | Unowned, as today. |

- **A replace deletes the student's edits** to that upload's entries, and
  drops those entries from any built resume that showed them. Accepted:
  the student asked for the file to be read again.
- **The duplicate warning on Add** (`DuplicateEntryError`, "Save as new")
  checks only the same owner's entries: the picked upload's, or the
  unowned ones under a built pick.
- **Every write still goes through `services/bank.py`** and clears the
  bank embedding.
- **Tailor's upload source must stop re-importing.** Today
  `tailor.upload_source` calls `merge_import` on every run and Done. Under
  a replace, each Tailor run would delete and rewrite the upload's
  entries, and the tailored resume's choice rows with them. It reads the
  entries the upload owns instead (no `find_duplicate`). This is the one
  change outside the bank, and only to keep Tailor working.

## The API

`GET /applicants/{id}/bank` keeps its shape: `resume_ids` on each entry and
skill, and `resumes` for the dropdown (kind, name, posting, primary,
created_at).

- **`resume_ids`** is the owning upload (at most one), then the built
  resumes that show the item. `load_holdings` reads the owner from the
  column and the built resumes from their choice rows; the two link-table
  queries go.
- **Filtering stays in the browser** (`holdings.ts`): an upload pick shows
  the items it owns; a built pick shows what it shows.

## The Experiences view

- **The dropdown lists the resumes**, grouped Uploaded and Built, **then
  Not From an Upload** while anything no upload owns exists. **All
  Experiences is removed.** The options carry no counts.
- **The page opens on the primary resume**, else the newest of any kind.
  A `?resume=` that names no listed resume (a deleted one, or the old
  `all`) opens the same way; `none` opens Not From an Upload. With no resume at all, there is no
  dropdown and the page shows the whole bank.
- **Unowned entries** show under Not From an Upload, and under any built
  resume that shows them.
  - **Intake's entries**, a Tailor "Have you used X?" skill with no Done,
    and the multi-source entries the migration left unowned land there.
    Removing that pick (2026-10-23) left them under no pick: on
    2026-10-24 the shared database held 96 such entries and 242 skills
    for 8 students, which every reader still used and no student could
    see, edit or delete. The pick came back for that.
- **Add** saves into the picked resume (above, "Writes"), or into no
  upload under Not From an Upload, and stays in view, so the "Saved to your bank. It's under All Experiences…" notice
  goes.
- **"Also used in" names built resumes only.** An upload's entry is never
  on another upload, but a built resume may show it, and an edit changes
  it there too.
- **The old-upload prompt** ("This resume has no entries in your bank
  yet. [Import Again]") shows for an upload that owns nothing. Import
  Again writes that upload's own entries.
- **Delete Entry** deletes that one row. Its confirm still counts the
  built resumes that show it.
- **Clear All** (KAN-352) deletes every row a card shows, as Delete Entry
  does each one. Under a built resume's pick those rows belong to uploads,
  so the confirm names the uploads that lose them too.
- **Scout's walk** (intake marking an entry) switched to All Experiences
  when the pick hid the entry. With that option gone, it switches to a
  resume that holds the entry, else to Not From an Upload.

## What changes from the first design

| Goes | Why |
|---|---|
| `merge_import`'s merge (`find_duplicate`, `_merge_entry`) | an upload never merges |
| `bank_entry_sources`, `bank_skill_sources`, `_add_sources`, `clear_sources` | the owner column replaces them |
| Import Again "only adds" | it replaces the upload's entries |
| All Experiences | the view shows one resume at a time; Not From an Upload stays for what no upload owns |
| ADR 0003's merge rule and "delete leaves the bank" | ADR 0005 |

Stays: Generate, Tailor's ranking, Scout, the recommender, intake and the
autofiller read the whole bank as today (`copy_key` stays in Generate and
intake); upload reads with the parser only; Read It With AI on a click; one
transaction for the row and the bank writes; the 5-upload limit. The import
summary (`lib/import-summary.ts`) loses "filled in", since nothing merges.

## Considered options

- **Keep the merge** (the first design). Rejected on 2026-10-23: one
  entry shared by several uploads made each upload's view hard to reason
  about, and an edit on one view changed the others.
- **Give Generate and the readers one source** so copies do not count
  twice. Rejected: out of scope. Copies are accepted in every reader.
- **Warn before a replace.** Rejected: the student clicked to have the
  file read again.

## Build order (done)

1. **Migration 1**: add the two `resume_id` columns, fill them from
   single-source links, swap the skill index. Check offline with `--sql`;
   the user applies it before the deploy.
2. **`services/bank.py`**: an import inserts owned rows with no duplicate
   check; `replace_upload(resume_id)` deletes the upload's rows first;
   `create_entry` and `add_skill` take an owner, and Add's duplicate check
   scopes to it; `load_holdings` reads the column.
3. **Routes**: upload, Import Updated Resume and Import Again (replace);
   the bank's create routes take the pick (an upload owns, a built resume
   gets a shown choice row); Tailor's `upload_source` reads owned entries.
4. **Tests** against real Postgres: an upload owns what it read; a second
   upload of the same job makes a second entry; a replace drops and
   rewrites only that upload's rows; deleting an upload deletes its rows;
   Add under an upload owns the entry, under a built resume shows it
   there; the skill index allows one name per upload; a Tailor run on an
   upload leaves its entries as they were.
5. **Frontend**: drop All Experiences from `holdings.ts` and
   `resume-picker.tsx` (Not From an Upload was dropped too, then brought
   back on 2026-10-24); Add sends the pick; "Also used
   in" from built resumes; the Scout switch; the import summary.
6. **Migration 2**, after the deploy: drop the link tables.
7. **Docs**: `backend/CLAUDE.md` and `frontend/CLAUDE.md` lose the merge
   and link-table rules; `GLOSSARY.md`'s **Import** loses "merging"; ADR
   0005's status and this file's become built.
