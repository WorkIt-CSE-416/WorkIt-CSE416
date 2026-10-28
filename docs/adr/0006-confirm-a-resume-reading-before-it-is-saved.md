# The student sees a resume's reading before it is saved, and a confirmed upload replaces matching entries

Status: built 2026-10-25 (KAN-372). Amends ADR 0003 and ADR 0005 for one
path, the upload that confirms a parse preview; every other upload,
Import Again and Import Updated Resume work as before.

Onboarding's resume step reads the file first and shows what it found
(`POST /applicants/{id}/resumes/preview`, which saves nothing: no Storage
file, no row, no bank write). The student confirms, and the same file goes
up through the normal upload with `?replace=matching`. ADR 0003's intent
holds: the upload is still the one request that saves the file and fills
the bank, in one transaction, with no review queue to find later. The
preview only comes first.

A confirmed upload also replaces, in the same transaction, the entries and
skills of the student's other uploads that its reading matches: an entry
by section, title and organization, a skill by name, both ignoring case
(`services/bank.py`'s `upload_matches`). The newer upload then holds the
one copy. Entries the student made (no owner) never match. The preview
lists, beside each entry and skill, the rows a confirm would replace.

## Why

Simplify's append-only parse leaves stale copies that pile up with every
new resume (the batch-apply onboarding research); Handshake shows what its
reading found and asks before adding it. Under ADR 0005 alone, a student
who uploads a corrected resume in onboarding gets every job twice.

## Considered Options

- **Make every upload replace matching entries**: undoes ADR 0005 for
  students who keep two resumes on purpose (one per role), whose entries
  would move between them on each upload.
- **Save first, then show an editable review of the upload's entries**:
  the reading is saved before the student agrees to it, which is what the
  ticket asks not to do.
- **Keep the reading between preview and confirm on the server**: a store
  for drafts again (ADR 0003 removed `parsed_json`). The parser is
  deterministic, so reading the same file twice gives the same entries.

## Consequences

- A replaced entry goes with the student's edits to it and its places on
  built resumes, as an Import Updated Resume's do (ADR 0005). The preview
  shows which ones.
- The upload response's `bank` adds `entries_replaced` and
  `skills_replaced` (0 on every other path).
