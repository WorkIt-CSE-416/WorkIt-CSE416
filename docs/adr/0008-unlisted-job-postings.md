# A job WorkIt does not list becomes an added job

Status: accepted 2026-11-02 (KAN-541). Revised the same day: an added job
is a column (`added_by_student`, KAN-515), not the status `unlisted`.

An application must point to a job posting (its key is applicant and job
posting). To track a job that WorkIt does not list, the student adds it by
its link (`POST /jobs/added-by-link`), and WorkIt makes an **added job**: a
published scraped-shape job posting with `job_postings.added_by_student`
set, and only the company, the title and the link. Two callers use the one
route: the extension's Write with Claude on a form (KAN-515), and Apply's
tracker writes and the Tracker Sheet import (KAN-544, KAN-545), which send
`track_only`. Job search and Scout never show an added job (`LISTED`
leaves it out), and a student sees one only on their own tracker. A second
student who adds the same link gets the same job posting, so the link
stays unique. Each student sees the company and title that they gave,
never the text of another student. When the scraper later finds a job
whose link matches an added job, the import fills in that job posting and
clears the flag. It does not make a second one, so the link stays unique
and the student's application stays on it.

## Why

On 2026-11-02, WorkIt listed 20 of the 33 jobs Lisul applied to with
Apply. The other 13 include 6 on eightfold.ai, a site WorkIt has no jobs
from. A record of applications that leaves out 2 in 5 is not a record.

A column, not a status: two branches built this at once. KAN-515 (Write
with Claude) marked the job with `added_by_student` and kept it
`published`, so the extension, the connector and the queue treat it as
open. KAN-542 used a new status `unlisted`, which every query that reads
`open` had to special-case. One design was kept: the column.

## Considered Options

- **An application with no job posting** (company, title and link on the
  application row). Rejected: it changes the application's key and every
  query that joins the posting, and a later listing of the same job makes
  a second, unconnected row.
- **Skip the jobs that WorkIt does not list.** Rejected for the reason
  above.
- **The status `unlisted`** (KAN-542's first design). Replaced by the
  column for the reason above.

## Consequences

- Each query that lists job postings to students must read `LISTED`,
  which leaves out added jobs. A query that misses this shows one
  student's job to others, so tests cover search and Scout.
- One job posting per link, but not one text per link: each student's
  application keeps the company and title that student typed
  (`job_applications.company_name`, `title`), and an added job shows each
  student their own text (`postings.typed_text`).
- Links are compared after normalizing them, and Greenhouse jobs also by
  their job ID, so that a listed job is not added again.
- A closed scraped job is never reopened or retitled by an add. Write with
  Claude refuses its form; Apply's `track_only` puts the application on
  it and leaves it closed.
- **The enum value `unlisted` stays in the database, unused.** Migration
  `c2e4a6b8d051` added it and production already has it. No code writes
  it. Postgres cannot drop an enum value in place, so removing it is a
  separate, later migration that rebuilds `job_post_status` (as the
  downgrade of `c2e4a6b8d051` does).
