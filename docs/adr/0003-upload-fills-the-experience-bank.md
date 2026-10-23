# An uploaded resume fills the experience bank on upload, and the parser's output is not kept

Uploading a resume saves the file, reads its text into `resumes.raw_text`, parses it, and writes the entries and skills straight into the experience bank, in one request (KAN-240). Each new resume adds to one bank: an entry already in the bank is merged, never copied. `resumes.parsed_json` is dropped, because the bank is the only store of resume facts. This reverses KAN-211's "import never writes": students uploaded a resume, saw nothing happen, and never found the review screen inside intake.

## The rules

- **The parser only, unless the student asks.** Upload and Import Again read with `parse_resume`. The model reads a resume only when the student clicks Read It With AI, never as a fallback, even when the parser finds nothing; it spends the student's one daily `PARSING` use, counted only when the reading succeeds. An upload never fails because of its reading.
- **Merge, never overwrite.** A read entry matches a bank entry by `find_duplicate` (section, title and organization, ignoring case). On a match, the bank entry gains the bullets it lacks (compared ignoring case and spacing) and the fields it has empty; a field the bank holds keeps its value, since the student may have fixed it. Dates fill only as a set, when the bank entry has none, so a merge cannot pair one resume's start with another's end. A skill is added when the bank has no skill of that name, ignoring case.
- **One transaction.** The `resumes` row and every bank write commit together through `services/bank.py`, which clears the bank embedding. If the commit fails, the Storage file is removed, as before.
- **The result says what went in**: `found` (what the reading found, written or not), entries added, entries filled in, skills added, and who read it. The Resumes view (My Profile until 2026-10-18) and intake show it as one sentence: "Added 6 entries and 2 skills from resume.pdf", "Experiences already has everything in …", or "WorkIt couldn't find any entries in …", with Read It With AI beside it while a use is left.
- **Import Again** re-reads a stored upload (`POST /applicants/{id}/bank/import`) under the same merge rules, with no review step, so a parser fix reaches old uploads. It can bring back a bullet the student deleted; that is the student's explicit click. It was an icon on each uploaded resume's row on My Profile until 2026-10-18, when that icon became **Import Updated Resume**: a dialog that takes a newer version of the file, replaces the file on the same row (`PUT /applicants/{id}/resumes/{resume_id}`) and merges its reading the same way. The stored file never changes, so re-reading it with the same parser only said "already in your bank". Import Again stays behind intake's Use One I Uploaded and the Jobs page's card.
- **Deleting an uploaded resume leaves the bank as it is.** Built resumes point at its entries, and the student may have edited them.
- **Old uploads are not backfilled.** A resume uploaded before this change reaches the bank when the student clicks Import Again, which the Jobs page's empty-bank card offers in one click.

## Considered Options

- **Drafts the student reviews** (KAN-211, kept until now): safe against parser mistakes, but the facts never reached the bank unless the student found the review, which they did not. Parser mistakes are now fixed in Experiences, where every fact is edited anyway.
- **The model as a fallback when the parser finds no entries** (KAN-222 had it on import): rejected, so that a daily AI use is spent only when the student chooses to spend it.
- **Skip an entry already in the bank**: loses the second resume's new bullets, so two resumes do not add up to one bank.
- **Save a copy**: fills the bank with copies the student must clean up, and Generate already sets copies aside.
- **Keep `parsed_json` beside the bank**: two stores of the same facts drift apart.
- **A one-time backfill of old uploads**: written, then dropped. Import Again already covers an old upload on the student's click, and a script run by hand against the shared database is one more step that can go wrong.

## Consequences

- Deploy the code before dropping the column (`3f7a2c9d1e84`): the code before this change writes `parsed_json` on every upload, so dropping it first breaks every upload. The order is merge and deploy, then `uv run alembic upgrade head`.
- The Chrome autofiller extension read `parsed_json` through `GET /applicants/{id}/resumes/{resume_id}`, which now returns the resume's metadata only, so the extension fills no Education or Experience until its owner moves it to `GET /applicants/{id}/bank`. That code is being rewritten by its owner and is left alone here.
- The review screen's drafts, Save All and "Already in Your Bank" are gone. Intake's "Have a resume?" keeps Upload Resume, and "Use One I Uploaded" runs Import Again.
- KAN-343 (`../bank_by_resume.md`) first kept this merge and added a record
  of which uploads found each entry and skill. **ADR 0005 (2026-10-23)
  replaced the merge**: each upload owns its own entries, a new import
  replaces them, and deleting an upload deletes them.
- Scout, for an empty bank beside an upload, now says the upload could not be read and points at Import Again and Read It With AI, not at an import still waiting.
