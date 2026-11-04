# Logos

How a company's logo is found and which hosts are allowed. Reached from `../CLAUDE.md`, "Logos".

## Read once per board

A live run reads the board page -- the listing API carries no logo -- of every board
with a job on the page that `Store.logos` has not seen (plus, for a Greenhouse board
with no logo, its job descriptions), and keeps the answer: a URL, or
`null` for a page with no logo. Logos almost never change, so nothing re-reads a
logo found, except once for an upload stored with no website (below, "The
company domain"); delete `logos` from `jobs.json` to read them all again. A page that failed
to load records nothing, so the next run retries it; a 404 is a page with no logo,
which still goes on to the descriptions below.

**Raise `logos.VERSION` whenever the reader learns a new place to look.** The next
live run then forgets every stored `null` and reads those boards again, once
(`store.reread_missing_logos`); `jobs.json` keeps the version in `logos_version`.
Without it a new rule never reaches a board already read: on 2026-10-19 True
Anomaly's descriptions named trueanomaly.space, but its `null` from before the
descriptions were read was still in the store. Version 2 added BambooHR, the
Greenhouse logo link and Lever's footer, descriptions and dash host. `internships.html` shows no logos -- it
must render with the network off.

No uploaded logo -- or an Ashby one under 64px, which blurs in the 80px tile (Bedrock
uploaded 50px) -- and the logo is the company website's favicon via Google's favicon
service, which answers 404 (so the card's initials) for a site without one. The website
must come from the board: Ashby's `publicWebsite`, a Workable account's `url`, a
Workday careers site's `homePageURL`, a Lever board's footer link ("Zoox Home Page"),
a Greenhouse board's logo link (`boardConfiguration.logo.href`, set even with no
image: BGE, AccuWeather), a Greenhouse or Lever board's job descriptions (Scale AI,
Vercel, Aircall), or where the board redirects (Stripe). Lever's descriptions come
from its postings API (`logos.LEVER_JOBS`), which stays public when a company hides
every jobs.lever.co page (Aircall, Latitude: 404). The logo link, descriptions and
redirects only count when the domain's name is in the board token or company name
(`logos.stated_site`) -- descriptions also link eeoc.gov and TikTok, Accenture's
board redirects to a Salesforce host, and OH.io's logo links a wallpaper on
files.slack.com. Never a website guessed from the company name:
"Workshop" is not workshop.com. A board that gives us nothing usable (Moment Energy: a
banner and no links; Waymo: a 32px careers-site icon) can be listed in
`checked_websites.csv` (`logos.CHECKED_WEBSITES`), which wins over everything --
but only after the checks under "Checked websites" below.

**`Provider.logo_pattern` only accepts each ATS's own image host, `favicon` only Google's, and
those hosts must match `frontend/next.config.ts`'s `images.remotePatterns` exactly.** `next/image` throws on
any other host, which fails the whole Jobs page, not one card. Greenhouse is read from
`job-boards.greenhouse.io` because `boards.` redirects there cross-origin; Lever's
`og:image` is a 1200x630 banner, so its header `<img>` is used instead, from either
form of its bucket's host (older uploads use `s3-us-west-2`, Daniels Health). Workable's
board page is a script shell, so its logo is read from the account JSON
(`/api/v1/accounts/{slug}`): `logo` on `workablehr.s3.amazonaws.com` under
`/uploads/account/logo/`, never its `open_graph_logo`. It is 120px tall, a square or
a wordmark up to 720 wide (17 of the first 25), which the card letterboxes like any
other wordmark. Recruitee has no `logo_page` at all (`providers.md`).

**BambooHR's logo is in its careers page's JSON** (`"logo":{"url":...}` in
`poData`, slashes escaped), read from `{slug}.bamboohr.com/careers`. On 2026-10-19,
41 of the 42 boards had one (ConeTec's is `false`): 36 to 120px tall, mostly
wordmarks, some as small as 30x36 (BinSentry), which blurs but beats initials. They
come from `images3`/`4`/`7.bamboohr.com`, a company's own subdomain
(`/manage/logo/`) or `pandabox.bamboohr.com`, so next.config.ts allows
`*.bamboohr.com`. All are PNGs served as `application/octet-stream`; next/image
sniffs the bytes, not the header (checked against Next 16.3.3's optimizer). Its
careers JSON names no website.

## Still initials

On 2026-10-19 the production API had 296 Greenhouse, Lever and BambooHR jobs
with no logo (185, 37 and all 74); version 2 finds one for 157 of them, every
BambooHR job among them. What is left gives nothing usable:
Greenhouse boards with no image, no logo link and no matching site in the
descriptions (Arc, MEMX, Muon Space), or a site whose name does not match
(Graviton's logo links gravitontrading.com, AgWest's descriptions agwestfc.com, VAST
redirects to vastspace.com), and Latitude on Lever. Those go in
`checked_websites.csv` only after the checks under "Checked websites" below.

**Workday gives only a website.** Its logo is a wide banner (`workday.md`), so
Workday has no `logo_pattern`, and no Workday image host is allowed. The
page read is the careers site's settings JSON
(`/wday/cxs/{tenant}/{site}/approot`). Its header's `homePageURL` is the "Home"
link the employer set: trusted like Ashby's `publicWebsite`, unless it points back
at Workday (Arlo's, Intel's), whose icon is not the company's. With none, the
whole JSON goes through `stated_site`, which finds a privacy policy on the
company's site (kbr.com) and skips one on a vendor (Barclays' on talentbrew.com).
It matches on the tenant, not the token: a site named `careers` must not make
careers.com the company's site. On 120 boards sampled on 2026-10-19, 112 answered
and 80 gave a website (57 a home page, 23 a privacy policy or other link). A home
page is often a careers site (careers.mars.com, hntb.jobs), whose icon is the
company's, though some are only 16px. Each tenant's robots.txt is read when a
worker reaches it, not up front, as in the scrape itself.

## The company domain, for the Jobs page's logo

**The card draws its logo from Brandfetch by the company's own domain**
(KAN-442): the feed row's `company_domain`, written by `logos.company_domain`
when the feed is written. It is the checked website when the board has one, else
the website the board named (`Store.websites`), else the website the board's
favicon came from, cut to the registered domain (`logos.registered_domain`:
`careers.gevernova.com` becomes `gevernova.com`). A hiring vendor's site gives
none (`VENDOR_DOMAINS`): Micron's home page is `micron.eightfold.ai`, and
Brandfetch drew Eightfold's logo for it. The value must pass the backend's
CHECK (`DOMAIN`, migration `d9b579e66623`).

**The reader keeps a board's website beside an uploaded logo too**
(`Store.websites`, `logos.website`). Until 2026-11-03 it kept only the image, so
an upload gave no domain and its card kept the upload: on that day 4,238 jobs at
865 companies, mostly Lever, Ashby and Greenhouse. For a board with an upload it
now also looks where it looks for a board with none: the website the page names,
then (Greenhouse, Lever) the logo link and descriptions, or where the board
redirects. **A board read for an upload before websites were kept is read once
more** (`logos.needs_read`: an upload and no `websites` entry), with no `VERSION`
bump; that re-read also picks up a logo the employer uploaded again. Beside an
upload, a 404 for the descriptions records no website, so the board is not read
on every run; a failed read leaves it for the next run. On 15 real boards with
an upload, 12 gave a domain: every Ashby and Lever board, 2 of 5 on Greenhouse.

In a test on 2026-10-29, Brandfetch drew 98 of 100 of our companies at 180 to
400px (the favicons were 16 to 128px). Its misses were careers-site domains
(`amentumcareers.com`, `highmarkhealth.org`), and a careers site's logo can be
its careers banner (`uline.jobs`): the checked list fixes those.

## Checked websites

`checked_websites.csv` holds each board's company website where the board names
none, or the wrong one (a careers site, a hiring vendor), keyed by board
(`ats/token`; an iCIMS token is the host's first label, `careers-kimley-horn`).
It reaches boards the reader never reads for a logo (iCIMS, Oracle) through
`company_domain`. **A row goes in only after the checks** (KAN-442, in place
of "a person opens every site"): a script
checks that the site loads and that its name matches the company or the board
(`goldmansachs.com` for Goldman Sachs, `ti.com` for Texas Instruments' initials;
or the page's title names the company), and a person opens every row that fails.
Never a website guessed from a name with no check: in the first batch, the
guess for "Global Infrastructure" was an investment firm, and its jobs were a
Canadian design firm's. The first batch was the 100 companies with the most
jobs showing initials: 95 passed, 5 went to a person (renamed firms, a typo in
our data, a board host that names another company). The second batch
(2026-11-04) was the 20 employers with the most jobs and no `company_domain`
(10,498 of 17,577 such jobs, H&R Block alone 5,789), plus Garmin: 17 passed.
H&R Block, Keysight and Nestle refuse scripts (403, or a Cloudflare
challenge) and Gallagher's home page is empty to one, so each was checked in a
browser and by the logo Brandfetch draws for it, and its row's note says so.
A site that refuses scripts is no reason to leave a row out: Brandfetch's own
logo for the domain is a second check that the domain is the company's.

## The board's own address, checked by the scraper

After the batches, 7,089 jobs at 811 companies still had no domain, most on
Workday (2,266), Jibe (1,305), Oracle (1,049) and SuccessFactors (1,044), whose
boards name no website. Rows by hand did not scale, so **the scraper now runs
the script check itself, once per board, on the domain the board's own address
gives** (`logos.board_address`, `logos.check_addresses`, kept in
`Store.addresses`):

- **A Jibe or SuccessFactors board** lives on the company's careers site
  (`careers.garmin.com`, `jobs.mcdonalds.com`), so its host's registered domain
  is the company's: evidence, not a guess. It passes when the domain's name is
  in the company's name or starts with it (`chsinc.com` for CHS), the company's
  initials start it (`gxo.com`), or the home page's title names the company's
  first word. A host on Jibe's own `jibeapply.com` gives none (`VENDOR_DOMAINS`).
- **A Workday tenant** is the name the company chose for its Workday account,
  so `{tenant}.com` is only a guess. It passes only when the home page's title
  holds the company's whole name, of two words or more: `sbdinc.com` is
  "Stanley Black & Decker", `cbrands.com` "Constellation Brands". A one-word
  name is in too many titles: in the first run `denver.com` was Denver Media,
  not the City of Denver, and `nexstar.com` a web host, not Nexstar Media.
  `yale.com` sells locks; Yale University's tenant is `yale`.
- **The home page is read at `www.` first.** Most bare domains redirect there,
  their robots.txt too, and `web.get` refuses a redirect to another host, so
  the bare domain read as robots.txt refusing us: on 2026-11-04 that failed 21
  of 30 sampled boards (viasat.com). A redirect between hosts of the same
  domain is followed; any other is not.
- **A board is checked once.** A pass or a fail is kept; a site that did not
  answer at all is asked again the next run. A person's row in
  `checked_websites.csv` wins over either.

On 2026-11-04 the check proved 133 of the 404 boards with an address to try:
58 Jibe, 38 SuccessFactors and 37 Workday, 1,941 of the 7,089 jobs. Most fails
are a site that refuses scripts or a Workday tenant that is not the company's
`.com`. A few that passed are careers-only domains (`osfcareers.org`,
`cakecareers.com`), whose Brandfetch logo can be a careers banner; a checked
row fixes one.

**Everything left is flagged each run**: `metrics.json`'s
`boards_without_domain` (and the run's log, top ten) lists each board whose
roles go out with no domain, most roles first, with `tried` true when its
address failed the check. A person takes the top of that list, finds and
checks the website as above, and adds a row to `checked_websites.csv`; never a
change in the database, which the next import overwrites from the feed.
Oracle, Greenhouse and iCIMS boards have no address to try, so they reach a
logo only that way.
