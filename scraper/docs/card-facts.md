# Card facts — how `details.py` and `shortlist.py` read them

The six facts on a job's card (location, job type, salary, work style, level, years or start term) and visa sponsorship: where each comes from, every rule's real posting, and the measurements behind the inferred ones. Reached from `../CLAUDE.md`.

## The card's facts: the provider's field, then the description, then only a measured rule

The app's card shows six facts: location, job type, salary, work style, level and
years of experience -- or, on an internship, when it starts ("Start in Summer 2027"),
since nobody asks an intern for years. Each is filled from the provider's own field
where it has one (Ashby `employmentType` and `compensation`, Lever `commitment` and
`salaryRange`, Greenhouse `pay_input_ranges` and board metadata, Workable `type` and
`salary_*`, Recruitee `employment_type_code` and `salary`, BambooHR
`employmentStatusLabel` and `compensation`, Workday `timeType` and `remoteType`), and otherwise from
the description by `details.py`. What neither states stays null, and the card says
"not listed" -- except work style and job type, each inferred by a measured rule below.

**Facts are read from the whole description, when it is fetched** (`details.read`, from
`providers.text._page`),
and only then is it cut to `DESCRIPTION_CHARS` for storage. Pay is often the last thing
a posting says, under a long benefits section: reading the stored, cut copy missed it
on a sixteenth of the feed. So `--offline` re-renders the facts a fetch found but finds
no new ones; changing a pattern in `details.py` takes a live run (and, for Greenhouse,
Workable, BambooHR and Workday, a `PAGE_VERSION` bump) to reach stored postings.

`details.py` is regex over prose, so it is fussy in the same way `shortlist.py` is, and
every case in `tests/test_details.py` was seen in a real posting, except
`TestConstructedGuards` (see Visa sponsorship below):

- **Statements about this role only.** "Not considering remote or part-time",
  "full-time or part-time internship", "post-internship opportunities (full-time)" and
  "employees (including part-time)" are all in live descriptions. A posting offering
  both types has none.
- **A ceiling is not a minimum.** Lyft and DoorDash interns need "less than 2 years".
  Of several minimums ("5+ years, or 3+ with a Master's") the lowest is the bar.
- **Pay keeps its period.** Many internships pay by the month or week, and $8,000 a
  month for twelve weeks is not $96,000 a year, so the feed carries `week` and `month`
  as well as `job_postings`' `hour` and `year`. An amount its label contradicts loses
  the label (Samsara's "Annual Base Salary: $38—$58"); `$120M` raised is not pay.
  `feed.salary` always writes a range (`salary_min`/`salary_max`, equal for one
  amount); the card prints an equal range once.
- **"Intern" is not a job type.** Ashby and Lever say Intern where they could say
  Full-time; it says nothing about hours, so the description decides.
- **A role's facts come whole from one posting**, the copy it links (`_lead`) or,
  when that has no page, the first copy with one -- never field by field across
  copies of one URL, which would pair one copy's pay with another's job type.
  `Role.facts.work_style` is the card's answer.
- **Work style is the one fact the card infers** (`shortlist._work_style`), in this
  order: what the posting states (its board's field, or a sentence like Sigma's "an
  in-office work environment"); then what the company's other postings state, most
  often; then "On site" for a posting that names a place and nowhere mentions remote,
  hybrid or working from home. Most postings that say nothing (Figure: "San Jose, CA",
  no more) work on site, and a filled card was judged worth the misses. Measured on
  250 postings whose board states a style but whose text does not: the order above is
  right 87% of the time, "On site" alone 70% -- the misses are hybrid jobs. Only
  specific hybrid wording counts as stated ("3 days a week in the office", "hybrid
  schedule"): a bare "hybrid" was wrong 38 times in 89 ("hybrid cloud").
- **Job type is the other** (`shortlist._job_type`, KAN-171): what the posting states,
  then "full_time" for a new-grad role. Measured on the live feed (2026-10-10): 216 of
  216 new-grad roles that state a type say full-time. A stated type always wins, so a
  part-time or contract posting is never turned full-time. It runs in `pick`, not
  `details.read`, so `--offline` applies it to stored postings with no re-read.
  **An internship is never inferred:** the feed row writes every internship as the
  job type `internship` with the level `student` (KAN-233, `feed.py`), whatever its
  hours (decided 2026-10-10: "Full-Time
  Internship" beside "Part-Time Internship" read as two kinds of internship), so a
  guessed full-time would show nowhere. Summer internships were filled for a day (71
  of 74 that state a type say full-time) before that decision.
- **A start term comes from the title first.** "Software Engineer Intern (2027)" is the
  employer's label for its cohort. The description can name the season ("our Summer
  2027 program") or a start month, but only of the title's year; a year alone in a
  description is as likely a founding date. Years are any 20xx judged against
  today (`details._near`: last year to three ahead), so no pattern needs editing
  as the calendar moves. A date range in the title starts at its first month
  ("(January - August 2027)" is January, not the "August 2027" at its end), and a
  title's words skip the deadline guard: Rivian's "Applications" is a team. With no
  year anywhere, a bare month or season stands ("May - August", "As a summer
  intern"), taking the title's year when it has one.

**Audit them against the source, not against each other** (2026-10-08). Every posting
showing a "not listed" fact was re-fetched whole from its board and searched; a few were
opened on the employer's own page too, which never showed anything the API did not.
Most gaps were honest -- 444 of 474 without pay, 267 of 311 internships without a start,
253 of 269 new grads without years state none -- and the rest became the patterns now in
`details.py`, each with its posting's sentence in `tests/test_details.py`
(`TestAuditFindings`). What it taught:

- **A period right after an amount proves pay** ("Intern/Undergraduate: $34/hour"),
  unless the money is something else just before it (`_NOT_PAY_BEFORE`: save, budget,
  401(k), allowance -- "save $40,000 a year" is not pay).
- **A currency can be a code with no symbol** ("800 USD monthly", "34.000 - 38.000 EUR",
  "CAD $30-50/hour"), thousands can be "." ("$120.000"), and a range's low end can be
  short ("€55-65,000").
- **Cents belong to the amount, thousands or not** (`_NUMBER`, 2026-10-10). "$61,900.00
  to $141,000.00" (Booz Allen) read as $61,900 alone: the grouped-thousands pattern
  took no cents, so it stopped at "61,900", and the ".00" left behind ended both the
  range and the tail. On the cached store, re-read from every job posting's whole
  text (and BambooHR's pay field), 96 of 2,392 changed, each read against its
  sentence. 72 cards showing a range's low end now show the range (Booz Allen 42,
  SpaceX 13, Blue Origin 9, BMO 4, Dark Wolf 2, Applied Materials, Carrier). It also
  let 24 Cisco internships misread a company-wide range (next bullet). The tail after
  an amount runs onto the next line, and stays that way: The Aerospace Corporation's
  "$25.00 - $30.00" is proved by "Pay Basis: Hourly" below it. `PAGE_VERSION` went to
  12 so stored pages are read again.
- **A pay word is a whole word, and an amount's own sentence is its label** (`_PAID`,
  `pay`, 2026-10-11). The check used to match inside words: "base" in Cisco's "* For
  quota-based sales roles", the line under its $44,000 to $185,000 range for New York
  and Washington, and "rate" in Valon's "operate our own mortgage servicing business
  managing $110+ billion in loans", read as $110 an hour. Whole words alone cost one
  true read: Toyota Research Institute's "The pay range for this position at
  commencement of employment is expected to be between $45 and $65/hour" names its
  pay 85 characters before the amount, past the 60-character window, and had passed
  only on "California-based". So the amount's own sentence counts too, for the pay
  word only; the period still comes from the near label. On the cached store, 28 of
  2,392 reads changed, each read: Cisco's 24 back to none, Valon's intern to its
  stated $60 an hour (its new grad's card keeps Ashby's own pay field), and Cadence's
  Montreal co-op (two copies, one role) from none to CA$30 an hour, the low end of
  "The hourly range ... is from $30CAD to $45CAD". `PAGE_VERSION` went to 13.
- **A range's low end may carry its unit or code, and "between … and" is a range**
  (`_LOW_END`, `_BETWEEN`, KAN-229, 2026-10-17). "$50/hr - $70/hr" (Tenstorrent),
  "$30CAD to $45CAD" (Cadence) and "between $45 and $65" (Toyota Research
  Institute) each read as the low end alone, so the card printed "$50/hr". "and"
  joins a range only after "between": "$40/hr and a $2,000 stipend" is pay and a
  perk. On the 2026-10-16 snapshot 16 of 1,094 reads changed, each read: every one
  went from its low end to its whole range (Tenstorrent 3, SK Hynix 4, Harvey 3,
  Nuro 2, ZipRecruiter, Toyota Research Institute, Schonfeld, Sphinx Defense), and
  none went the other way. `PAGE_VERSION` 14 covers it.
- **A LinkedIn tag (`#LI-Hybrid`) is the employer's own work-style label** and wins;
  **Hybrid beside On site is Hybrid** (Lyft: "in-office on a hybrid schedule, 3 days
  per week"); naming weekdays onsite is hybrid. Greenhouse boards add a "Working
  Conditions" field, and Lever boards sometimes put "Remote" in `commitment`.
- **"Remote" and "hybrid" block the On-site guess only when they are about work**
  (`shortlist.FLEXIBLE`): "remote battery monitoring" and "hybrid cloud" are not.
- **Measure a pattern change on the whole feed before trusting it:** compare every fact
  before and after, and read every *changed* value, not only the newly filled ones. That
  is how three regressions were caught here (a title range read from its end, a
  currency code before the symbol, "lease" matching inside "please").

### Visa sponsorship (KAN-168)

`Facts.sponsorship` is what the posting says about visas, read by `details.sponsorship`
from the whole description like every other fact (visa lines sit near the end, past
the cut on 635 of ~1,090 stored copies):

| value | meaning |
|---|---|
| `citizens_only` | US citizenship, or a US security clearance (which needs it), is required |
| `no_sponsorship` | the role will not sponsor a visa, or requires a US person (below) |
| `sponsors` | the posting says it sponsors, including a benefits bullet "Visa Sponsorship" |
| `None` | nothing usable, which is most postings |

**It is in `feed.json`.** `feed.row()` writes it and the backend's import stores it in
`job_postings.sponsorship`, so these four values are part of the feed's contract with
`backend/app/schemas/jobs.py`: a new value is a change on both sides. `internships.html`
does not show it. Like every fact, a pattern change reaches Lever and Ashby postings on
the next live run and stored Greenhouse postings only when their page is read again,
which is why `PAGE_VERSION` went to 9 when sponsorship was added and to 10 with the
fixes below.

The rules, each from a posting in `tests/test_details.py` (`TestSponsorship`):

- **Read sentence by sentence; strongest wins.** Citizens only beats no, and no beats
  yes, across the whole posting. "U.S." (and "U.S citizen", and the statute's
  "U.S.C.") is rewritten first, or it would end the sentence. "Must be U.S. citizens"
  counts in the plural (OpenAI).
- **A "U.S. person" is not only a citizen.** ITAR's definition takes green card
  holders, refugees and asylees, so "must be a U.S. citizen, lawful permanent resident
  ... or protected individual" (Astranis, Anduril, Varda) is `no_sponsorship`, never
  `citizens_only`: no visa holder qualifies, but a permanent resident does. When the
  same posting offers an export licence instead ("or be eligible to obtain the
  required authorizations": 58 postings at 17 companies, SpaceX, Rocket Lab and
  Antares among them; Hermeus's "deemed export licensing") it says nothing, since a
  visa holder can still be hired. This is the call that most changes the counts: read
  the other way, those 58 would be `no_sponsorship`. The licence has to follow a
  US-person requirement (in its sentence or the ~300 characters after it), and then it
  answers every such requirement in the posting: SpaceX states one in its
  qualifications and the licence in its ITAR paragraph at the very end. A licence that
  follows none is some other licence ("Help our customers obtain export licenses").
  "Open only to U.S. citizens and other U.S. Persons" (GovSignals) or "... or Green Card
  holders" (Skydio, Proto Labs) is a US-person list too.
- **A clearance counts only when it is US and required.** A US marker (US, Secret,
  TS/SCI, DoD, DOE, Q, polygraph) is needed, because Palantir's UK and Australian
  internships ask for their own countries' clearances. The abbreviations are matched
  in capitals only ("join us"), and customs clearance is a shipment's. "A plus but not
  required", "may be required", "not a requirement", Palantir's "For USG:" scoping,
  and any list headed as optional ("What We Value", "Preferred", "Nice to Have",
  `_under_preferred`) do not count; Palantir's verbless "Active US Security clearance,
  or eligibility ..." does under "What We Require".
- **Only the nearest heading decides.** `_under_preferred` walks back to the first
  heading-like line: one ending in a colon, one naming a list ("Requirements", "What Is
  Required", "Strongly Preferred"), or one in capitals (Valinor's "WHAT VALINOR
  OFFERS"). A bulleted line, or one grading itself in lower case (CGS's "- Experience
  with Salesforce preferred", ERG's "PE license is preferred"), is an item, never a
  heading. "Values" is a company's values unless it ends in a colon.
- **OPT and CPT are not sponsorship.** They are the student's own authorization, so
  "OPT/CPT eligible" and Akuna's "including F-1 students using OPT" are `None`, and so
  is a sponsorship that names only them or says "OPT/CPT only" (`_opt_only`). One that
  names an employer's visa beside them stands: Ambrook's "(OPT/CPT, TN, J-1)", Jump
  Trading's "we sponsor work visas". They are read as capitalised whole words, which
  keeps "optimised" and "adoption" out.
- **Statements about this role only.** "Sponsorship for an export license"
  (Cloudflare), "company-sponsored events", "available for selected roles" (Maven),
  "Certain roles may require U.S. Person status" (Rivet) and IMC's rule for
  candidates from Russia, Belarus or Iran (IMC otherwise sponsors) say nothing. Jump
  Trading's "we sponsor work visas for full-time positions" is `sponsors` on its
  full-time postings and `None` on its internships, which is why the function takes
  the title. An internship is "intern", "co-op" or a season in the title ("Summer
  Analyst"); a year alone is not, since new-grad titles carry one too.
- **Negations need their sponsor word, in the same clause.** "We are not able to
  sponsor visas or take over sponsorship" (Enova) is a no that a loose "able to sponsor
  visas" read as yes; Samaya's "aren't able to successfully sponsor visas for every
  role" right after "We do sponsor visas!" is not a no. A negation stops at a comma
  that starts a new clause (Corvus's "preferred but not required, can sponsor visas"
  is a yes) but not at one around an aside ("We are not, at this time, able to sponsor
  visas" is a no; stopping at every comma read it as a yes), and "whether or
  not" and "without regard to sponsorship status" are not one. "Candidates who require
  sponsorship will not be considered" is a no; "when sponsorship is unavailable"
  (Xsolla, on gas fees) is nothing.
- **A need is the candidate's only before the offer.** "Candidates who require
  sponsorship" offers nothing, but Frontier Health's "we are able to sponsor visas if
  required" and n8n's "We can sponsor visas to Germany; ... you need to have existing
  right to work" do, and so does Wordware's "We require US work authorization, but are
  open to O-1 or J-1 visa sponsorship" (the need is past a comma).

Measured 2026-10-09 on a live `--full` run, from each posting's whole text: of 1,103
roles on the feed, 62 `citizens_only`, 97 `no_sponsorship`, 37 `sponsors` and 907
`None`, the same before and after the fixes above (every `sponsors` and
`citizens_only` posting and 30 `no_sponsorship` ones were read against their sentence
in the first pass). The fixes were measured on every description that run read, 38,732
including the boards' senior and non-software roles: 140 changed, every one read, all
judged right (53 to `sponsors`, mostly n8n and Wordware; 70 to `no_sponsorship`, Proto
Labs, GovSignals and Skydio's US-person lists; 17 to `citizens_only`, CGS, ERG,
Valinor and OpenAI). Two first drafts were caught this way: a 60-character limit on
verbless items dropped dozens of real "U.S. Citizenship and ability to obtain ..." lines, and
an export licence counted only beside its sentence lost SpaceX's and Revel's. Known
misses, left as `None` on purpose: a requirement list with no heading and no verb that
could be either list; "authorized to work in the US now and in the future" with no word
of sponsorship.

**`TestConstructedGuards` is the one exception to "seen in a real posting":** KAN-168's
review found bugs with sentences built to show them, and where no live posting said it
that way the built sentence stays, in that class only, as a guard. The cents fix added
one: "$50,000.00 - $70,000", cents on one end only, which no cached posting wrote.
