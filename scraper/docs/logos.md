# Logos

How a company's logo is found and which hosts are allowed. Reached from `../CLAUDE.md`, "Logos".

## Read once per board

A live run reads the board page -- the listing API carries no logo -- of every board
with a job on the page that `Store.logos` has not seen (plus, for a Greenhouse board
with no logo, its job descriptions), and keeps the answer: a URL, or
`null` for a page with no logo. Logos almost never change, so nothing re-reads them;
delete `logos` from `jobs.json` to read them all again. A page that failed to load
records nothing, so the next run retries it. `internships.html` shows no logos -- it
must render with the network off.

No uploaded logo -- or an Ashby one under 64px, which blurs in the 80px tile (Bedrock
uploaded 50px) -- and the logo is the company website's favicon via Google's favicon
service, which answers 404 (so the card's initials) for a site without one. The website
must come from the board: Ashby's `publicWebsite`, a Workable account's `url`, a Greenhouse board's job descriptions
(Scale AI, Vercel), or where the board redirects (Stripe). Descriptions and redirects
only count when the domain's name is in the board token or company name
(`logos.stated_site`) -- descriptions also link eeoc.gov and TikTok, and Accenture's
board redirects to a Salesforce host. Never a website guessed from the company name:
"Workshop" is not workshop.com. A board that gives us nothing usable (Moment Energy: a
banner and no links; Waymo: a 32px careers-site icon) can be listed in
`logos.CHECKED_WEBSITES`, which wins over everything -- but only with a site a person
opened and confirmed is the same company.

**`logos.PATTERN` only accepts each ATS's own image host, `favicon` only Google's, and
those hosts must match `frontend/next.config.ts`'s `images.remotePatterns` exactly.** `next/image` throws on
any other host, which fails the whole Jobs page, not one card. Greenhouse is read from
`job-boards.greenhouse.io` because `boards.` redirects there cross-origin; Lever's
`og:image` is a 1200x630 banner, so its header `<img>` is used instead. Workable's
board page is a script shell, so its logo is read from the account JSON
(`/api/v1/accounts/{slug}`): `logo` on `workablehr.s3.amazonaws.com` under
`/uploads/account/logo/`, never its `open_graph_logo`. It is 120px tall, a square or
a wordmark up to 720 wide (17 of the first 25), which the card letterboxes like any
other wordmark. Recruitee and BambooHR
are not in `logos.PAGE` at all (`providers.md`).
