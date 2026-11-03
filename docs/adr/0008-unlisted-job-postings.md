# A job WorkIt does not list becomes an unlisted job posting

Status: proposed 2026-11-02 (KAN-541).

An application must point to a job posting (its key is applicant and job
posting). To track a job that WorkIt does not list, the student adds it by
its link, and WorkIt makes a job posting with the status `unlisted`: only
the company, the title and the link. Job search, Scout and other students
never see an unlisted posting. When the scraper later finds a job whose
link matches an unlisted posting, it fills in that posting and publishes
it. It does not make a second one, so the link stays unique and the
student's application stays on it.

## Why

On 2026-11-02, WorkIt listed 20 of the 33 jobs Lisul applied to with
Apply. The other 13 include 6 on eightfold.ai, a site WorkIt has no jobs
from. A record of applications that leaves out 2 in 5 is not a record.

## Considered Options

- **An application with no job posting** (company, title and link on the
  application row). Rejected: it changes the application's key and every
  query that joins the posting, and a later listing of the same job makes
  a second, unconnected row.
- **Skip the jobs that WorkIt does not list.** Rejected for the reason
  above.

## Consequences

- Each query that lists job postings to students must leave out
  `unlisted`. A query that misses this shows one student's posting to
  others, so tests cover search and Scout.
- Links are compared after normalizing them, and Greenhouse jobs also by
  their job ID, so that a listed job is not added again as unlisted.
