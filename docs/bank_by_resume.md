# The experience bank by resume (KAN-343)

Status: **built** (migration `7c2e9a4b1f63`; apply it before the deploy).
Not built: the open questions at the end. Every decision here is final
unless this file says otherwise.

## Goal

Today every upload merges its entries and skills into the one experience
bank (ADR 0003), and the Experiences view shows the whole bank. A student
with three uploads and two built resumes sees every fact mixed together
and cannot tell which resume holds an entry.

After this change, the bank still holds every fact once per student
(`applicant_id`). The Experiences view gets a **resume dropdown that lists
every resume the student has**: uploaded, base and tailored. It opens on
the student's primary resume and shows only the entries and skills that
resume holds; the student can pick another resume, or All Experiences to
see the whole bank as today. An entry that more than one resume holds says
so ("Also used in Resume #2"), because an edit to it changes it on every
resume.

This is a change to **what the page shows**, not to what the bank is.
Generate, Tailor, the recommender, Scout, intake and the autofiller still
read the whole bank (ADR 0001, KAN-212). Nothing is copied per resume.

## What "a resume holds" means

The two kinds of resume already differ in how they relate to the bank, so
each gets its own rule:

| Kind | A resume holds an entry or skill when… | Stored where |
|---|---|---|
| **Uploaded resume** | its import found it (the parser's or the model's reading of the file) | **new:** `bank_entry_sources`, `bank_skill_sources` |
| **Built resume** (base or tailored) | the resume shows it: a choice row with `shown` true | **already there:** `built_resume_entries`, `built_resume_skills` (KAN-207) |

- **A built resume needs no new table.** Its choice rows already say which
  entries and skills it shows. An item in the editor's tray (no choice row,
  or `shown` false) is not on the resume, so it is not in that resume's
  view either. Built resumes work on the day this ships, with no backfill.
- **An uploaded resume needs the new tables**, because today nothing
  records which entries an import found: the merge writes into the bank
  and forgets the file (below).
- **An entry or skill no uploaded resume holds** was made by the student:
  by hand on the Experiences view, by intake, or by Tailor's "Have you used
  X?". The dropdown's **Not From an Upload** option shows these, so an
  entry is never out of reach (it may still be on a built resume).
- **Sent resumes are not listed.** A sent resume is a frozen record of what
  an employer got (`sent_resume.md`), not a view of the bank, and its
  entries may no longer exist.

## The source tables (uploaded resumes)

### Why a link table, not a `resume_id` column

The first idea was a `resume_id` column on `bank_entries` and
`bank_skills`. It cannot hold the truth, because **import merges, never
copies** (ADR 0003): when resume B holds "Software Intern, Acme" and the
bank already has it from resume A, B's reading merges into A's entry. That
one entry now comes from two uploads. One column would keep A and lose B,
so B's view would miss an entry B plainly holds.

So the source is a many-to-many link table. Each row
is one pair: "this entry (or skill) was found in this upload". The rows
hold no text; the words stay on the entry or skill.

```
resumes ──o{ bank_entry_sources }o── bank_entries
resumes ──o{ bank_skill_sources }o── bank_skills
```

Example: `resume-A.pdf` has "Software Intern, Acme" and Python; then
`resume-B.pdf` has the same job and Java. The bank holds one entry, e1:

```
bank_entry_sources        bank_skill_sources
entry_id  resume_id       skill_id  resume_id
e1        A               s1 (Python)  A
e1        B               s2 (Java)    B
```

### Schema

One migration, two tables of the same shape.

| Table | Columns | Keys |
|---|---|---|
| `bank_entry_sources` | `entry_id`, `resume_id`, `created_at`, `updated_at` | PK `(entry_id, resume_id)`; index on `resume_id` |
| `bank_skill_sources` | `skill_id`, `resume_id`, `created_at`, `updated_at` | PK `(skill_id, resume_id)`; index on `resume_id` |

- **Foreign keys cascade from both sides.** Deleting an entry or skill
  deletes its source rows. Deleting an uploaded resume deletes its source
  rows and **leaves the entries in the bank**, as ADR 0003 requires: built
  resumes point at them, and the student may have edited them.
- **The PK leads with the bank side**, so "the sources of these entries"
  (the bank read) uses it; the `resume_id` index serves the cascade from
  `resumes` and "the entries of this upload".
- **No applicant column**, so the table cannot
  check that both sides share an owner. `services/bank.py` writes the rows
  only from an import, where the resume and the entry are both already
  scoped to the applicant. A source row written any other way can join two
  students' rows.
- **RLS on, no policies** (root `CLAUDE.md`, Auth).
- **The bank embedding does not change.** A source row is not an entry,
  bullet or skill change, and the embedding text never names a resume, so
  writing one does not call `clear_embedding`.
- Models go in `backend/app/models/bank.py` (`Bank_Entry_Source`,
  `Bank_Skill_Source`). No `relationship()`
  (`models/CLAUDE.md`, "Insert order is not foreign-key order").
- Adding two tables is safe on the running code. **Apply the migration
  before the deploy that writes them**, or every upload answers 500.

### Who writes a source row

Only an import. `merge_import` in `services/bank.py` takes a new required
argument, `resume_id`, and records a source for **every entry and skill
the reading found**, whether the merge added it, filled it or changed
nothing:

```python
async def merge_import(session, applicant_id, resume_id, entries, skills) -> Merged:
    for draft in entries:
        existing = await find_duplicate(...)
        if existing is None:
            entry = await create_entry(...)          # added
        else:
            await _merge_entry(...)                   # filled, or nothing new
            entry = existing
        await _add_source(session, Bank_Entry_Source, entry.id, resume_id)
    # skills: the same; a skill the bank already has still gets the link
```

`_add_source` is an `INSERT ... ON CONFLICT DO NOTHING`, so a second
import of the same resume adds nothing. The "nothing new" case matters:
today a merge that finds nothing new writes nothing at all, so without the
link the second upload's view would miss every entry the first upload
already brought in.

The three callers pass the resume they read:

| Caller | Route | Source rule |
|---|---|---|
| Upload | `POST /applicants/{id}/resumes` | Add sources for the new row. **Flush the `Resume` row before `merge_import`**: the source rows point at it, and the unit of work does not order inserts by foreign key (`models/CLAUDE.md`). |
| Import Updated Resume | `PUT /applicants/{id}/resumes/{resume_id}` | **Replace** that resume's sources: delete its `bank_entry_sources` and `bank_skill_sources` rows, then merge. The file changed, so an entry the new version dropped must leave this resume's view. The entry itself stays in the bank. |
| Import Again, Read It With AI | `POST /applicants/{id}/bank/import` | **Add** sources. The file did not change; a second reading only finds more. A model reading that finds less does not hide what the parser found. |

What a student edits later does not move a source. When the student edits
an entry's title, the entry keeps its sources: it is still the fact that
upload holds, now worded better. When the student deletes an entry, its
sources go with it (cascade), and the next Import Again of that upload can
bring the entry back, as today.

A source is never written by hand on the Experiences view, by intake or by
Tailor. "Link this entry to an upload" is not part of this change (open
question 1).

## The API

`GET /applicants/{id}/bank` (`bank_response`) gains one field on each entry
and each skill, plus the list the dropdown needs:

```jsonc
{
  "entries": [{ "id": "e1", "title": "Software Intern", …, "resume_ids": ["u1", "b1"] }],
  "skills":  [{ "id": "s1", "name": "Python", …, "resume_ids": ["u1"] }],
  "resumes": [
    { "id": "u1", "kind": "uploaded", "name": "resume.pdf",       "primary": false,
      "created_at": "2026-10-20T14:03:00Z" },
    { "id": "b1", "kind": "base",     "name": "Resume #2",        "primary": true  },
    { "id": "t1", "kind": "tailored", "name": "Resume #3",
      "posting": "Backend Intern at Initech",                     "primary": false }
  ]
}
```

- **`resume_ids`** is every resume that holds the item, both kinds:
  uploads from the source tables, built resumes from their choice rows
  with `shown` true. Uploaded and built resume ids are both UUIDs, so one
  list holds them without a clash; `resumes` says which kind each is.
- **`resumes`** lists every uploaded, base and tailored resume, with the
  name the Resumes page shows (`original_filename` for an upload,
  `built_resumes.name` for a built one) and, for a tailored one, its job
  posting's title and company. Order: uploads, then base resumes, then
  tailored resumes, each newest first. The page needs it for the dropdown
  and the "Also used in" line, and one response keeps the page to one
  fetch.
- **`primary`** is true for the one resume the student starred:
  `applicant_profiles.default_resume_id` (an upload) or
  `default_built_resume_id` (a built resume). At most one is set
  (`applicant_profiles_one_default_resume`), so at most one is true.
- **`created_at`** is when the upload or built resume was made: with no
  starred resume, the page opens on the newest.
- **`load_holdings` reads them with four small queries**, called by
  `GET /bank` only, so Generate, Tailor and Scout's `load_bank` pay
  nothing for them: the source
  tables keyed on the ids it already loaded (`WHERE entry_id IN (...)`),
  and the shown `built_resume_entries` and `built_resume_skills` rows of
  the applicant's built resumes (one join to `built_resumes` on
  `applicant_id` each).
- **Filtering happens in the browser.** A bank is small (tens of entries),
  and the whole bank is already sent. A `?resume_id=` filter on the server
  would make every pick a round trip and a second shape of the bank to keep
  right.
- Scout's facts (`workit_scout.facts`) read this shape. Its models ignore
  fields they do not declare, so the new fields reach no model and no
  prompt. A test checks that `bank_facts` reads a response with them.
- `frontend/src/lib/bank-actions.ts` mirrors the schema: `resume_ids` on
  `BankEntry` and `Skill`, `resumes` on `Bank`.

## The Experiences view

A **resume dropdown** sits under the Resumes & Experiences header, above
the first section card. It lists every resume, grouped by kind:

```
Show  [ ★ Resume #2  ▾ ]
        All Experiences
        ── Uploaded ──
        resume.pdf
        resume-v2.pdf
        ── Built ──
        ★ Resume #2
        Resume #3 · Backend Intern at Initech
        ──
        Not From an Upload
```

- **The options:** All Experiences; the uploads; the built resumes (base,
  then tailored, a tailored one labelled with its posting as on the
  Resumes page); then Not From an Upload when at least one entry or skill
  no upload holds. The primary resume is starred, as on the Resumes page.
  A group with no resume is left out. The options carry no counts: a
  count summed entries and skills, which students read as a number of
  experiences (removed 2026-10-23).
- **The page opens on the primary resume**, whichever kind it is. With no
  primary (none starred), it opens on the newest resume of any kind. With
  no resume at all, there is no dropdown and the page shows the whole
  bank, as today.
- **Items no resume holds are hidden on arrival.** Not From an Upload
  appears in the dropdown only when such items exist, so the student finds
  them in one pick.
- **A resume shows** the entries and skills whose `resume_ids` hold it:
  for an upload, what its import found; for a built resume, what it shows
  now. Not From an Upload shows the entries and skills that no upload
  holds. All Experiences shows the whole bank.
- **An entry shows all its bullets**, whichever resume is picked. Bullets
  have no sources, and a built resume's hidden bullets are a choice of that
  resume, made in its editor. The entry editor here saves the bullet list
  it is given, so a bullet hidden from it would be deleted on the next
  save. The bank shows the original wording only, never a built resume's
  local wording (`resume.md`, KAN-218).
- **A shared entry says where else it is used.** Under a resume pick, an
  entry whose `resume_ids` hold other resumes too gets one line under its
  title, naming the others: "Also used in resume-v2.pdf". Two others:
  "Also used in resume-v2.pdf and Resume #2". Three or more: the first two
  names, then "and N more" ("Also used in resume-v2.pdf, Resume #2 and 1
  more"). Names come from `resumes`, in its order. Under All Experiences,
  the same entry says "Used in resume.pdf and Resume #2" (same rules for
  three or more), since there is no current resume to leave out. The line
  is there because the bank holds one entry for all of them (ADR 0001, ADR
  0003): an edit to it changes it on every resume that holds it.
- **Skills get no "Also used in" line.** A skill is a small chip with only
  a name, and a line under each chip would crowd the card. Skills are
  still filtered by the pick like entries (open question 4).
- **Section cards stay**, so the order and headings do not jump. A card
  with nothing for the pick says "Nothing from this resume." in place of
  "Nothing here yet."
- **The pick lives in the URL** (`/bank?resume=<id>`, `?resume=all`,
  `?resume=none` for Not From an Upload), so a reload, Back and a shared
  link keep it. No `resume` parameter, or an id the bank no longer lists
  (a deleted resume), opens on the primary resume as above. The Jobs
  page's `?import=1` handling (`bank-screen.tsx`) must keep the `resume`
  parameter when it drops `import`.
- **Add under a resume pick** saves the entry as today: no source, and no
  choice row on any built resume (it waits in each one's tray, as every
  new bank item does). It would then vanish from the view the student is
  looking at, so the page switches the dropdown to All Experiences and
  scrolls to the new entry, with one line: "Saved to your bank. It isn't
  on Resume #2 yet: add it from that resume's editor." (for an upload:
  "It's under All Experiences, since it isn't from resume.pdf.").
- **Scout works on the whole bank.** When Scout's panel marks an entry the
  pick hides (intake's walk, `onFocus`), the dropdown switches to All
  Experiences first; otherwise the page scrolls to an entry that is not
  there.
- **An old upload with no sources** (uploaded before this change) shows its
  empty view with one line and one button: "WorkIt hasn't linked this
  resume's entries yet. [Import Again]". Import Again is the existing
  `POST /bank/import` with that `resume_id`; it adds sources and merges as
  it always has. Built resumes never need it.
- **Delete Entry** says nothing new: deleting an entry deletes it from the
  bank, for every resume, as today. The confirm keeps its built-resume
  count.

The Resumes view (`/resumes`) is unchanged, except that each resume's row
can link to its view: "View Experiences" → `/bank?resume=<id>` (open
question 2).

## Old data: no backfill for uploads

Built resumes need none: their choice rows exist. Entries in the bank
today have no upload sources, so on the day this ships every upload's view
is empty. A migration cannot fix that: matching a stored upload to bank
entries needs the parser, which is Python code and must not run inside a
migration. A one-time script against the shared database was rejected once
already (ADR 0003, "Considered Options") for the same reasons it fails
here.

So an old upload gets its sources the first time the student clicks Import
Again on its view (above). Import Again is safe: it merges, never copies.
It can bring back a bullet the student deleted; that is the student's
explicit click, as today.

## Considered options

- **One `resume_id` column on `bank_entries` and `bank_skills`**, as first
  asked. Rejected: a merged entry comes from several uploads (above).
- **A bank per resume** (copy each resume's entries under it). Rejected: it
  undoes ADR 0001. A fix in one copy would not reach the others, and
  Generate would have to choose between copies.
- **Source rows for built resumes too.** Rejected: the choice rows already
  say what a built resume shows, and a second record would drift from them
  on every editor change.
- **Uploads only in the dropdown.** Rejected: a student thinks of "my
  resumes" as one list, as the Resumes page shows them, and a built
  resume's view is the one an edit most directly changes.
- **Sources on bullets too** (`bank_bullet_sources`), so an upload's view
  shows only its own bullets. Rejected for now: the entry editor saves the
  whole bullet list, so hiding a bullet risks deleting it, and a student
  editing an entry should see all its lines. It can come later on top of
  this design if the views read wrong in use.
- **Filter on the server** (`GET /bank?resume_id=`). Rejected: one more
  shape of the bank to keep right, and a round trip per pick, for a list
  the browser already has.
- **Open the dropdown on All Experiences.** Rejected: the page would open
  on the mixed bank this change exists to avoid. The cost of opening on
  the primary resume is that items no resume holds are hidden on arrival;
  the dropdown's Not From an Upload option shows they exist.

## Build order

1. **Migration and models**: the two source tables, RLS on. Check it
   offline with `--sql`; the user applies it (root `CLAUDE.md`).
2. **`services/bank.py`**: `merge_import(..., resume_id, ...)` writes
   sources for every found entry and skill; a `clear_sources(resume_id)`
   for Import Updated Resume; `load_bank` reads the sources and the shown
   choice rows.
3. **Routes**: upload (flush the row first), Import Updated Resume (clear,
   then merge), Import Again (add); `bank_response` sends `resume_ids` and
   `resumes` (with `kind`, `posting` and `primary`).
4. **Tests** (`tests/test_bank_import.py` and `tests/test_built_resumes.py`,
   against real Postgres): an upload links what it added; a second upload
   links an entry it merged and an entry it found with nothing new; a skill
   the bank had gets the link; Import Updated Resume drops the link of an
   entry the new file lacks and keeps the entry; deleting the upload keeps
   the entries and drops the links; a source write leaves the embedding as
   it was; a built resume's `resume_ids` follow its shown choice rows (a
   hidden or tray entry is not held); `primary` follows either default
   pointer.
5. **Frontend**: types in `bank-actions.ts`; the dropdown, its opening pick
   and the filter in `bank-screen.tsx`; the "Also used in" line in
   `EntryView`; the Add and Scout switches; the old-upload prompt.
6. **Docs**: `resume.md` ("The experience bank") and ADR 0003 gain a line
   each pointing here; `GLOSSARY.md` gains the term once it is settled
   (open question 3); `backend/CLAUDE.md` ("An upload fills the bank") and
   `models/CLAUDE.md` ("The experience bank") gain the source rules; this
   file's status becomes built.

## Open questions

1. **Linking by hand.** Should the student be able to add an entry made by
   hand to an upload's view? Yes: views match what the student means, but
   a source no longer means "the file holds this". No (this design): a
   source is always the reading of a file. (A built resume needs no such
   link: its editor's tray already adds an entry to it.)
2. **"View Experiences" on the Resumes view.** Add the link on each
   resume's row? Yes: one click from a resume to its facts. No: the
   dropdown on the Experiences view is enough.
3. **The term.** The glossary needs a name for "the uploaded resumes an
   entry came from". Proposed: **source** ("this entry's sources are
   resume.pdf and resume-v2.pdf"). It joins `GLOSSARY.md` once the team
   agrees.
4. **"Also used in" on skills.** Show it on a skill too (in its tooltip,
   say)? Yes: the student sees that removing or renaming a skill changes
   other resumes. No (this design): the chips stay small, and a skill's
   only text is its name.
