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

## Fixes after the first review (2026-10-17)

Tenstorrent's AI Software Intern showed four gaps at once: its role summary was an
inline label in the intro, an unknown heading ("USA Hiring Timelines") left its
dates, pay and legal text inside Responsibilities, its pay was a sentence under no
heading, and the card read "$50/hr - $70/hr" as $50. Each fix below was measured
on the 2026-10-16 snapshot with the same script, and each number is cumulative.

| | Before | Fix 1 | Fix 2 | Fix 3 |
|---|---|---|---|---|
| Pay on the card but no Pay section | 342 of 621 | 285 | 337 | 171 |
| Inline labels read as plain text | 406 | 106 | 114 | 114 |
| Legal text inside a kept section | 218 | 202 | 174 | 18 |
| Missing Responsibilities | 23% | 23% | 20% | 20% |
| Missing Pay | 71% | 65% | 71% | 55% |
| Unstable on a second pass | 1 | 0 | 0 | 0 |
| Stored text, less than raw | 29.7% | 30.1% | 31.4% | 32.6% |

The inline labels left are each in the section they name, so they are content on
purpose.

**Fix 1, inline labels.** "Overview: This is the team that…" puts its text under
the label's section, and the section that was open carries on after that one line
(`split`). A label inside a list covers itself alone: "Location: Austin, TX" among
the duties goes to Details and the duties after it stay. The most common moves are
Location (72), Compensation (32), Duration (25) and Start Date (24); "- Bonus:
Experience with Typescript" items in a requirements list go to Preferred, which is
what those postings mean by it.

**Fix 2, heading variants.** A second heading audit (every short, title-like
line followed by text that names no section, counted) found plurals and phrasings
the patterns missed: "USA Hiring Timelines", "Hybrid from one of our office
locations", "What You Might Do", "YOUR MISSION", "What sets you apart", "Why
Harvey", "A Note on AI", "Referral Instructions" and more, each now in `SECTIONS`
with a test. Two rules came with them:

- **A loose word is a whole heading only.** "insurance" or "retirement" anywhere
  in a line would read "Knowledge of insurance claims" in an insurance posting's
  requirements as a benefits heading and drop the rest of the list, so only
  "Health & Wellness", "Paid Time Off" and the like count. "Why <name>" is the
  company except "Why this role" and "Why join us".
- **A pay-sounding line inside a benefits list is an item.** Fospha's "Life
  assurance worth 4x your annual salary" opened a Pay section, and the company
  pitch after it was kept as pay. That rule is why "pay on the card but no Pay
  section" rose to 337 at fix 2: real amounts inside "Compensation & Benefits"
  lists reach Pay through fix 3 instead.

**Fix 3, lines sorted by what they say** (`_sorted_lines`, used by `kept`).
After the split, a line that states pay goes to Pay from any section, a left-out
one too, and an equal-opportunity line is dropped even from a kept section.
Tenstorrent's "Compensation for all interns … $50/hr - $70/hr" now reaches Pay
from under its hiring timelines; 249 lines moved on the snapshot, most from
Benefits, Requirements and the intro.

- **Pay is the card's own reader** (`details.pay`), so the card and the Pay
  section agree on what pay is. A perk with a price ("$250 monthly lunch stipend",
  "$20/pay period cell phone reimbursement") stays put unless the line also speaks
  of pay, as "$25.00 an hour plus a $2,000 monthly housing stipend" does.
- **A moved line loses a label that names another section**, so "Comprehensive
  Benefits: The salary range is €52,100- €78,200" is stored as the sentence alone
  and reads back the same; with the label it changed on the next read.
- **Export control is not dropped.** "Must be eligible to access U.S.
  export-controlled technology" is a requirement a student has to meet.
- **Nothing about the job itself kept means the posting is kept whole**, not just
  nothing kept: Bose's whole posting sits under "About Bose", and storing its pay
  line alone would have lost the rest.

Of the 171 postings still with pay on the card and no Pay section, 79 have no "$"
in their text at all: the hiring system sent the pay as a field (Ashby, Lever).
The job page shows the card's pay under Pay for those (fix 5).

**Fix 4, pay ranges read whole** (`details.py`, `docs/card-facts.md`). "$50/hr -
$70/hr", "$30CAD to $45CAD" and "between $45 and $65" each read as their low end,
so Tenstorrent's card said "$50/hr". 16 of 1,094 cards now show their whole range.

**Fix 5, every core section shown** (the job page,
`frontend/src/app/(seeker)/jobs/[jobId]/description.tsx`, `withCoreSections`). A
sectioned description always shows Overview, Responsibilities, Requirements and
Pay; a missing one says why as far as WorkIt can tell (pay from the listing, past
the 8,000-character cut, or no heading for it in the posting), never that the
posting lacks it. Checking it found that "Internship Information" belongs to
Details, not Overview.

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
matching reads by these exact lines, and the job posting page draws an icon
beside each one (`SECTION_ICONS` in
`frontend/src/app/(seeker)/jobs/[jobId]/description.tsx`). Rename one in `KEPT`,
in `job_text` and in `SECTION_ICONS` in the same change, or every posting
quietly embeds its whole description again and the section loses its icon.

Measured on the snapshot: the stored text is 29.7% smaller (median 4,596 to 3,122
characters), and 97.1% of postings carry at least one section matching reads.
`PAGE_VERSION` 14 re-reads stored Greenhouse, Workable, BambooHR and Workday pages
once, so the whole feed moves to the new format on the next live run.
