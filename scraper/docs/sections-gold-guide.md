# The gold test set's labeling guide

You are building a gold test set for a job-description parser. For every line of
every posting in your packet, decide which ONE section it belongs to **by what it
says**, as a careful human reader would. Ignore how the employer formatted it.

## The eleven sections

| Label | What belongs there |
|---|---|
| `company` | The company: what it does, its products, mission, values, culture, funding, investors, customers, size, history, awards, "why join us" pitches about the company in general, "About <Company>" text. |
| `role` | What this role or team is, in summary: the team's purpose, a narrative overview of the job, what the intern/new grad will broadly work on, the program's structure described as an overview, "About the role". |
| `responsibilities` | Specific duties and tasks the hire will do, or what they will learn/do on the job ("Develop features", "Write tests", "What you'll learn: X"). Usually verb-led items. |
| `requirements` | Must-have qualifications and eligibility: degree or enrollment, graduation date, years of experience, required skills, work authorization, citizenship, export-control eligibility, must be able to relocate/travel/work on-site, language requirements. |
| `preferred` | Nice-to-have qualifications: "preferred", "bonus", "nice to have", "a plus", "ideally". |
| `pay` | This role's pay: salary or hourly ranges and amounts, how pay is structured (base + bonus + equity amounts), "the pay range for this role is…". A pay-transparency sentence that STATES an amount is `pay`. |
| `benefits` | Perks and benefits: insurance, 401(k), PTO, parental leave, stipends for meals/commute/equipment, wellness, relocation assistance offered, equity as a general perk without an amount, company events. |
| `logistics` | Where and when: location, office, hybrid/remote arrangement, schedule, hours per week, start date, term dates, duration, hiring timeline, program dates. |
| `apply` | How to apply and the hiring process: application steps, interview stages, referral instructions, deadlines to apply, what to submit. |
| `legal` | Boilerplate notices: equal opportunity / EEO, accommodations, privacy notices, fraud/scam warnings, background-check notices, E-Verify, pay-transparency boilerplate WITHOUT an amount, AI-use notices, LinkedIn tags like "#LI-Hybrid", state-specific applicant notices. |
| `intro` | Use ONLY for a posting's very first lines when they are a generic tagline that is neither about the company nor the role (rare). Prefer `company` or `role` whenever the line is about one of them. |

## Rules

- **Heading lines** (short titles like "What You'll Do", "About Us:", "Benefits") get the
  label of the content they introduce. "Products we've built to make an impact:" introduces
  the company's products, so it is `company`, even though it says "impact".
- **One label per line.** If a line mixes two things, pick what most of the line is about.
  A sentence that mainly states pay is `pay` even if it mentions benefits.
- **Judge each line on its own merits**, not by the heading above it. A pay sentence sitting
  under "Benefits" is still `pay`; an EEO sentence under "Requirements" is still `legal`; a
  company blurb under "Responsibilities" is still `company`.
- Export control: "must be eligible to access export-controlled technology", ITAR/US-person
  requirements are `requirements` (the student must meet them). A generic export-control
  compliance notice with no requirement on the applicant is `legal`.
- Hiring timelines and term dates are `logistics`; interview steps are `apply`.
- "What you'll learn" items are `responsibilities`. Mentorship/program perks offered TO the
  intern ("you'll get a mentor", "intern events") are `benefits`.
- Bullet items listing team names or product areas are `company` if about the company's
  products, `role` if describing the teams this role could join.
- Do not invent labels outside the eleven above.

## Adding postings

Label every non-blank line of a new posting with this guide, blind (without
running the parser), and add it to `tests/fixtures/sections_gold.json`: its
`text` and a `labels` list as long as `text.split("\n")`, null for each blank
line. Then run the report (`tests/test_sections_gold.py`'s docstring) and adjust
the floors only upward.
