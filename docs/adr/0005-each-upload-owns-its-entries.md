# Each uploaded resume owns its own entries; uploads are never merged

Status: decided 2026-10-23, not built. Supersedes ADR 0003's merge rule and
its "deleting an upload leaves the bank as it is".

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
- The Experiences view shows one resume at a time: All Experiences and Not
  From an Upload are removed, so an entry no upload owns shows only under
  a built resume that shows it.
