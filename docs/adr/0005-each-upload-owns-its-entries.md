# Each uploaded resume owns its own entries; uploads are never merged

Status: built 2026-10-23 (migrations `b5e1c3a7d920`, then `c8f2a4e6b913` after the deploy). Supersedes ADR 0003's merge rule and
its "deleting an upload leaves the bank as it is". ADR 0006 adds one exception:
an upload that confirms a parse preview replaces the other uploads' matching
entries and skills. KAN-440 brings back All Experiences as a read of the whole
bank (below); one owner per entry stands.

An upload writes every entry and skill its reading found as new rows owned
by that upload (`bank_entries.resume_id`, `bank_skills.resume_id`). It
never looks for the same entry under another resume and never merges, so
two uploads that list the same job hold two entries. Import Updated Resume
and Import Again replace the upload's entries with the new reading. Built
resumes still point at entries through their choice rows and own none (ADR
0001). The design is `../bank_by_resume.md`.

## Why

The merge (ADR 0003, then KAN-343's link tables) made one entry belong to
several uploads. Each upload's view on the Experiences page then held
entries it shared with others, an edit on one view changed the rest, and
every import ran a duplicate check for each entry it read. The team chose
one owner per entry: each resume's facts read and edit on their own.

## Consequences

- The change is to the experience bank only. Generate, Tailor's ranking,
  Scout, the recommender, intake and the autofiller read every entry, so
  they see the same job once per upload. The team accepts that.
- `find_duplicate` leaves the import and Tailor's upload source; Add's
  warning checks only the same owner's entries.
- The link tables `bank_entry_sources` and `bank_skill_sources` are
  replaced by the owner column, then dropped after the deploy.
- A replace or an upload's delete deletes that upload's entries, the
  student's edits to them, and their places on built resumes. No warning.
- The Experiences view showed one resume at a time, with All Experiences
  removed. Not From an Upload stays, so an entry no upload owns (the
  student's own, or one the migration could not give one owner) can still
  be seen, edited and deleted. Removed with All Experiences at first, it
  left 96 entries of 8 students out of reach (2026-10-24).
- **All Experiences came back (KAN-440, 2026-10-30)** as the view the page
  opens on, because a student with a resume had no way to see everything
  they hold, and the resume editor's picker needs that whole view. Nothing
  here is merged: a job two uploads list stays two entries, and All
  Experiences only shows it as one row (`copy_group`, from `copy_key`). An
  edit changes that one copy, so "each resume's facts read and edit on their
  own" still holds. Clear All stays on a resume's view, since a row there
  stands for copies on several resumes. **Not From an Upload went with it**:
  All Experiences now holds what no upload owns, and a copy no resume holds
  with other bullets stays a row of its own, so nothing is out of reach.
