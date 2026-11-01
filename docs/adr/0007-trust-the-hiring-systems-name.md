# A pool board is named by its own hiring system, and a person checks a sample

Status: proposed 2026-10-29 (KAN-446); built, waiting for the team's
agreement before it merges. Amends the discovery review rule in
`scraper/CLAUDE.md` for one source, the open-jobs pool; every other source
is reviewed board by board as before.

open-jobs (github.com/elliottdehn/open-jobs, CC0) left a list of about
75,000 live company job boards when it stopped on 2026-10-10. About 15,600
are on Greenhouse, Workable, Ashby and Lever and missing from
`boards.csv`. The list has slugs only, no company names, and a slug is never
a name (a board under the wrong name puts another company's name on real
cards).

Daily discovery reads each pool board on a fixed day of a 16-day pass
(`discovery_pr.POOL_DAYS`), about 1,000 a run, and asks a quiet board again
on the next pass. A pool board is proposed only when:

1. it lists a posting `shortlist.pick` keeps, so it would put a card on the
   Jobs page now; and
2. its hiring system names the company itself (`Provider.read_name`):
   Greenhouse's and Workable's board record, Lever's and Ashby's board page
   title. A board it does not name stays unproposed, and so does one whose
   name is a careers page or a program (`board_read.NOT_A_COMPANY`: about 1
   Greenhouse board in 10, such as "Careers at KKR").

The review page marks a fixed random sample of each run's pool boards, a
tenth and at least five (`discovery_review.sampled`). A person checks those
names on each company's own website. If any is wrong, they check that whole
run's pool boards and remove the wrong rows; otherwise they merge the rest
unread.

## Why

Reviewing every board does not scale: a sample of 500 pool boards
(2026-10-29, `scraper/docs/research-open-jobs-freehire.md`) found about 9%
with an early-career posting, so about 1,400 proposals. The hiring system's
own name is stronger evidence than a third-party list's: it is what the
company typed into its own account. Requiring an early-career posting keeps
the boards that would show nothing off the review, and off the scrape.

## Considered Options

- **Review every board by hand**: safe, but 1,400 checks; the pool would
  take months to land.
- **Trust the hiring system's name with no sample**: no person ever sees a
  pool board. A system that names boards after an agency or a parent
  ("Accenture Construct" on a Lever board named InfrastructureandCapitalProjects)
  would go unnoticed.
- **Propose every live pool board, posting or not**: about 15,000 rows to
  review and read every run for a few hundred companies.

## Consequences

- BambooHR and Recruitee pool boards (about 5,500) are left out: neither
  names its company anywhere we may read. open-jobs' Workday entries name a
  tenant but no careers site, so they wait for a reader of each tenant's
  robots.txt.
- A pool board that lists no early-career posting today is asked again
  about 16 days later, so a seasonal hirer arrives on a later pass.
- The pool is frozen: open-jobs exported it on 2026-09-08 and will not
  update it. Growth after it comes from the other discovery sources.
