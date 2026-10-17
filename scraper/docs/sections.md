# Description sections (KAN-229)

`workit_scraper/sections.py` splits a job posting's description into the sections
its headings name. This file has the measurements behind its patterns and rules,
and the decision still open about which sections WorkIt keeps.

## Why split at all

A description is stored as one block of plain text, cut at `DESCRIPTION_CHARS`
(8,000). Three readers want less than all of it:

1. **Storage.** About a third of a description is the company's pitch, the
   benefits list, legal notices and how to apply. None of it says what the job is.
2. **Job matching.** The posting's embedding reads the description. Benefits and
   EEO text are the same in every posting from one company, so they pull its
   postings together whatever the role.
3. **The cut.** The cut keeps the start of the text. A long company intro pushes
   the requirements past it, which is why `DESCRIPTION_CHARS` grew from 3,000.
   Cutting only the kept sections keeps more requirements for the same size.

## The sections

| Key | What it holds | Example headings |
|---|---|---|
| `intro` | Text before the first heading | (none) |
| `company` | The company's pitch, mission, values | Who we are, About Stripe |
| `role` | What the role and team are | About the role, Position Overview |
| `responsibilities` | What the student will do | What you'll do, Key Responsibilities |
| `requirements` | What the student must have | Requirements, What we're looking for |
| `preferred` | What is nice to have | Preferred Qualifications, Bonus Points |
| `pay` | The pay, in words | Compensation, Hourly PhD Pay |
| `benefits` | Perks and benefits | What we offer, Life at Palantir |
| `logistics` | Location, dates, schedule | Work Schedule, Internship Details |
| `apply` | How to apply, the interview steps | Interview Process |
| `legal` | EEO, export control, privacy, fraud notices | EEO Statement, #LI-Hybrid |

The order of `SECTIONS` decides headings two sections could claim. Each choice
has a test in `tests/test_sections.py`:

- legal before pay: "Pay Transparency Disclosure" is a notice.
- benefits before pay: "Compensation & Benefits" opens the perks list.
- preferred before requirements: "Preferred Qualifications".
- responsibilities before role: "Role and Responsibilities".
- "About <name>" is the company only after every role pattern failed, so "About
  the role" stays the role.

## How a heading is told from content

A heading is a short line (60 characters, 9 words at most), starts with a capital,
does not end with a period, holds no comma unless it ends with a colon, and names a
section. Two rules then keep a list's items in their list:

- **A heading of the section already open is content.** Under Benefits, "Commuter
  benefits" is an item.
- **A heading needs a line of content before another can open.** On the
  2026-10-16 feed, 138 headings sat straight after another heading. Nearly all
  were that list's first item: "What we offer" then "Market competitive
  compensation structure" is a benefits list, not an empty benefits section and a
  pay one. Before this rule, that posting lost its whole benefits section.

The first patterns missed plain "Responsibilities", the most common heading in the
feed (227 postings), because `\bresponsibilit\b` needs a word boundary the word
does not have. A heading audit, every heading counted by section plus every
unmatched short line seen four or more times, is how that and the rest were found.
Run one again before changing a pattern.

## Measurements

The committed snapshot, `backend/data/feed.json` on 2026-10-16: 1,094 postings with
a description, already cut at 8,000 characters.

| | |
|---|---|
| Responsibilities or requirements found | 95.4% |
| Both found | 71.5% |
| No heading at all (one intro) | 1.1% |

| Section | In postings | Share of all text |
|---|---|---|
| intro | 58.0% | 14.7% |
| company | 50.3% | 13.0% |
| role | 55.0% | 11.9% |
| responsibilities | 77.1% | 14.3% |
| requirements | 89.8% | 17.5% |
| preferred | 45.2% | 6.5% |
| pay | 29.2% | 3.1% |
| benefits | 47.2% | 11.4% |
| logistics | 16.0% | 2.6% |
| apply | 9.1% | 0.9% |
| legal | 21.2% | 4.1% |

Leaving out company, benefits, legal and apply stores 29.7% less text: the median
posting goes from 4,596 to 3,122 characters. Leaving out the intro too would reach
44.1%, but the intro holds the role's summary in postings that have no "About the
role" heading.

**The role's loose words count only as a whole heading or in a fixed phrase.**
"Role", "The Team", "Overview" and "Summary" alone are headings; anywhere in a
line they matched bullets ("Document your methods and share findings with the
team"), and each such false heading swallowed the real heading after it under the
rule above. Tightening them cost role 57.8% to 55.0% of postings, and made the
stored format read back the same on a second pass for all but 1 of 1,094 postings
(from 7). Re-run that check after changing a pattern: `kept(kept(text)) == kept(text)`.

## What WorkIt keeps (decided 2026-10-17)

Xiang asked for this to be decided before anything was dropped, because dropped
text is gone for search, matching, Scout and Tailor.

- **Kept, in this order, under these headings** (`sections.KEPT`): the intro (no
  heading), Overview, Responsibilities, Requirements, Preferred
  Qualifications, Pay, Details. Sections of one kind are joined in the order
  written, so SpaceX's export-control rule joins its other requirements.
- **Left out:** company, benefits, legal, apply.
- **Matching's embedding reads:** Overview, Responsibilities,
  Requirements and Preferred Qualifications
  (`backend/app/services/matching/embeddings.py`, `job_text`).

`providers._page` stores `cap(kept(full))`: the card's facts are read from the
whole text first, so a pay line under Benefits still reaches the card. Search's
full-text index, Scout, Tailor and the keyword match read the stored description,
so none of them sees the left-out text any more.

Two guards keep the format readable by the backend, each with a test:

- **A line that is only a kept heading is dropped from the text**, so the backend
  never reads a content line as the start of a section.
- **A description that keeps nothing is kept whole.** Every heading naming a
  left-out section means the headings were misread. Measured: 2 of 1,094.

`Job Description`, the heading Workday puts over a whole posting, opens no
section; without that, Bose's company pitch was filed as the role's overview.

The role's heading is Overview, not "About the Role": the job page already puts the
whole description under its own "About the Role" section, and the two printed
one above the other.

No migration: the format lives inside the `description` column, and the job page
already reads short title-case lines as headings
(`frontend/src/app/(seeker)/jobs/[jobId]/description.tsx`).

**The headings are part of the feed's contract.** The backend finds the parts
matching reads by these exact lines. Rename one in `KEPT` and in `job_text` in
the same change, or every posting quietly embeds its whole description again.

Measured on the snapshot: the stored text is 29.7% smaller (median 4,596 to 3,122
characters), and 97.1% of postings carry at least one section matching reads.
`PAGE_VERSION` 14 re-reads stored Greenhouse, Workable, BambooHR and Workday pages
once, so the whole feed moves to the new format on the next live run.
