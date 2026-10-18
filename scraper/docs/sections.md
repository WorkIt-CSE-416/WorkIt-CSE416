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
| `requirements` | What the student must have, export control included | Requirements, What we're looking for, Export Compliance |
| `preferred` | What is nice to have | Preferred Qualifications, Bonus Points |
| `pay` | The pay, in words | Compensation, Hourly PhD Pay |
| `benefits` | Perks and benefits | What we offer, Life at Palantir |
| `logistics` | Location, dates, schedule | Work Schedule, Internship Details |
| `apply` | How to apply, the interview steps | Interview Process |
| `legal` | EEO, privacy, fraud notices | EEO Statement, #LI-Hybrid |

The order of `SECTIONS` decides headings two sections could claim. Each choice
has a test in `tests/test_sections.py`:

- export control before legal: "Export Compliance" is a requirement, not a notice.
- legal before pay: "Pay Transparency Disclosure" is a notice.
- benefits before pay: "Compensation & Benefits" opens the perks list.
- preferred before requirements: "Preferred Qualifications".
- responsibilities before role: "Role and Responsibilities".
- "About <name>" is the company only after every role pattern failed, so "About
  the role" stays the role.

## How a heading is told from content

A heading is a short line (60 characters, 9 words at most), starts with a capital,
does not end with a period, holds no comma unless it ends with a colon, and names a
section. A line that starts with a typed bullet ("• ", "- ", "· ", "* ") is a list
item, never a heading, as the job page reads it too: the glyph used to be stripped
first, so Workday's "• Perform other duties as assigned" opened Responsibilities
and swallowed the real heading after it. On the 13,257 stored descriptions
(2026-10-17) the rule changes 265 and cuts those that fail `kept(kept(text)) ==
kept(text)` from 87 to 77; the gold scores do not move. Two rules then keep a
list's items in their list:

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

On the 13,284 descriptions stored in the database on 2026-10-17 (every scraped
posting, not only internships, cut at 8,000 characters), 312 failed that check
(PR review). Two inline-label rules fixed 104 of them. They change 168 stored
descriptions, each only by keeping a label the line had lost:

- **Text that reads as a heading alone keeps its label.** Blue Origin's "Required
  for all positions: Blue's Standard Background Check" was stored without its
  label; read again, "Blue's Standard Background Check" is a legal heading, and
  the requirement vanished (81 postings).
- **A label naming the open section is content**, as `split` says, whatever the
  whole line reads as. The code had tested the whole line as a heading.

**A line ending in a colon opens its own section, even straight after a
heading** (decided 2026-10-17). Items rarely end in a colon. It fixed 121 more
failures (87 left), changes 477 stored descriptions, and leaves the gold score
where it was (80.5%; the gold set has few such lines). J&J's empty "Required
Skills:" then "Preferred Skills:" no longer files one under the other, and Wade
Trim's "About Wade Trim:" pitch leaves Preferred Qualifications. For matching,
278 postings now embed less text and 74 more (45,313 characters fewer in all),
mostly pitches leaving the embedded sections. The known cost: where an employer
puts a one-line heading inside a list, the rest of the list follows it. Applied
Materials' "Location:" sits inside "What We Offer", so its benefits text is now
stored under Details, where before it was left out.

The 87 left are mostly bullets read as headings ("Perform other duties as
assigned", "Communication skills"), after which a real heading counts as the
false one's first item: ATC's "Why ATC as an Intern" pitch is stored under
Responsibilities. Still open: it needs a better test of a bullet against a
heading, not another position rule.

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
  export-controlled technology" is a requirement a student has to meet, so a
  section headed "Export Control" or "Export Compliance" (or naming ITAR) is
  Requirements, matched before legal. Filed as legal at first, K2 Space's whole
  ITAR section left the job page, and the card's sponsorship reader misses
  ITAR's "U.S. persons" wording, so nothing on WorkIt said who could take the
  job (PR review, 2026-10-17).
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

## The gold test set (2026-10-17)

The numbers above count whether a section was found, not whether its content is
right: Perpay "had" Responsibilities filled with its company pitch. So the parser
is now scored against `tests/fixtures/sections_gold.json`: 50 real postings, one
per company (46 at random from the 2026-10-16 feed, plus Tenstorrent, Perpay,
TensorWave and Neuralink), every line labeled with its section by what it says,
under `docs/sections-gold-guide.md`. The labels were drafted blind by five
model-assisted labelers from that guide and spot-checked by hand; 169 of 1,726
lines were marked unsure, so read a disagreement as a question about the label
too. `tests/test_sections_gold.py` scores where each line shows on the job page
and fails if a change makes it worse.

**First scores** (with the heading-voice rule below):

| | |
|---|---|
| Lines shown where they belong | 80.3% |

| Heading | Shown there but belong elsewhere | Belong there but shown elsewhere |
|---|---|---|
| Overview | 35% | 49% |
| Responsibilities | 18% | 6% |
| Requirements | 11% | 21% |
| Preferred Qualifications | 27% | 15% |
| Pay | 20% | 38% |
| Details | 7% | 52% |

The largest errors: role text under a company heading is dropped (37 lines), and
company text shows as Overview (30) or Responsibilities (24); requirements show
under Preferred (28) or are dropped (20); pay lines are dropped (17). Headings
alone cannot fix these, since the employer's heading is often the wrong one for
its own text. That is the case for reading lines by meaning (a model, only for
the postings the rules are unsure of), measured against this set first.

**The heading-voice rule.** A heading in the company's voice ("we", "our", "us")
opens no section about the reader (Responsibilities, Requirements, Preferred)
unless it asks for the reader: "What we look for", "We're looking for someone
who has", "Qualifications we value" (`_COMPANY_VOICE`, `_READER_WE`). Perpay's
"Products we've built to make an impact" matched "make an impact" and filed its
products, office and hiring event as Responsibilities. On the whole feed it
changes only Perpay's five postings; on the gold set, wrong lines under
Responsibilities fall from 20.3% to 18.4% and the total from 79.9% to 80.3%.

**Workday postings (added the same day).** The 50 above came from Greenhouse,
Ashby and Lever, but Workday is 74% of the jobs WorkIt stores (9,782 of 13,284
on 2026-10-17), and 80 of the 87 descriptions that still failed
`kept(kept(text)) == kept(text)` were Workday's. So 30 Workday postings were added,
drawn at random from the stored jobs, one per company, fetched whole from
Workday's API. Two model-assisted labelers labeled every line blind and agreed on
98.7% (1,335 of 1,353); the 18 lines they split on were settled against the
guide, and a random 60 of the agreed lines were re-read against it. The test
scores the two groups apart (`ats`), each with its own floors.

| | Boards (50) | Workday (30) |
|---|---|---|
| Lines shown where they belong | 80.3% | 66.6% |
| Wrong under Responsibilities | 18.4% | 13.8% |
| Wrong under Requirements | 10.9% | 33.7% |
| Wrong under Pay | 20.0% | 41.7% |

Workday's largest errors: left-out text (benefits, company) shown under
Requirements (44 lines), role and duty text dropped (34 and 32), and duty lines
shown as requirements (27).

## The HTML's structure (2026-10-17)

Until now the scraper flattened a posting's HTML to bare lines (`providers.plain_text`)
and the parser guessed from each line's shape which ones were headings. The HTML
had already said so, and said which lines were list items. `providers.plain_lines`
now keeps that: the same lines, each with its role, "h" inside a heading tag, "li"
inside a list item, "b" when all of it is bold, "p" otherwise. The text is
unchanged (byte for byte on 491 fetched descriptions), so no card fact moves.
`sections.kept(text, roles)` uses the roles three ways:

- **A list item never opens a section**, unless it ends in a colon ("Preferred:"
  as a list's first item). Workday lists items such as "Good interpersonal skills"
  that used to open Requirements and take the next items with them.
- **A marked heading is read by its words alone** (`_marked`). The shape test only
  stands in for markup, so where the HTML marks a heading, a comma, quotes, "…" or
  a longer phrase no longer hide it: "In this internship, you will...", "“Let's
  find out about you.”", "Here are some attributes that we are looking for in
  our next intern". A bold sentence is still emphasis ("The minimum length of the
  Internship must be 12 weeks." ends with a full stop), unless it is quoted.
- **A list item is stored as "• item"**, so the job page draws a list and a
  second read takes it for an item.

Ashby stays on its plain field, which already marks list items ("- ") and
capitalizes headings; Lever's list titles are now marked as headings.

On the Workday gold postings, half the misplaced lines (231 of 450) sat under a
heading the HTML marked but the keywords did not know. So the headings were
audited again, on a separate sample: 250 Workday and 100 Greenhouse postings
fetched on 2026-10-17, none in the gold set. Every marked heading the parser did
not read was counted, and each section name seen in two postings or more was
added: "Education", "You bring to the team", "The ideal candidate will have",
"What Will You Do?", "Key Accountabilities", "Health & Wellbeing", "What you can
expect", "Working Conditions", "Accessibility", "Candidate AI Usage Policy",
"Learn More & Apply Now" and the like (`SECTIONS`), plus "Job Description Summary"
and "Job Details" as wrappers. Left out on purpose: Workday's fields ("Job Type",
"Time Type", "Travel -"), whose label line a heading would drop, leaving "Full
time" alone under Details; and "A day in the life", which heads a summary as often
as duties. Two fixes came with it: a zero-width space before a heading
(Morningstar's "\u200bWho You Are") no longer hides it, and "Also helpful, but not
required" is preferred, not required.

| | Before | After |
|---|---|---|
| Boards: lines shown where they belong | 80.5% | 82.0% |
| Workday: lines shown where they belong | 66.6% | 70.1% |
| Workday: wrong under Requirements | 33.7% | 22.1% |

The gold floors were raised to these. On the 467 fetched HTML descriptions, 11
fail `kept(kept(text, roles)) == kept(text, roles)`, against 12 for the parser
before on the same text. Read without roles, as the stored text is, 205 of the
13,257 stored descriptions fail it (77 before): Workday's text without its markup
is not what production reads. `PAGE_VERSION` 15 re-reads every stored page.

## What a line says (fix 4, 2026-10-17)

A heading decides a line's section, but employers mix: on the board gold
postings, 57% of the misplaced lines sat under a heading the parser read right,
saying something else. `_said` moves such a line by what it says, after the pay
and equal-opportunity rules, in this order:

| Rule | Moves | Boards | Workday |
|---|---|---|---|
| A nice-to-have ("is a plus", "preferred", "desirable") | Requirements, Responsibilities to Preferred Qualifications | +5 −1 | +9 −0 |
| A qualification ("Strong analytical skills", "Standard knowledge of…", "Bachelor's degree") | Responsibilities to Requirements | +0 −0 | +11 −0 |
| Work eligibility (authorization, sponsorship, citizenship, clearance) | Details, the intro, Overview, Pay to Requirements | +3 −0 | +2 −1 |
| A perk named outright (401(k), PTO, health insurance) | out of any kept section | +0 −0 | +1 −0 |
| How to apply | out of any kept section | +5 −2 | +7 −1 |

(Gold lines fixed and broken by each rule alone.) A nice-to-have aside inside a
requirement stays a requirement: "Fluent in English and German (any additional
language is a plus)" and "Programming skills in C++ and/or python. Julia is a
plus!" both are. The apply rule takes only a line about applying: "Ability to
apply critical thinking skills" is a qualification, and a summary that ends
"Apply today!" stays the role's, so a long line counts only when it opens with
the ask. Discrimination boilerplate ("prohibits discrimination based on …
citizenship") is now an equal-opportunity line, which the eligibility rule
would otherwise have shown under Requirements. Dropped: a where-and-when rule
(location and schedule sentences to Details) broke more gold lines than it fixed
(boards +2 −7, Workday +2 −3).

| | Before | After |
|---|---|---|
| Boards: lines shown where they belong | 82.0% | 82.5% |
| Workday: lines shown where they belong | 70.1% | 72.0% |
| Workday: wrong under Responsibilities | 10.7% | 6.2% |

On the 13,257 stored descriptions, 6,011 change, mostly by preferred items and
qualifications moving out of the wrong list; random samples of each rule's moves
read right. An application deadline is now left out with the rest of how to
apply, as the guide files it. On the 467 fetched HTML descriptions, 12 fail
`kept(kept(text, roles)) == kept(text, roles)`, as many as before the rules.

**Still open.** The rest is meaning a pattern cannot read: a summary under a
company heading, a requirement worded as a duty. Where that stands is under
"Hiding less job text" below.

## Hiding less job text (2026-10-17)

The gold score counts where each line shows, so a posting that lost its whole job
scored like one with a few lines misfiled. Read as stored, the parser hid 6.9% of
the board postings' job lines (gold Overview, Responsibilities, Requirements and
Preferred Qualifications) and 9.0% of Workday's. On the same four postings
(two SharkNinja, two Marvell), JobRight showed 29 duties and WorkIt none. A hidden
line is gone from the page, search, matching, Scout and Tailor, while a misfiled
one is still read, so these rules trade a little placement for less hidden text:

- **A marked heading no pattern names ends the company's section**, and what
  follows shows under Overview (`_walk`). SharkNinja's "About Us" ran on through
  "AI at SharkNinja" and "This role:", so its duties and requirements were filed
  with the company's pitch. Only after the company's section: after benefits and
  notices too, it put 40 lines of perks and notices under Overview in five gold
  postings ("And More:", "What You'll Experience"), for one posting's role (ASDA),
  and Workday's placement fell to 70.4%. A heading straight after such a guess
  opens its own section, so SharkNinja's slogan, then "Candidate Privacy Notice",
  does not file the notice as its Overview.
- **A description that keeps under a tenth of its text is kept whole**
  (`_KEEP_WHOLE_BELOW`), as one that keeps nothing about the job already was.
  SharkNinja kept its "Education:" line, 2 lines of 45, so the older rule let it
  through. 36 of the 13,257 stored descriptions kept under 10%; whole, a student
  sees the job under the employer's own headings.
- **"What you can expect" is Responsibilities**, not benefits: 116 of the 138
  stored postings with it describe the job under it, Marvell's 88 among them, and
  every Marvell posting lost its duties. "What you can expect from us" stays
  benefits (Pure Storage). The other 22 list perks (Kyndryl, CrowdStrike), which
  now show as duties; Cantina's six are the gold set's only ones.

Two headings looked like causes and were kept, by measurement:

- **"The Company"**: all 54 stored postings with it put the company's pitch
  under it. The Zurn Elkay posting that kept 1% has no job text at all, and is
  now kept whole.
- **"What you'll gain"** stays benefits. As Responsibilities, Workday's wrong
  lines under Responsibilities rose from 6.2% to 13.5%; as no heading at all,
  those under Requirements rose from 19.0% to 23.8%. Either way, only 0.5 points
  fewer job lines were hidden.

| | Before | After |
|---|---|---|
| Boards: lines shown where they belong | 82.5% | 81.7% |
| Boards: job lines hidden | 6.9% | 3.7% |
| Boards: wrong under Responsibilities | 15.5% | 18.7% |
| Workday: lines shown where they belong | 72.0% | 72.6% |
| Workday: job lines hidden | 9.0% | 5.2% |

This is the one trade the gold test records: the boards' placement floor fell
from 82% to 81.5% and its Responsibilities ceiling rose from 16% to 19%
(Cantina's perks). The hidden share has its own ceilings now, 4% and 5.5%, which
only come down. Read without their HTML, 240 of the 13,257 stored descriptions
change, and none keeps under 10% (the median keeps 73.7%). On the 467 fetched
HTML descriptions, 12 fail `kept(kept(text, roles)) == kept(text, roles)`, as
before.

**Still open.** What is left needs a line's meaning. A model that labels each
line would reach it. It was deferred on 2026-10-17 for want of a budget. A trial
on the gold set fits a free plan: Groq's `gpt-oss-120b` allows 200,000 tokens a
day, about one run. Labeling the whole feed does not: the stored descriptions are
about 16 million tokens. It would run in the backend's import, since the scraper
uses the standard library only. Ask it for a section per line number, not
rewritten text, so nothing on the page is invented. Store the labels once per
description, so the page does not change between runs. For comparison, JobRight
runs a model on every posting. Its pages hold fields a model fills (a written
summary, duties and qualifications copied word for word) and no copy of the
posting.

## What WorkIt keeps (decided 2026-10-17)

Xiang asked for this to be decided before anything was dropped, because dropped
text is gone for search, matching, Scout and Tailor.

- **Kept, in this order, under these headings** (`sections.KEPT`): the intro (no
  heading), Overview, Responsibilities, Requirements, Preferred
  Qualifications, Pay, Details. Sections of one kind are joined in the order
  written, so SpaceX's export-control rule joins its other requirements.
- **Left out:** company, benefits, legal, apply.
- **Matching's embedding reads:** Overview, Responsibilities,
  Requirements and Preferred Qualifications, plus the intro when there is no
  Overview, since that is where such a posting states the role
  (`backend/app/services/matching/embeddings.py`, `job_text`).

`providers._page` stores `cap(kept(full))`: the card's facts are read from the
whole text first, so a pay line under Benefits still reaches the card. Search's
full-text index, Scout, Tailor and the keyword match read the stored description,
so none of them sees the left-out text any more.

Two guards keep the format readable by the backend, each with a test:

- **A line that is only a kept heading is dropped from the text**, so the backend
  never reads a content line as the start of a section.
- **A description that keeps nothing is kept whole.** Every heading naming a
  left-out section means the headings were misread. Measured: 2 of 1,094. So is
  one that keeps under a tenth of its text ("Hiding less job text").

`Job Description`, the heading Workday puts over a whole posting, opens no
section; without that, Bose's company pitch was filed as the role's overview.

The role's heading is Overview, not "About the Role": the job page already puts the
whole description under its own "About the Role" section, and the two printed
one above the other.

No migration: the format lives inside the `description` column, and the job page
already reads short title-case lines as headings
(`frontend/src/app/(seeker)/jobs/[jobId]/description.tsx`).

**The headings are part of the feed's contract.** The backend finds the parts
matching reads by these exact lines, and the job posting page is to draw an
icon beside each one (`SECTION_ICONS` in
`frontend/src/app/(seeker)/jobs/[jobId]/description.tsx`, KAN-246). Rename one in
`KEPT`, in `job_text` and in `SECTION_ICONS` in the same change, or every posting
quietly embeds its whole description again and the section loses its icon.

Measured on the snapshot: the stored text is 29.7% smaller (median 4,596 to 3,122
characters), and 97.1% of postings carry at least one section matching reads.
`PAGE_VERSION` 14 re-reads stored Greenhouse, Workable, BambooHR and Workday pages
once, so the whole feed moves to the new format on the next live run.
