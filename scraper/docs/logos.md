# Logos

How a company's logo is found and which hosts are allowed. Reached from `../CLAUDE.md`, "Logos".

## Read once per board

A live run reads the board page -- the listing API carries no logo -- of every board
with a job on the page that `Store.logos` has not seen (plus, for a Greenhouse board
with no logo, its job descriptions), and keeps the answer: a URL, or
`null` for a page with no logo. Logos almost never change, so nothing re-reads a
logo found; delete `logos` from `jobs.json` to read them all again. A page that failed
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
`logos.CHECKED_WEBSITES`, which wins over everything -- but only with a site a person
opened and confirmed is the same company.

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
`CHECKED_WEBSITES` only after a person opens the site and confirms it is the same
company.

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
