# Providers — notes per hiring system

How each of Workable, Recruitee and BambooHR is read, and the quirks found adding them. Reached from `../CLAUDE.md`, "Adding a provider"; Greenhouse, Lever and Ashby are documented in `providers.py` itself, and Workday in `workday.md`.

## Workable, Recruitee and BambooHR (KAN-171)

Added 2026-10-10. All three allow us: `apply.workable.com` disallows nothing, each
`{company}.recruitee.com` only `/v/` and each `{company}.bamboohr.com` only its embed
scripts. Each reader's test (`tests/test_providers.py`) is built from that day's real
responses.

What they added that day, on a run with no store yet (so every board read): the
curated lists named 178 Workable boards, 42 BambooHR and 2 Recruitee (1X has since
left Recruitee), and all the rest answered. They held 4,858, 1,487 and 58 postings,
and 34, 18 and 0 roles reached the feed (of 1,217). Recruitee is that small because
nine of the lists' ~37,000 apply links point at it, at two companies; it stays
because a board costs one request a run. The run took 3.4 minutes
the second time, still Lever's pace; the 45 extra robots.txt reads add 7.5 seconds up
front, read one after another.

- **Workable** lists through the careers widget Workable documents for embedding
  (`/api/v1/widget/accounts/{slug}`) and reads a kept posting's page from
  `/api/v2/accounts/{slug}/jobs/{shortcode}`, what its own careers page reads. Only
  the page says hybrid (`workplace`) and pay (`salary_from`, `salary_to`,
  `salary_frequency`); the widget has just a `telecommuting` flag. The widget lists
  a job once per location under one shortcode (Trexquant's C++ engineer: a Stamford
  row and a New York row), so rows are merged on it. A location marked `hidden`
  stays hidden, though the row's top-level city still names it (Hugging Face's
  "EMEA Remote" roles hide Paris). `published_on` is the date, not `created_at`:
  Flexcompute's CFD developer was created in 2024 and posted in 2026.
- **Recruitee** sends everything in one list (`/api/offers/`). The location is the
  place names the employer typed (`locations[].name`); the split city and state
  beside each are a form's defaults (Hard Rock Digital's "United States" has the
  city "United States" in Florida), and `location` is just "Remote job" on any
  remote posting. Three work-style flags can be set together; remote wins, since a
  job that may be done remotely is what a remote filter is for. Salary amounts are
  strings. A company that left Recruitee (1X) still answers `/api/offers/` with a
  404, but its robots.txt redirects to recruitee.com, which `polite` reads as
  disallow, so such a board shows as "skipped, robots.txt disallows us", not "no
  such board". Harmless (it has nothing to list) and left that way.
- **BambooHR** lists `/careers/list` and reads a kept posting's
  `/careers/{id}/detail` for its description, `datePosted`, `locationType` (`0` on
  site, `1` remote, `2` hybrid: read off postings that say which) and
  `compensation`, which is free text ("$90,000 to $115,000", "$25-$30/hour"): it is
  given a "Compensation:" label and read by `details.pay`. A slug that is not a
  board redirects to www.bamboohr.com instead of a 404, which `bamboohr()` turns
  into `BoardNotFound`.

Only Workable's logos are read (`logos.md`). BambooHR's header logo is served as
`application/octet-stream` from numbered hosts (`images7.bamboohr.com`), which
next/image may refuse, and Recruitee's sits inside a 1 MB board page for the one
board we read; their cards show initials until someone checks both.
