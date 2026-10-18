# An uploaded resume fills the experience bank on upload, and the parser's output is not kept

Uploading a resume saves the file, reads its text into `resumes.raw_text`, parses it, and writes the entries and skills straight into the experience bank, in one request (KAN-240). Each new resume adds to one bank: an entry already in the bank is merged, never copied. `resumes.parsed_json` is dropped, because the bank is the only store of resume facts. This reverses KAN-211's "import never writes": students uploaded a resume, saw nothing happen, and never found the review screen on Experiences.

## The rules

- **Parser first, the model as fallback.** `parse_resume` reads the text; when it finds no entries, the model reads it (`read_with_model`), spending one daily `PARSING` use, counted only when the reading succeeds. With no uses left, or the model offline, the upload still succeeds and adds what the parser found. An upload never fails because of its reading.
- **Merge, never overwrite.** A read entry matches a bank entry by `find_duplicate` (section, title and organization, ignoring case). On a match, the bank entry gains the bullets it lacks (compared ignoring case and spacing) and the fields it has empty; a field the bank holds keeps its value, since the student may have fixed it. Dates fill only when the bank entry has none, so a merge cannot pair one resume's start with another's end. A skill is added when the bank has no skill of that name, ignoring case.
- **One transaction.** The `resumes` row and every bank write commit together through `services/bank.py`, which clears the bank embedding. If the commit fails, the Storage file is removed, as before.
- **The upload says what it did**: entries added, entries merged, skills added, and whether the parser or the model read it, so the screen can say "Added 6 entries and 14 skills to Experiences".
- **Deleting an uploaded resume leaves the bank as it is.** Built resumes point at its entries, and the student may have edited them.
- **Import Again** re-reads a stored upload (`POST /applicants/{id}/bank/import`) and writes it into the bank under the same merge rules, with no review step. It keeps `read_with_ai` for a reading by the model on purpose. Re-importing can bring back a bullet the student deleted; that is the student's explicit choice.
- **Old uploads** get a one-time backfill script (`--dry-run` first, parser only, so it spends no model uses). The merge makes a second run add nothing.

## Considered Options

- **Drafts the student reviews** (KAN-211, kept until now): safe against parser mistakes, but the facts never reached the bank unless the student found the review, which they did not. Parser mistakes are now fixed in Experiences, where every fact is edited anyway.
- **Skip an entry already in the bank**: loses the second resume's new bullets, so two resumes do not add up to one bank.
- **Save a copy**: fills the bank with copies the student must clean up, and Generate already sets copies aside.
- **Keep `parsed_json` beside the bank**: two stores of the same facts drift apart, and nothing but the autofiller still read it.

## Consequences

- The autofiller extension read `parsed_json` for Education and Experience. It reads `GET /applicants/{id}/bank` instead, mapped to the shape its field map already takes, in the same change.
- Deploy the code before dropping the column: the code before this change writes `parsed_json` on every upload, so dropping it first breaks every upload. The order is merge and deploy, then `uv run alembic upgrade head`.
- The review screen's drafts, Save All and "Already in Your Bank" go. Intake's "Have a resume?" keeps Upload Resume, and "Use One I Uploaded" becomes Import Again.
- An upload that needs the model takes a few seconds longer.
