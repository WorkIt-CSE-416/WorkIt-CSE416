# Workday: how its company job boards are read

How Workday is read, what its API does, and why its boards take several runs to go round. Reached from `../CLAUDE.md`, "How it fits together" and "Adding a provider".

## Workday (KAN-134)

Added 2026-10-10. Workday is what most large and non-tech employers hire through:
the curated lists name 1,700 Workday boards (on ~1,475 companies; a company can run
several careers sites, Boeing 40), against 2,128 for the six other providers
together, and about 17,500 of their ~37,000 apply links point at it. A board's
address is `{tenant}.wd{N}.myworkdayjobs.com/{site}`, so its token is
`{tenant}.wd{N}/{site}` (`nvidia.wd5/nvidiaexternalcareersite`): all three are
needed to reach it. Links on `wd{N}.myworkdaysite.com/recruiting/{tenant}/{site}`
name the same board and are read on the tenant's own host.

**It is not a documented public API.** The list is what the careers page itself
calls, `POST /wday/cxs/{tenant}/{site}/jobs` with `{"appliedFacets": {}, "limit":
20, "offset": n, "searchText": ""}`, and a posting's record is `GET` on its path
under the same prefix. Accepted as a risk, like Workable's per-posting page: if
Workday changes it, the Workday lane fails loudly and the other providers carry on.
What it does, measured on every board on 2026-10-10:

- **20 postings a request**, and a larger `limit` is a 400. The count (`total`)
  comes on the first page only; later pages say 0.
- **The count stops at 2,000.** A board answering exactly 2,000 is capped (NVIDIA
  has 2,676), and an offset past 2,000 returns the first page again. Boards that
  report more (Northrop Grumman, 3,740) page past it. 39 boards were capped.
- **`searchText` is no filter we can trust.** It searches descriptions too
  ("intern" finds "international"), and against a full read of 105 boards it missed
  182 of 1,061 early-career titles and 18 of the 209 postings we keep (Elevance's
  "Information Security Co-Op Internship", ASML's internships). It also saved only a
  third of the requests. So no Workday board is read by search.
- **A posting's record has `startDate`, which is the day it went up**, not when the
  job starts: it matched "Posted 3 Days Ago" on every posting compared. The list's
  `postedOn` is only relative ("Posted Yesterday", "Posted 30+ Days Ago").
- Unknown tenant, or the right one on the wrong `wd{N}`: a 422, read as "no such
  board". A careers site that does not exist: a 404.

**Each board is read whole or not at all** (`providers.workday`), which keeps
"Nothing closes" true: every page is read, and the read counts only if the distinct
postings add up to the count Workday gave; otherwise it raises `Incomplete` and is a
failed read, evidence of nothing. A capped board is read in slices by one of its own
filters (`_workday_slices`): a filter whose counts add up to the real size, which two
filters must agree on, with no value itself at 2,000 (NVIDIA: 15 job families, the
largest 1,723). 22 of the 39 capped boards split this way (Abbott, Booz Allen,
Applied Materials, Leidos, PNC, T-Mobile, NVIDIA); the rest (Walmart, Target,
Airbus, Hitachi Energy, Sysco, ...) are skipped as "too large to read whole". So is
any board past `WORKDAY_MAX` (5,000 postings, 250 requests): Accenture, Dollar Tree,
CVS, TJX and other retail and hospital chains. 20 boards in all.

**A run reads as many boards as fit in its `Provider.budget_s` (12 minutes)**,
least recently read first (`Store.to_read`), and leaves the rest for a later run
(`Outcome.DEFERRED`, "left for a later run"). The 1,469 boards we can read hold
about 432,000 postings: some 22,000 requests, close to an hour at the eight a
second the lane sustains (ten is the pace's cap), against a workflow timeout of
30 minutes. A deferred board is simply not read: its postings stay listed as
they were, its `last_read_at` does not move, and it is first in line next run. A
board started in time is always finished, so no read is cut short. The first run
read 439 boards, so at a run every three hours each Workday board is read about
every four runs, twelve hours, and the quiet-board rest still applies on top. The
cost, accepted: a new posting on a Workday board can reach the page about half a
day late, and a closed one stays listed as long.

**Politeness.** Every tenant has its own robots.txt, and none forbids the API path,
but most name their careers sites (`Allow: /NVIDIAExternalCareerSite/`), and on 141
of the 1,700 boards they `Disallow` the very site the lists link: Caterpillar's
`/CaterpillarCareers/`, Citi's `/2/`, CACI's, eBay's, Equinix's, BlackRock's early
careers, Expedia's `private`. Reading such a site through the API would read what
the employer asked crawlers to leave alone, so `providers.robots_urls` checks the
careers site as well as the API, and those boards are skipped. Workday's paths are case-blind, and so is our reading of its
robots.txt (`polite.FOLD_CASE`): the lists link `/caterpillarcareers/` as often as
`/CaterpillarCareers/`. Its robots.txt files are read as the lane reaches each
host, not up front: one paced request each, and only for the boards a run reads.
All of Workday is one pace (`polite.SHARED_PACE`), ten requests a second. A 429 is
retried once (5 boards answered one on the first sweep).

**The card's facts.** Job type is `timeType` ("Full time") through
`details.job_type_label`. Work style is `remoteType`, which each employer words its
own way (~80 wordings seen: "Onsite", "Partially Remote", "Office Worker (NOT
Remote)", "Remote work is not available"), read by `_workday_work_style`: a refusal
of remote is on site, any hybrid is hybrid, then remote, then on site; most postings
have none, and the usual rules decide. Location is the list's `locationsText`,
except "3 Locations", which is no place: the record's `location` and
`additionalLocations` are joined with "; " into one (`Page.offices`), as Workable
joins its rows. Kept apart, the card would say "3 locations" and the backend's
resolver, which splits on ";", would find no place: it found none for 116 of the
first 664 roles before the join and for 13 after, "Remote" and site names
(Cleveland-Cliffs' "Rockport Works"). Pay is read from the description (Bose's
"$21.15-$29.09 per hour"). Workday has no department field we read.

**The logo is the company website's favicon.** Each careers page names a logo
(`/{site}/assets/logo`), but it is the site's banner, not a square: NVIDIA's is
1200x627, Boeing's 1600x400. Micron's is an SVG, which next/image refuses without
`dangerouslyAllowSVG`, and Salesforce's and Disney's come as `text/plain`, which it
may refuse. So the logo reader reads the careers site's settings instead
(`GET /wday/cxs/{tenant}/{site}/approot`, what the page draws its header from) and
takes the website they link (`logos.md`). On 120 boards sampled on 2026-10-19, 112
answered and 80 of those gave a website.

**A job on two careers sites is one role.** Autodesk lists its interns on `ext`
and `uni`, Cadence on up to three sites, BMO and CIBC on `campus` and the main
site, each copy with its own apply URL. Workday calls the job a requisition and
each copy a posting of it, so `shortlist.pick` merges Workday postings with the
same company, tenant and requisition number (`_requisition`) into one role with
every copy's places. It is the one exception to "each URL is its own job"
(`../CLAUDE.md`, Adding a provider): only Workday, and only the same number at
the same company.

- **The number is the record's `jobReqId`** (`Page.requisition`, from
  `describe_workday`). It was on all 659 records read on 2026-10-10. The path is
  no substitute: it ends in a slug of the number plus a posting number
  (`..._26WD100002-1` on `ext`, `..._26WD100002-3` on `uni`), which no rule splits
  from a number that ends in digits itself (Amgen's `R-257526`, BorgWarner's
  `R2026-3965`: stripping `-digits` made 9 Amgen roles one), and the slug is not
  always the number (Baxter's `JR - 211071`, DMA's `REQ: 636`). The list's
  `bulletFields` show whatever the employer chose to show there. A posting whose
  record was not read has no number and stays its own role.
- **The role links the student site** (`_lead`): the copy whose site name says
  it is for students (`STUDENT_SITE`: `uni`, `univ_careers`, `campus`, `intern`,
  `us_early_talent_site`, and run together as in `bpearlycareers`), never a
  `private` one, then the oldest copy, then the first URL, so the link holds from
  run to run. The employer made that site for exactly this applicant, and the
  choice loses nothing: 35 of the 36 merged requisitions read word for word alike
  on every site, and Autodesk's Oslo role differs only in each site's footer.
  Nothing else prefers one; the curated lists link both copies. The role's title,
  description and facts are that copy's.
- **Measured on the 2026-10-10 store**, with every kept posting's record read
  again: 38 of the 664 Workday roles were a second copy, of 36 requisitions
  (Autodesk 25, Cadence 7, BMO 2, Boeing 2, CIBC 1, Becton Dickinson 1), now
  merged (2,387 roles to 2,349). The links went to `uni` 25 times, `univ_careers`
  4, `campus` 3, one each `university_talent`, `intern` and `us_early_talent_site`,
  and once `external_careers` (Boeing's, beside its subsidiaries' site). Every
  merged pair had one title and one place. The earlier "80" counted titles:
  Booz Allen's look-alikes on `bah_jobs` and `confidential` are different
  requisitions, so different openings, and stay apart, as do 79 roles that share
  a title with another requisition at their company (five of Autodesk's
  Singapore interns, like Stripe's offices).
- **`PAGE_VERSION` went to 11** for the number, so the next live run reads each
  stored Workday posting's record once more (and, as any bump does, each kept
  Greenhouse, Workable and BambooHR page).

**What the first run added** (2026-10-10, on the day's store, so every Workday
board was new and the run read them from the front of the alphabet):

| | |
|---|---|
| Workday boards due | 1,700 |
| read whole | 439, four of them capped and read in slices (Abbott, Applied Materials, Beth Israel Lahey, Booz Allen) |
| skipped | 43 by robots.txt, 9 too large |
| no such board / failed | 12 / 3 (two 403s; AT&T's linkless row, since counted) |
| left for a later run | 1,194 |
| postings scanned | 116,025 |
| kept | 664 (0.6%): software 291, data and AI 151, hardware 149, product 41, quant 32 |
| facts filled | job type 654, work style 621, start 365, pay 281, sponsorship 227 |
| run time | 14.8 minutes, against 3.3 for the same run without Workday |

The Workday lane spent its 12 minutes and 2.5 more finishing the boards in flight
and reading the 664 kept postings' records, at about eight requests a second. The
other providers' lanes finished inside it, so Workday adds about 11.5 minutes a run.
