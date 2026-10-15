# Screens

How each screen behaves and why: the Jobs page and its filters, the job
posting page and card, the seeker Dashboard, Applications, the Calendar, My
Profile (resumes, photo), Scout's panel, and the company screens. Read the
section for a screen before changing it.

## Jobs page, /search and filters

/jobs and /search filter on the server by the query (/search's ?q= is read by
the API's role resolver: roles, a typo corrected, then text and company):
?location= (repeated ISO
codes, US or US-CA), ?work_style=, ?role=, ?experience=, ?job_type= (repeated),
?posted_within= (days), ?min_pay= and ?max_pay= with ?pay_per= (hour or year),
?start_term= (seasons) and ?visa=, GET /jobs' own names. jobs/filter-query.ts
reads and writes them for the pages and the row alike, dropping any value the
API would refuse, so a stale link narrows by what was valid instead of erroring.

The heading and filter row stay at the top while the list scrolls under them
(jobs/feed-header.tsx, on /jobs and /search alike), so the filters are in reach
from anywhere in a long list. Below md only the filter row stays (the heading
scrolls away; all three took about a third of a phone's page). A hairline fades
in under it once the list is scrolling beneath. Its white spans the page's side
gutters (SEEKER_BLEED in gutter.ts); as wide as the cards only, their shadow
showed beside it as two thin vertical lines while they scrolled under.

jobs/filters.tsx draws the row (KAN-170); every facet filters, and Industry is
gone (no data). As the row narrows its facets step out one at a time, least used
first, Visa is never in the row (All Filters only, asked for 2026-10-10), and
All Filters stays a normal button; never stretch it across the row. Role
(KAN-155: the `job_roles` list, slugs like software_engineer, a job tagged with
each role its title names, so it counts under each) sits second, after Location,
as the facet a seeker narrows by first; no pick shows every role. Its options
are not in the code: the row and the panel read them, names and counts, from GET
/jobs/facets' `role` (only roles with a job, in the database's order), and the
row's Role waits on them behind a disabled button as Location waits on its
places. filter-query.ts checks a ?role= by shape only, like a place, so an old
KAN-172 link's "data_ai/ml" is dropped, not sent.

All Filters opens one panel (jobs/all-filters.tsx) with every facet's options in
view as chips, or a search picker for the long lists, and no facet popups inside
it (they landed left or right of their button by the room). Its picks are a
draft until "Show N Jobs", which counts the draft as it changes (GET /jobs/count
via jobs/actions.ts). Applying a filter dims the feed at once (jobs/feed-
transition.tsx: the row and the feed share one transition), since the narrowed
page is a round trip plus the API's half second away; the row's places and
counts are fetched once per visit and cached five minutes (COUNTS_TTL in
jobs/listings.ts), not refetched per change. Each facet button wears the glyph
the job card draws for its fact (Date Posted a clock, since the card's calendar
is the start date), and inside a popup only Workplace's options carry glyphs,
the card's own three. Salary is a range, "$ 30 /hr – $ 50 /hr", either end open,
with presets (hourly for internships, yearly for new grads) that fill the
minimum; a posting matches when its own range overlaps it, compared as yearly
figures in USD.

Location, Role and Start Date in the panel are one picker (SearchPicker in
jobs/all-filters.tsx; Role's specialties indented under their category, as a
country's states are, and named whole, "Mechanical Engineering", since a search
lists them alone): a search field whose checklist opens only from the field and
floats over the panel like a dropdown (it never pushes the sections down; it
opens upward, and no taller than the room, when the panel's scroll area has less
room below than above, as at Start Date), a keyboard combobox (Up, Down, Enter,
Escape closing only the list), picks shown below as pills with a cross, and
nothing pre-picked. Clear All remounts the pickers so typed text clears too. The
row's Role stays a checklist dropdown, as Workplace is; only the panel's is a
picker. A picked state narrows its country, in the panel as in the row. Start
Date offers seasons (Summer 2027), grouped by the API from the terms postings
use; Visa offers Sponsors Visas and Hide Jobs That Rule Me Out. Every option
shows its job count from GET /jobs/facets, across the whole feed rather than the
current results. Location, fed by GET /jobs/locations, is a Popover of two
panels, not a Select: countries left, the ticked country's states right. A
country alone is all of it, with states ticked just those (ticksFrom/placesFrom
there). Don't move it back into a Select with rows that come and go: a multiple
Select whose item list shrinks (Base UI 1.7) re-applies the value from before
the press, which undid the untick.

/search narrows the live /jobs feed to roles whose title or company contains ?q,
and draws them with jobs/listing-card.tsx, the feed's own card, skeleton and
error state, so a role looks the same on both pages. The API matches ?q (GET
/jobs?q=), across every job; it used to happen in the page, inside the 50 the
feed had sent. Both pages draw the first 50 (PAGE_SIZE in jobs/filter-query.ts)
and a Load More button under them (jobs/feed-list.tsx, KAN-171; a button, not
page numbers, as the team chose) that adds the next 50 with the same filters
through jobs/actions.ts. A fetch asks for one past the page, so the button shows
only when there is more. Loaded pages are kept for a return (jobs/feed-pages.ts:
30 minutes, one list, its own query only), so Back finds the list as long as it
was; a fresh arrival at the list's page (a sidebar link, a reload) drops them
and starts at the first 50.

Every seeker page goes back to where it was scrolled on a return: the browser's
Back or Forward, or "Back to Jobs" (restoreScrollOn). (seeker)/scroll-memory.tsx
keeps each address's position, since the shell scrolls its <main> and not the
window, so the browser can't; a page reached any other way starts at the top.

## Job posting page and card

**A live role opens at `/jobs/[jobId]`** (KAN-73): a click anywhere on its
card goes there (a hidden layer over the card; the title is the real link a
keyboard and a screen reader reach, and the card's buttons sit above the
layer). Under the pointer its edge tints, its shadow rises and its title
turns brand, but it does not lift: a card just under the sticky heading and
filters lifted into them and was cut off. The id is
the row's UUID, and `getJobListing` reads `GET /jobs/{id}`, whose 404 (closed, a company's own, no such job) is the page's not-found.
The page is the mock's `JobDetailHeader` with the card's own facts
(`listingFacts` in `listing-card.tsx`) and the employer's logo, then one
"About the Role": `[jobId]/description.tsx` reads the plain-text description's
own shape (Title Case lines as subheadings, the short lines under one as a
list), and a description the scraper cut at 8,000 characters (it ends " …")
says so and links to the whole posting. Apply Now leaves for the employer's
posting, Ask Scout asks about the role, Share copies the page's link, Save
and Report stay inert. Back to Jobs returns to the feed the seeker came from,
filters and all (`RememberFeed` on /jobs and /search keeps it in
sessionStorage).
A live card's location is the import's `location_label` where it has one
("San Francisco, CA" for "SF": the resolver's city, backend
models/CLAUDE.md), else the board's text tidied (`placesOf` and
`formatPlaces` in `(seeker)/jobs/format.ts`, KAN-171): a state after a city
becomes its code, a trailing US is dropped ("Philadelphia, Pennsylvania,
United States" reads "Philadelphia, PA"). Several places read "Austin, TX +3
more", with all of them on the job posting's page. The tidying never
guesses: a city with no state, or one abroad, prints as written, and a
remote place keeps its country. No city is filtered on, as the team decided
(2026-10-09): the label is display text only.
A live card still has the full shape of a fixture card: its facts are two
fixed rows of three (location, job type, salary; then work style, level,
and start or years), each value in ink beside a grey glyph, so each fact sits in the same column on every card
(KAN-157). Every `job_postings` fact the posting does not state (the scraper
fills job type, salary and years when it does, plus job type Full-Time for a
silent new-grad role, a measured rule in `scraper/CLAUDE.md`) is passed as `NOT_LISTED`
from `components/job-posting-card.tsx` and leaves its slot empty; a screen
reader still hears "Salary not listed". The slots used to print that in
italic, and over half the feed's cards had at least one. Under 448px of card
body the empty slots close up instead. The title is one line, trailing off
with an ellipsis (a wrapped title made its card taller than the rest), and a
fact stops at its column's edge. A title is whole on hover; a fact
isn't, on a card that opens its job posting's page, since the card's click
layer sits over the facts (the job posting's page shows every fact whole). An internship shows when it
starts in place of years (the card's `startTerm` fact: "Start in Summer
2027"). **An internship's job type is "Internship"**, whatever hours its
posting states, as Jobright shows it (KAN-171, decided 2026-10-10: "Full-Time
Internship" beside "Part-Time Internship" read as two kinds of internship).
Any other role's is how the job is set up (Full-Time, Part-Time, Contract).
The Job Type filter offers Internship too, and the API matches Full-Time and
the rest only among roles that aren't internships, so a card never reads
"Internship" under a Full-Time filter: that mismatch is why KAN-170 had
taken "Internship" out of the slot. Scraped pay
always arrives as a min/max range, and `formatSalary` prints one whose ends
meet as a single amount. The match rail is its placeholder
(`score={null}`: an empty ring and "Score Coming Soon") until matching
exists. Null still means a fact the posting has none of: its slot is empty
too, with nothing for a screen reader. A live fetch in a page calls
`await connection()` so `next build` does not prerender it with no API running.

## Seeker Dashboard

/dashboard is the seeker's home: sign-in lands there.

**The seeker Dashboard is a bento of tiles** (KAN-173), modelled on a
reference the user picked: white tiles with no outline on the white page
panel, set apart by a soft violet-tinted `--shadow-tile` alone,
`rounded-shell`, `p-5`, 16px apart. An outline on every tile read as a grid
of grey boxes, and a lavender ground under them read as muted beside the
shell's white panels; keep both off. Headings and figures are medium weight, figures in
`--text-figure` (36px), actions are pills (`<Button shape="pill">`). It
alone is capped at `max-w-dashboard` (1440px) rather than `max-w-app`.
From `@4xl/main` (896px, not `@5xl`'s 1024: a 13-inch laptop at 100% zoom
gives the page about 1010px and fell back to two columns of oversized
tiles) the four numbers run across the top in a grid of their own (the
first filled violet, the only solid tile), and the tiles under them sit in
thirds. Left to right is apply, then manage: New Matches two thirds wide
beside Next Up (a white reminder tile, its title in violet over one filled
pill) over Up Next, then Activity two thirds wide beside Waiting (three
columns, one per verdict: on track, follow up, likely closed, each labelled
under it, so no legend; it was a half-ring gauge, whose round-capped parts
left grey slivers between them and past its ends, then four columns, whose
two green ones side by side read as a mistake). Not four columns all the way down: that left Next
Up, Up Next and Waiting 184px wide on a 13-inch laptop, Up Next cut off
every row, and New Matches showed three jobs. `PLACE` in `page.tsx`
positions the tiles; from `@3xl/main` they pair up two by two through
`grid-flow-dense`; stacked, the numbers come first, then Next Up.
Activity's canvas is capped in height (`MAX_H2`/`MAX_H3` in
`streak-canvas.ts`) so its row stays short.
Draw a new Dashboard section with `SectionCard`, never a one-off box.
Dates and times sit in pills (`<Badge variant="tag" pill>`): Next Up's,
which links to the Calendar, Up Next's and New Matches' posted time; as 12px
meta grey in Plus Jakarta Sans they read too faint. A pill sits in its text's
column, under the title beside a tile or disc, never under the tile itself. New Matches' Apply is a
filled primary pill. A KPI tile centres its label on its 36px ring (the ring
hides below 10.5rem of tile), keeps that header row 36px tall, pushes its
figure to the foot, and gives the line under it a fixed `h-5`, hiding "vs
last week" where it would wrap, so every figure in a row sits on one line.
A scroll area inside a tile uses `scrollbar-quiet` (globals.css) and puts
its edge on the tile's edge: New Matches reaches into the tile's right
padding (`-mr-5`) and pads its rows back in (`pr-5`), so the bar runs down
the tile's side instead of beside the Apply buttons. There is no
pipeline section: its
funnel only restated the headline numbers. Fixtures are in
`(seeker)/dashboard/data.ts` until the tracker is real, except Next Up and Up
Next, which take the tracker fixture's upcoming events (`getUpNext`); Next
Up wears its application's company tile (`companyIconOf`, the outlined
`CompanyTile` the Applications detail panel draws at the same size). The
fixture keeps an interview first on any day of the week: its follow-up sits four days
out, since a weekend slides tomorrow's interview to Monday. Next
Up's View Details pill opens that application's detail panel and its date that week on
the Calendar; an Up Next row opens its day in the Calendar's Agenda, and View
All the Agenda; Waiting's Follow Up opens the Applications list filtered to
Applied. That is a placeholder: it helps nobody contact anyone, and KAN-174
(still open) plans the real flow, a list of only what has waited two weeks,
a Scout-drafted note, a recruiter search, then marking an application
followed up or closed once the tracker has a backend. The headline numbers are Applications, New Roles, Interviews and Saved
(`getHeadline` in `dashboard/data.ts`); New Roles and Saved replaced
Response Rate and Offers, which for a student sit near zero all season. New
Roles is the live feed, `GET /jobs/count?posted_within=` for the range and
the window before it, cached five minutes; Saved counts the tracker's saved
applications and ignores the range. Only those two tiles link (to the Jobs
page filtered by date posted, and to the saved applications), since their
figures are what their destinations show; Applications and Interviews are a
separate fixture from the tracker's twelve applications, so a link would
open a list that disagrees with its number. Its range is `?range=`, moved in place: the
headline (`dashboard/headline.tsx`) is handed every range's figures and reads
`?range=` itself (`useRange` in `range-switch.tsx`), so a new range counts
its numbers with the switch's thumb instead of after the server draws the
page again. The streak always shows the full year regardless of range.

**Activity is a daily streak** (`(seeker)/dashboard/streak.tsx`), no longer
a weekly pace chart: the past year of applications per day as a heat map that
folds into a 3D skyline, adapted from 21st.dev's Contribution Skyline. Its
heading is Activity; its files and tokens say streak. It opens on the 2D heat
map, and its four numbers (Past Year, Busiest Day, the two streaks) show only
there: the 3D skyline stands alone, with no numbers under it or in its corners. `streak-model.ts`
is its pure maths (grid, levels, stats, camera), `streak-canvas.ts` the
canvas engine (no React: the section mounts it once and it re-reads a ref
every frame), `streak.tsx` the section. It stays beside the Dashboard rather
than in `components/ui` until a second route wants it. The canvas reads its
colours off the section at mount: `--color-streak-1..4`, a violet ramp
validated as ordinal in `globals.css`, and `--color-border-subtle` for an
empty day, so a token edit restyles it. The current streak runs to the
viewer's today (yesterday while today is open), so `today` comes from
`useSyncExternalStore`: UTC on the server, the browser's own after hydration.
It ignores `?range=`, since a streak is every day. Its fixture is
`appliedDays()` in `data.ts`, seeded and walked from a fixed epoch so a date
keeps its count; the tracker swaps in one `{ date: appliedOn, count: 1 }` per
sent application.

## Applications

/applications is the tracker: a board, grid and list over the fixture in
`applications/data.ts`, every choice in the URL, `?app=` opening one
application in the detail panel. `(seeker)/tracker.ts` is the tracker's shape
and date logic; `local-time.tsx` prints its dates in the viewer's own zone and
links them to the Calendar.

**Application dates are real dates.** The tracker fixture
(`(seeker)/applications/data.ts`) dates every application against the
request (`getApplications` and `getNow`, both `cache()`d), on a New York
clock, so the sample search is always mid-flight; a timed event that lands on
a weekend moves to the Monday after. The shape is `(seeker)/tracker.ts`, and
it is what the tracker's backend should return: an ISO instant for something
at a time, a bare ISO date for something due on a day. The server decides
what is upcoming against `getNow()` (a day-only entry stays upcoming until
its day has ended in UTC-12) but never which day an instant falls on: it
prints the UTC date, and `<When>` in `(seeker)/local-time.tsx` swaps in the
viewer's own "Tomorrow, 2:00 PM" after hydration.

**The Applications page keeps every choice in its URL** (`applications/query.ts`):
`?view=`, `?stage=` (a comma list), `?q=`, the list's `?sort=` and `?app=`,
the application open in the detail panel. Links and a GET form, not client
state, so every view stays a server component and the Dashboard can link to a
filtered list or one application. The layout is the exception in how it
moves, not in where it lives: the page renders all three layouts, each
building its links for itself, `applications/view-panes.tsx` shows the one
the URL names, and the switcher moves `?view=` in place. Anything else that
builds a link from the layout (the filter bar, Clear Filters) reads it in the
browser through `useApplicationsQuery`, since a layout switch never asks the
server to draw them again. A card or row is one link: its role, stretched
over it. Its next step is a second, `relative` link to that week on
the Calendar, which paints over the stretched one.

## Auto Apply

/auto-apply (KAN-223) is where the seeker will apply in bulk. Its sidebar row
sits between Jobs and Applications, in the order the work goes, and its page
uses the same heading block as every seeker screen. The pipeline it grows
into is `auto-apply/architecture.md` at the repo root.

**"Applying with Resume:" is its first section, and it is live**
(`auto-apply/applying-resume.tsx`). It shows the seeker's primary resume
(`is_default`) in My Profile's own row (`src/components/resume-row.tsx`) with
only the eye, and a Change link to My Profile, where resumes are chosen and
deleted. Only the primary, never My Profile's fallback to the newest: the
matching reads the primary alone, so a seeker without one is asked to star
one. It is a client component reading `listResumes()` like My Profile, and
starts from My Profile's cache when the shell has one, without writing to it.

**The button beside the resume starts and pauses auto apply, and nothing runs
yet.** Start Auto Apply, then Pause, then Resume; it is off until there is a
primary resume. It only moves a state (`idle`, `running`, `paused`) held in
`auto-apply/auto-apply-panel.tsx`, which Live Activity's heading shows as Not
Started, Live (a green dot that rings out) or Paused. The brand fill marks
the action that starts work, so Pause is the bordered neutral. The button is
52px tall and 208px wide beside the row, so the row does not shift between
labels; on a phone it drops under the row at full width.

**Live Activity is a fixture** (`auto-apply/data.ts`, timed against the
request like the Applications fixture), one row per job posting the pipeline
is working on, in one white card with rules between rows. Each status takes a
badge tone by its kind (`ui/badge.tsx`): Queued inert grey; Tailoring Resume
and Autofilling `advanced` blue, their dot ringing three times; Needs Review
and Couldn't Finish warning amber, as both wait on the seeker; Applied the
Applied stage's violet, so it reads the same as on the Applications board.
The counts above the card use the same dot colours. Narrow, a row's badge and
time drop under its text so the role keeps the width. The list is
`aria-live="polite"` for when it updates for real; the statuses and the
routes it will read are in `auto-apply/architecture.md`, "The run" and
"API routes".

## Calendar

**The Calendar** (`(seeker)/calendar/`) shows every dated entry: the day each
application went in, interviews, offers and their deadlines, closing dates
and follow-ups, in their kind's stage colour, with a legend. `?view=` picks
Month, Week or Agenda (two weeks), `?date=` anchors it on a bare day, and
`?app=` opens the same detail panel Applications does, with a way across.
Without `?date=` it opens on the viewer's today, which the server cannot
know, so the views render in the browser behind a placeholder
(`calendar-view.tsx`, `useHydrated`). They read the view and the day from
the page's query themselves (`useCalendarQuery` in `view-switch.tsx`), and
the view switch, the arrows, Today and a day's number move it in place; an
entry is a real link, since its panel is drawn on the server. Its layout follows a reference the team
picked: the span's title at the top left with round grey arrows at the top
right, small uppercase weekday names, each day a light grey rounded tile with
gaps rather than a ruled grid, today's tile white and outlined in the brand,
and the legend at the foot. Week days and Agenda entries are the same tiles,
and Today is a grey pill just left of the arrows, in their fill, so the three
read as one group.
It sits open on the page, not in a card: the page panel is already white.
Month chips name the company and carry no time, since the colour already says
what kind of entry it is; Week and Agenda name both. A
link into the Calendar from anywhere else goes through `DayLink` in
`(seeker)/local-time.tsx`, which picks the viewer's local day the way
`<When>` picks their words.

## My Profile

**Resume upload is wired.** The onboarding form (`onboarding/applicant`)
uploads on Continue, unreviewed. The seeker profile (`(seeker)/profile`)
supports up to 5 resumes, newest first: on file select it calls
`parseResume` (nothing saved), opens `resume-edit-dialog.tsx` on every
section of the result, and only Save calls `uploadResume` with the file plus
the edited `parsed_json`; Cancel discards it. When nothing was read and
nothing typed, Save leaves `parsed_json` out, so the API parses the file
itself and marks it `parse_failed` rather than "parsed". That dialog is a
panel sliding in from the right over a darkened page, built from the
vendored dialog's parts because the vendored Sheet's 10% overlay cannot be
darkened from outside. A click on the darkened page does not close it — that
would throw away every unsaved edit — but › and Escape do. Each resume row
(`src/components/resume-row.tsx`, shared with the Auto Apply page) has an
eye — a short-lived signed link from `getResumeFileUrl`, opened by
`src/lib/preview-resume.ts`: a PDF opens in a new tab, opened inside the
click so it is not blocked as a popup (if it is blocked anyway, the page says
so rather than leaving it); a DOCX downloads — and a star that makes it
primary (`setPrimaryResume`). The star and the delete are optional props, so
a screen that only shows a resume leaves them out. All of these actions live in
`src/lib/resume-actions.ts`, whose `ParsedResume` type mirrors the API's.
The `ResumeUpload` component (`src/components/resume-upload.tsx`) is a pure
dropzone + file preview — it knows nothing about upload logic or limits.

**The profile's Work Experience and Skills come from the primary resume's
`parsed_json`** (`getParsedResume`), or the newest one's when none is primary —
`shownResume` in `page.tsx`. Work Experience's Edit opens
`resume-edit-dialog.tsx` on that one section, so all roles are edited in one
modal; each skill opens `entry-dialog.tsx`, which reuses the same field
table. Every save PUTs the whole `ParsedResume` back (`updateParsedResume`).
Collapsed, Work Experience previews the first two roles with descriptions cut
to two lines, and one chevron in its heading expands the whole section. The
chevron appears only when the preview hides something; whether a description
overflows depends on the column's width, so `resume-sections.tsx` measures it
with a ResizeObserver. The one-section edit modal numbers its entries
("Experience 1", …) since it has no section headings to go by.
A role's description shows as resume bullets, one per line break, so the
paragraphs a parsed or pasted description holds do not run together. Blank
lines drop out and a bullet the text already starts with (•, -, –, *) is not
drawn twice. This is display only: the stored text is unchanged.
Deleting the resume the sections show switches them to whichever `shownResume`
picks next.

**The sections' editors stay shut while the shown resume switches.** Every
editor saves onto whichever resume is shown, so from a star or delete click
until the sections have moved to the next resume (`switching` and
`profileLoading` in `page.tsx`), Edit, Add and the skill chips are disabled.
An editor left open across a switch saved one resume's roles over another's.
A switch the page did not start — a background refresh, after another tab
changed the primary — can still land under an editor already open, so both
sections are keyed by the shown resume's id: the switch remounts them, which
closes that editor. If a switch's content fails to load, the sections are
cleared rather than left on the outgoing resume, which after a delete no
longer exists; with resumes still listed they say the content didn't load,
not "Upload a resume".

**My Profile is cached for the life of the seeker shell.**
`(seeker)/profile-cache.tsx` keeps the page's last state (resumes, the shown
resume's content, the photo URL, the applicant profile fields) in a provider
in `(seeker)/layout.tsx`. A
return visit renders it at once and refetches in the background. Only
settled state is saved: not mid-load, not while a photo upload's `blob:`
preview is on screen (that URL is revoked once the upload ends), and not
after a failed load. It lives in the layout, not a module variable, because
sign-out redirects to `/login`, outside the shell, and that unmount is what
drops it — a module variable would show one account's resumes to the next
person to sign in in that tab.

**Profile photo upload is wired** on the seeker profile. The pencil button
opens a file picker restricted to JPEG/PNG/WebP; the file is checked against
`avatar-rules.ts`, previewed immediately, and sent through `uploadAvatar`,
rolling back on failure. The API re-encodes it to a 512px WebP and returns a
signed URL valid for an hour — so it is fetched per page load, never stored.
`docs/avatar.md` (repo root) owns the formats, limits and why. The seeker bar
fetches it per render (`(seeker)/account-status.tsx`); the company bar still
shows initials.

## Scout panel

Scout, the job assistant, lives in `components/scout/`; its brain is the repo's
`scout/`, so read `scout/CLAUDE.md` first. `scout-store` holds the one chat per
tab (a module store, so no provider). `scout-panel` docks beside the page, never
over it, and opens only on a click. It stays mounted and opens in two moves: its
room appears at once and the page settles into its new width, while the panel
slides in from the window's edge (`docs/motion.md` has why). Escape or its X
closes it and hands focus back to the bar's launcher, which shows pressed while
the panel is open. `stream.ts` mirrors the API's NDJSON events, which
`app/api/scout/` (the one route handler, since the reply streams) forwards with
the session's token. `reply-text` renders a reply's **bold** and "- " bullets,
the prompt's whole formatting vocabulary, with no markdown library (a reply
stays escaped text otherwise).

## Company screens

The company shell is a left panel plus a top bar under `/company/*`. /company
is the hiring dashboard; /company/jobs lists the company's real jobs;
/company/jobs/new is the composer, and /company/jobs/[jobId]/edit reopens it on
a saved job. `lib/job-actions.ts` saves a job (create, or update with the
`updated_at` it was loaded with, so a save over someone else's is a 409) and
pauses, resumes or closes it; `lib/job-queries.ts` holds the Server-Component
reads.

The two company list screens share `app/company/table.tsx` — a TanStack Table
shell over shadcn's `Table`, with sorting, filtering and row selection. **It is
TanStack v9, and every shadcn data-table example in circulation is v8**: v8's
`useReactTable` and `getCoreRowModel()` options do not exist, features and their
sort/filter functions must be registered explicitly in `tableFeatures`, and
cells render through `<table.FlexRender />`. The library ships its own guides in
`node_modules/@tanstack/react-table/skills` — read those rather than a blog
post. Select-all deliberately covers the filtered rows only; both
`getIsAllRowsSelected` and `toggleAllRowsSelected` resolve to the filtered row
model, so a filtered list cannot select rows nobody can see.
