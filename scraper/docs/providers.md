# Providers — notes per hiring system

How each of Workable, Recruitee, BambooHR, Oracle, TikTok, iCIMS and SuccessFactors is read, and the quirks found adding them. Reached from `../CLAUDE.md`, "Adding a provider"; Greenhouse, Lever and Ashby are documented in `providers.py` itself, and Workday in `workday.md`.

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

Workable's and BambooHR's logos are read (`logos.md`); BambooHR's careers page
carries its logo as JSON, served as `application/octet-stream`, which next/image
accepts because it sniffs the bytes. Recruitee's sits inside a 1 MB board page for
the one board we read, so its cards show initials.

## Oracle, TikTok, iCIMS and SuccessFactors (KAN-369)

Added 2026-10-26, so the internships on the systems batch apply is learning to fill
reach the catalog at all. Ranked by their share of the SimplifyJobs Summer 2027
list's active postings: Oracle 9.4%, TikTok/ByteDance 8.8%, iCIMS 4.3%,
SmartRecruiters 2.2%, SuccessFactors 1.8%. Each reader pages, and each read is whole
or nothing (`Incomplete`), as Workday's is. Tests: `tests/test_more_providers.py`,
on that day's responses in `tests/fixtures/providers/`.

- **Oracle Recruiting Cloud** reads the search its candidate site calls,
  `hcmRestApi/resources/latest/recruitingCEJobRequisitions` (no sign-in), 200 a
  request, and a kept posting's description from `recruitingCEJobRequisitionDetails`.
  A board is `{pod}/{site}` (`ecnf.fa.us2/CX`), the only token whose case is kept:
  the site number goes into the apply link. `hasMore` says false mid-board, so the
  reported `TotalJobsCount` decides when to stop. A site number the pod lacks is a
  search counting 0, so it reads as an empty board. Pods answer robots.txt with a
  404 (no rules); they share one pace (`polite.SHARED_PACE`).
  The first live run found two things the count does not tell: it often runs one
  to three over what the search serves (ebwg.fa.us2/CX: 115 counted, 113 served on
  one page of 200, nothing past it), so a read whose last page came back short and
  never overlapped is whole; and the search serves nothing past an offset of 10,000,
  so a bigger board is `TooLarge` (egud.fa.us2, ejwl.fa.us2).
- **TikTok** is one board, `tiktok/lifeattiktok`: the POST lifeattiktok.com's own
  search makes, which answers "invalid request" without a `website-path: tiktok`
  header. About 4,300 postings, 200 a request, with descriptions; no date.
  ByteDance's own site, jobs.bytedance.com, is a separate list and timed out from
  here (as it did headless in SYSTEMS-gap), so it has no reader.
- **iCIMS** is read where the curated lists link it: a company's Jibe careers site
  (`careers.amd.com/jobs/{id}?icims=1`), whose `/api/jobs` lists every posting with
  its description, 100 a request. The board is the site's host. Only rows Jibe
  marks `ats_code: icims` are kept. Jibe sites publish `Crawl-delay: 5`. A site can
  list one posting twice (MasTec: 1,258 rows served, 1,211 postings), so the rows
  served must add up to the count, and a twice-listed posting is kept once. Bare
  `{tenant}.icims.com` boards are not read: 2 of the lists' active postings link one,
  and their search page is HTML in an iframe.
- **SuccessFactors** is read from a career site's own search page
  (`jobs.grainger.com/search/?q=&startrow=N`), HTML, as many rows a page as the site
  set (Grainger 35), and a kept posting's page for its description and exact date.
  The board is the host the lists mark `?ats=successfactors`. The search is sorted
  by title: in its default order Hershey's repeated 8 postings across pages and
  left 8 out, and by title all 328 were read once. Its count can run over what it
  serves, as Oracle's does, so a read that reached an empty page with no overlap
  is whole. Its robots.txt
  disallows the RSS feed (`/services/`), so the search page is the only list.
  A posting's id is its path, as on Workday: a bare id redirects to an error page.

Not read: **SmartRecruiters** (robots.txt disallows us, above); **Waymo** needs
nothing new, since its postings are on the Greenhouse board `waymo` (build_boards'
`EXTRA`), linked to its own careers site.
