# Screens

How each screen behaves and why: the Jobs page and its filters, the job
posting page and card, the seeker Dashboard, Applications, the Calendar, My
Profile (resumes, photo), the Experience Bank, Scout's panel, and the
company screens. Read the
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

An empty experience bank gets a card above the /jobs feed
(`jobs/bank-prompt.tsx`, stories 22 and 102): with an uploaded resume,
"Import Your Resume" opens `/bank?import=1`, which starts the bank page's
import at once (one click; the student still checks each draft); with
none, Upload a Resume and Add What You Did. It streams in its own Suspense
boundary and shows nothing when the bank has entries or fails to load. The
feed under it is the live listing for everyone, not a bank match, so it
still shows; the API's bank-scored `GET /jobs/recommended` has no screen
yet, and when it gets one this card is its empty state.

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
with presets (hourly when only internships are picked, yearly when none are, `payUnits`) that fill the
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

Clearing the search field on /search with its cross (or Escape) ends the
search: the page goes back to /jobs as the seeker last saw it, filters, Load
More pages and scroll place and all (KAN-228, asked for 2026-10-13). A search
from the top bar sends only ?q, so the filters set on /jobs before it come
from RememberFeed's own copy of /jobs's address, not from /search's. Deleting
the text by typing does not leave: the field's cross is told apart by its
input event having no inputType (search/query-field.tsx), so backspacing to
type a new search stays on the results.

Every seeker page goes back to where it was scrolled on a return: the browser's
Back or Forward, or a job page's "Back" (restoreScrollOn). (seeker)/scroll-memory.tsx
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
says so and links to the whole posting. Apply Now (`[jobId]/apply-button.tsx`,
KAN-220) opens "Pick a Resume": the student's base resumes, the one tailored
to this posting and the uploaded resumes, with the tailored one, else the
default, picked first. Apply keeps a sent resume linked to the posting, then
shows Download Resume and Open the Posting (a link, so no popup blocker
stops it). Apply Without a Resume leaves for the employer's posting at once.
Once a resume is sent, the page reads "You sent <name> on <date>" under
the header (`[jobId]/sent-note.tsx`, story 98), the last sent resume
linked to this posting, its day in the viewer's zone.
Ask Scout asks about the role, Share copies the page's link, Save
and Report stay inert. The card's own row has Not Interested, Save, Ask
Scout, Auto Apply and Apply Now. Auto Apply sits between Ask Scout and Apply
Now on the page and the card alike (`auto-apply/auto-apply-button.tsx`):
Ask Scout's secondary design with the sidebar's Zap glyph. A click queues
the job posting through the API (`POST /applicants/{id}/applications`, the
server action `queueJob`), and the button turns to the stage it answers
(Queued; or Skipped, Needs You, Applied for a job that already had an
application). Queued is a toggle (`aria-pressed`): a second click takes the
job out of the queue (`DELETE .../applications/{job_id}`, `dequeueJob`) and
the button reads Auto Apply again. The other stages are off: they record what
happened, so the button never undoes them. A new queueing raises a toast
(`components/ui/toast.tsx`), "<title> from <company> is queued for Auto
Apply.", with Undo, which takes the job out again (`dequeueJob`) and turns
the button back to Auto Apply: Live Activity's cross and Undo, the other way
round. A failed Undo says so in a toast and leaves the button Queued. Its first state comes from
the server: the job's page reads its one application (`GET
.../applications/{job_id}`), and /jobs and /search read every application
once beside the first page (`getApplicationStages`) and hand the stages to
each card, Load More's too. A stale one is harmless: a click answers the real
stage. Back returns to the list the seeker came from: the feed, filters and all, or
the Auto Apply page (`RememberFeed` on /jobs, /search and /auto-apply keeps
the last one visited in sessionStorage). It says only "Back", whatever the
list: the server cannot read sessionStorage, so a label naming the list
would change a moment after the page loads.
**Applied** (KAN-232), last in the header's actions, shows for a signed-in
applicant only (`getApplied` answers null for anyone else). A click calls
`markApplied` (`jobs/actions.ts`), and the button becomes "Applied at
10/15/2026", the viewer's own day after hydration (`AppliedOn`). The job then
leaves that applicant's feed, /search and count, because `listings.ts` sends
their token with those reads (`viewerToken`) and the API filters on it. There
is no undo yet.
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
2027"). **An internship's job type is "Internship" and its level
"Student"**, whatever hours its posting states, as Jobright shows it (decided
2026-10-10: "Full-Time Internship" beside "Part-Time Internship" read as two
kinds of internship). Since KAN-233 the data says so too: `job_type` holds
`internship` and `experience_level` `student`, so the card prints the
columns as they are and the Job Type filter is a plain match. Any other role's
job type is how it is set up (Full-Time, Part-Time, Contract). Scraped pay
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

**"Resume List" is its first section, and it is live**
(`auto-apply/resume-list.tsx`). It lists every resume the seeker has, not
one: auto apply picks a resume per application (the one tailored to that job
posting, else the default resume, `POST .../applications/{job_id}/resume`;
`auto-apply/architecture.md`, "The resume"), and a note under the heading
says so. The default is one resume, built or uploaded (starring one clears
the other), so one row at most says Default; with resumes but no default, a
second note says to star one, since the run then attaches none. Built
resumes (`listBuiltResumes()`) come first, then uploaded ones
(`listResumes()`), each list's default first. Each row is My Profile's 52px
box (`RESUME_ROW`) with Default, Tailored or Posting closed badges. A
built resume's Open goes to the resume editor, as on the bank page; it never
downloads here, since every download keeps a sent resume. An uploaded one
previews or downloads (`previewResume`). Manage goes to the bank page's
Your Resumes, and the empty state names the bank and My Profile. Uploaded
resumes start from My Profile's cache when the shell has one, without
writing to it; a list that fails keeps what loaded and says the rest didn't.
It replaced "Applying with Resume", which showed the primary uploaded resume
alone because matching read it then; matching reads the experience bank now
(KAN-212).

**The button beside the resume starts and pauses auto apply.** Start Auto
Apply queues a batch of the seeker's best matches through the API (`POST
.../auto-apply/batches`, the server action `startBatch`: 10, leaving out
every job they already have an application for), says how many under the
row, and refreshes the route so Live Activity lists them; an error (an empty
experience bank) shows there in red instead. Then Pause and Resume, which
only move the state: nothing fills a form until the extension's runner
exists. It is off until the list has a resume, and while a batch is
queueing. The state (`idle`, `running`, `paused`) is held in
`auto-apply/auto-apply-panel.tsx`, which Live Activity's heading shows as Not
Started, Live (a green dot that rings out) or Paused; a return visit starts
idle, so Start queues another batch. The brand fill marks
the action that starts work, so Pause is the bordered neutral. The button is
52px tall and 208px wide beside the list, its top level with the first
row's (a grid), so nothing shifts between labels; on a phone it drops under
the list at full width.

**Live Activity is live: the seeker's applications from the API**
(`auto-apply/applications.ts`, `GET /applicants/{id}/applications`), newest
first, drawn on the server against the request's clock. Each stored stage is
a row (`activityOf` in `auto-apply/activity-list.tsx`): queued Queued,
needs_you Couldn't Finish, skipped Skipped, applied Applied. The whole row
opens the job posting's page, as on the Applications list, while the posting
is open; a closed one says so and links nowhere. None yet is an empty state
pointing at Start and the jobs' Auto Apply; a failed read says so, never a
fixture. One row per job posting, in one white card with rules between rows. Each status takes a
badge tone by its kind (`ui/badge.tsx`): Queued and Skipped inert grey; Tailoring Resume
and Autofilling `advanced` blue, their dot ringing three times; Needs Review
and Couldn't Finish warning amber, as both wait on the seeker; Applied the
Applied stage's violet, so it reads the same as on the Applications board.
The counts above the card use the same dot colours. A queued row has a cross
beside its badge (`auto-apply/remove-from-queue.tsx`) that takes the job out
of the queue and refreshes the route; it sits above the row's link, so the
click never opens the job posting. No other stage has one. A toast then says
"<role> from <company> is removed from Auto Apply." with Undo, which queues
the job again (`queueJob`): it comes back as a new queued row at the top,
since the queue orders by when a job was queued. A failure, of either the
removal or the Undo, is a toast too. Narrow, a row's badge and
time drop under its text so the role keeps the width. The list is
`aria-live="polite"`. Tailoring Resume, Autofilling and Needs Review are the
runner's live states, kept for when the extension reports them; the
statuses and the routes are in `auto-apply/architecture.md`, "The run" and
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
uploads on Continue, then goes to intake, onboarding's next step (Experience
Bank section). The seeker profile (`(seeker)/profile`) supports up to
5 resumes, uploaded and base resumes together as the API counts them (its
"n of 5" adds the bank page's base resumes; tailored ones are free),
newest first: picking a file uploads it at once (`uploadResume`);
the API reads it itself, and the client never sends parsed content. Each
resume row (`src/components/resume-row.tsx`, shared with the Auto Apply page)
has an eye — a short-lived signed link from `getResumeFileUrl`, opened by
`src/lib/preview-resume.ts`: a PDF opens in a new tab, opened inside the
click so it is not blocked as a popup (if it is blocked anyway, the page says
so rather than leaving it); a DOCX downloads — and a star that makes it
primary (`setPrimaryResume`). The star and the delete are optional props, so
a screen that only shows a resume leaves them out. All of these actions live
in `src/lib/resume-actions.ts`. The `ResumeUpload` component
(`src/components/resume-upload.tsx`) is a pure dropzone + file preview — it
knows nothing about upload logic or limits.

**Resume facts are not edited on My Profile** (KAN-211). The parsed-JSON
editor (a review dialog after upload, and Work Experience and Skills cards
editing the primary resume's `parsed_json`) is gone, so the experience bank
is the only place to edit resume facts. In its place an "Experience Bank"
section links to `/bank`, where import turns an upload into drafts. Do not
bring back an editor of `parsed_json`: two places to edit the same facts
drift apart, and the bank is what built resumes read.

**My Profile is cached for the life of the seeker shell.**
`(seeker)/profile-cache.tsx` keeps the page's last state (resumes, the
photo URL, the applicant profile fields) in a provider
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

## Experience Bank

`(seeker)/bank` (KAN-206), a sidebar row above My Profile. The experience
bank is where resume facts are kept, once (`GLOSSARY.md`), and the only
place they are edited: My Profile keeps the uploads and links here.

**Layout, top to bottom** (settled 2026-10-13): the title with a "Your
Resumes" button that jumps to the bottom card and Fill With Scout; the
section cards and Skills; then one "Your Resumes" card holding Base Resumes
and Sent. The page is the filled-out bank itself.

**Intake lives in Scout's panel** (2026-10-13), where Scout does: the bar's
Scout button or Fill With Scout opens it. On this page the panel shows
intake in place of Scout's job chat (`components/scout/scout-takeover.tsx`)
and widens to 448px (460px of room with its gap). Three bands, top to
bottom: the step bar and a read-only preview of the draft
(`draft-preview.tsx`); the chat; the composer. The preview shows the entry
as the bank lists it, fading each line in as WorkIt fills it, with "Still
needed" chips, Edit and Save Entry, and on the left "Leave As Is" (a
visit) or "Skip Section" (a new entry): the step bar's Skip, where a student
happy with an entry looked for "next" and found none. It folds to its header.
**The page marks what Scout is working on** while the panel is open
(`Intake`'s `onFocus`, `ScoutMarked` in `bank-screen.tsx`): the section card
takes the brand outline, a visited entry a brand tint with a "With Scout"
tag, and a new entry shows as a tinted row with the draft's title. The
marked row scrolls into view (instantly under reduced motion). Gemini in
Docs and Grammarly mark the text their side panel acts on the same way;
before this, the student could not tell which entry the questions meant. The chips are
`sections.ts`'s `neededFacts`: only what intake asks about (a school's or
job's dates, a job's or role's organization, a school's degree and field,
bullets) and the title. An optional field such as a school's college never shows; an early
version listed every empty field and asked for "College or Department".
Before the draft has a title the chips stay hidden, since the chat's
question is the next step. Edit opens the
full form over the panel, with Back to Chat (Escape goes back too). The
upload offer is WorkIt's second line with Upload Resume and Use One I
Uploaded, not a strip. The import review opens in the chat's place. A save
reads the bank again, so the page behind updates at once. An empty bank
shows a card pointing to Fill With Scout. Any other page gets Scout's own
chat back. Intake used to lead the page, with the card in a column beside
the chat; onboarding still shows it that way.

The bands were settled 2026-10-14. The first docked version stacked the
whole form between the chat and the composer and left the chat one line
high. The fix follows Cloudscape's inline versus canvas previews (a summary
card in view, the editable form opened on demand) and Gemini's side panel
in Docs (suggested answers in the chat, not a banner).

- **Live, with an error state.** `page.tsx` reads `GET
  /applicants/{id}/bank` through `src/lib/bank-actions.ts` on the server; if
  that fails it shows "Your Bank Isn't Loading Right Now" and a Try Again
  link, never fixture rows. A failed save or delete shows the API's message
  beside the control and leaves the screen as it was.
- **One card per section**, in the fixed order (Education, Experience,
  Projects, Leadership & Activities, Awards, Certifications), then Skills.
  Entries come back from the API ongoing first, then newest; the screen
  never sorts. After every change it reads the whole bank again, so the
  order shown is always the API's.
- **An entry's dates sit under its title below `@xl/main`**, beside the
  edit and delete buttons above it. Beside them on a phone, the dates never
  shrank and left the title a column a few letters wide ("Universi / ty").
  An import draft does the same below `@sm` of its own width (each draft is
  a container, since Scout's panel is not), and a resume row's buttons wrap:
  held on one line, they ran past the card's edge.
- **An entry warns what a resume would miss** (`sections.ts`'s
  `missingFacts`, story 17): for Education and Experience no start and end
  (or "present"), and for Experience and Leadership no organization. A
  project, role or award has no dates warning: no application form asks for
  them (Greenhouse, Lever, Ashby, Workday; settled 2026-10-14). It still saves; the warning says to add them before
  Generate.
- **Deleting an entry confirms with how many built resumes show it**
  (story 18): the trash button reads `GET .../entries/{id}/resumes` first,
  then asks. A resume that hides the entry is not counted.
- **Bullets show their original wording only** (KAN-218). Wording typed on
  a resume in the editor is that resume's local variant and never shows
  here (`docs/resume.md`).
- **Import Your Resume** (`import-card.tsx`, KAN-211) opens inside intake,
  from the upload strip above it, shown until the student imports once.
  Upload Resume (PDF or DOCX) uploads through `uploadResume`, as My Profile
  does, then imports that file (`resumeId`); the link imports the default
  upload, else the newest. The review takes the chat's place until Close,
  or a Save All that leaves nothing to check. The API's 5-resume limit
  shows as the strip's error. `?import=1` (the Jobs page's prompt) opens
  the panel and the import on arrival. One
  click reads the default upload, else the newest, into draft entries and
  skills (`importResume`). Each draft shows the lines the bank list shows
  under an entry (`entryDetails`: degree and GPA, coursework, honors,
  issuer, link), so an Education draft is checked before it is saved;
  nothing is saved until the student saves a
  draft (Save, or Edit in the entry editor) or uses Save All. A draft that
  matches a bank entry shows "Already in Your Bank": Save All skips it and
  its own button reads Save as New. Skip drops a draft; Close drops them
  all. With no upload the API's 404 message shows, next to a link to My
  Profile. The Jobs page links here for an empty bank (story 22).
- **One entry editor** (`entry-editor.tsx`) for every section and for
  import and intake drafts: it edits a draft and hands the whole draft
  back, and the caller decides between create and edit. Only the title is
  required. Each section adds its own fields (`sections.ts` names the
  title and organization for each). Months use the browser's month picker,
  which falls back to a `YYYY-MM` text box where there is none.
- **A duplicate warns and never blocks.** When a new entry matches one in
  the bank (section, title and organization, ignoring case), the editor
  says "This looks like …" and its save button becomes Save as New; Cancel
  closes it. Two real roles may share a title.
- **Editing an entry** sends its fields in one PATCH, then its bullets as the
  adds, edits and deletes that turn the saved list into the draft's
  (`entry-save.ts`'s `editSteps`, shared with intake's entry visits).
- **Delete asks once**, inline. **Still open:** saying how many built
  resumes use the entry (user story 18); built resumes exist since KAN-207,
  but the count is not shown yet.
- **Skills are a plain list** with an optional group, shown one line per
  group. A name appears once, ignoring case; the API answers 409 otherwise.
- **Skill links live in the entry editor** (KAN-216, `skill-links.tsx`):
  "Skills Used Here" shows one toggle per bank skill, pressed when linked.
  The editor only edits the list; on save the screen sends the link and
  unlink calls after the entry's own save (for a new entry, after it is
  created). Once the entry has saved, a failed later step closes the editor
  and says "Some changes did not save", because a retry would repeat the
  steps that worked. Intake and import omit `skills`, so no links show.
- **Intake** (`intake.tsx`, KAN-213) leads the page, above the section
  cards, in the look of the intake prototype's variant
  G: a lavender chat with WorkIt's gradient mark, a chapter line per section, the draft card sticky beside
  the chat from `@4xl/main` and, below that, a one-line draft that opens as
  a bottom sheet. The student picks a section from its chips; the opener
  for it is fixed text, not a model turn. Each turn goes through
  `app/api/intake/` to `POST /intake/turn` with this entry's chat and the
  card, edits included; the reply comes back as NDJSON lines: the line, the
  whole draft (the card remounts on it) and the messages left today. A
  field the student changed while the reply was on its way keeps the
  student's value (`mergeReply`), and a card discarded or moved to another
  section meanwhile ignores the reply. The card is
  the shared entry editor (its `onChange` reports each edit), and saving is
  the bank's own create with its duplicate warning, one entry at a time.
  The bubbles, typing dots and composer with its mic are Scout's
  (`components/scout/chat.tsx`). **The unsaved draft lives in localStorage**
  (`lib/local-drafts.ts`), so a reload keeps it; Sign Out and the login
  page clear every key under its prefix, so the next person in the browser
  never sees it. The chat is never stored anywhere.
- **Intake's step bar** (`intake-steps.tsx`, KAN-214), after variant G: one
  segment per section in the order intake walks (Education, Projects,
  Leadership & Activities, Experience, Awards, Certifications: user story
  41, not the bank's order), Back on the left, Skip on the right. A segment
  jumps to its section; the bar is disabled while WorkIt answers or a save
  runs, so a late reply never lands on another section. It starts at 25%
  and fills as sections are done; the current segment fills as its draft
  grows (a title, each answer, full when WorkIt has no questions left).
  **A skipped section counts toward the percentage** (settled in KAN-214,
  as the prototype does): the bar measures sections dealt with, so a
  student with no awards still reaches 100%. Its segment is striped, not
  filled, and a later save in it marks it done. Skip and a jump drop the
  unsaved draft, as in the prototype. Skipped sections persist beside the
  draft in `lib/local-drafts.ts`.
- **Walking.** The bank page always walks, in the step bar's order: a
  section with entries is passed over, except that each entry with gaps
  (`sections.ts`'s `gapQuestions`: no dates for a school or job; no organization for a job or
  role; no bullets for a job, project or role; no degree, field or GPA for
  a school, which a resume import often lacks) gets a visit. The card opens
  on the saved entry, WorkIt's first line asks about the gap, the model is
  told what the card has and lacks, and saving edits the entry. Skip on a
  visit passes over that entry only. An entry visited once is not visited
  again on the page. A section with no entries gets the full questions.
  **A jump or a chip visits too**: picking a section opens its first entry
  with gaps not yet visited, never a blank card that asks the student to
  retell what the bank holds. Otherwise it opens a new card, and WorkIt's
  first line names the entries the bank already has there, each once with
  its organization ("Software Engineer Intern (Clever Devices)"): copies
  read as the same title over and over. A visited entry
  is not reopened, or a student who declined a school's GPA could never
  add another school.
  After an import closes, the walk starts again on the bank as it now is,
  unless the student has already talked into the current card. A kept card
  with nothing in it is dropped on load, so the walk picks afresh, and so is
  a gap card whose entry has been deleted since (saving it found no entry,
  and it hid the walk's questions about the import). When no
  stop is left, the student picks from the chips.
- **Intake in onboarding** (`onboarding/applicant/bank/`, KAN-214): the
  profile form's Continue leads there, then Finish leads to /dashboard. It
  always walks, and its step bar shows the profile form as a done "Profile"
  step before the sections. It imports `Intake` from the bank route rather
  than promoting it to `src/components`: intake needs the bank's entry
  editor and sections, which stay with the bank page.
- **The page title stays "Experience Bank"** on the bank page and the
  onboarding step (settled for now in KAN-214, per the spec's "kept for
  now"); the glossary term stays either way. **Still open:** the name
  students see.
- **Base Resumes** (`built-resumes.tsx`, KAN-207), in the "Your Resumes"
  card below the sections.
  Generate makes a base resume with every entry, bullet and skill in the
  bank, except a copy of an entry already on it (same section, title,
  organization and months: an import saved "as new"), which waits in "Not on
  This Resume"; two copies of one job sent a resume to two pages. Each row downloads a PDF (Jake's Resume) or a Word file, can become
  the default resume (star) and can be deleted. Either download keeps a
  sent resume (KAN-208) and comes back as a 5-minute Storage link that
  downloads the file, so no route handler is needed. A PDF whose text
  has characters the font lacks shows them and waits for Download Anyway
  (user story 53); Cancel deletes the sent resume it just made. The
  5-resume limit is the API's; its 409 message shows as the card's error.
  The page needs the bank, the resume list and the Sent list: if any fails
  it shows the error state. Each row's Open goes to the resume editor.
  A tailored resume shows there too, with a Tailored tag and no star (only
  a base resume can be the default), and a "Posting closed" tag once the
  Jobs page no longer lists its posting (story 90, the API's
  `posting_closed`). It still opens and downloads; only Tailor needs a
  live posting.
- **Sent** (`sent-resumes.tsx`, KAN-208), in the same card below Base
  Resumes. Every
  PDF or Word file the student downloaded or applied with (KAN-220), newest first, with its name then and the date
  ("Sent Oct 13, 2026", "Word · Sent Oct 13, 2026"). Each downloads the kept file again or is deleted;
  none is edited. A repeat download of unchanged content adds no row. It
  sits on the bank page because base resumes do; "the resumes page" in the
  spec means this page until resumes get their own.

### Tailor (`/jobs/[jobId]/tailor`, KAN-217)

- **Opened from "Tailor My Resume"** on the job posting page, which reads
  "Your Tailored Resume" once the student has one for that posting.
- **The run waits for a click.** Each run spends one of today's 2 Tailor
  runs, so loading the page never starts one.
- **The keyword match** shows "12 of 18" before, and again with what the
  student has accepted, required keywords first. The second count adds
  each accepted change's `keywords` and each Yes in the browser, with no
  call; Done's response is the saved resume's own match. A posting with no
  description shows the "weak match" notice.
- **Every change has Accept and Reject**, plus Accept All; a new wording
  shows beside the old one. Nothing saves until Done; Leave Without Saving
  goes back to the posting. "Bring back" and "Reorder bullets" name the
  entry with its organization ("Software Intern, Acme"), since two jobs can
  share a title; the API never offers a copy of an entry already shown.
- **"Have you used X?"** lists missing keywords that are nowhere in the
  bank. Yes adds the skill to the bank (it is saved at once, being true),
  shows it on the tailored resume, and offers to link it to an entry.
- An empty bank (409) shows a link to the bank page, where intake starts.

## Resume editor

`(seeker)/resumes/[resumeId]`, opened from a base resume's Open on the bank
page. KAN-209 proved the overlay; KAN-218 edits on it; KAN-219 adds the
phone layout; KAN-221 adds the assistant. The page loads the render, the bank, the resume's choices and
the profile (the header's fields), and shows the error state if any fails.

- **The page is the PDF itself** (ADR 0002): the render response's PDF,
  drawn with pdf.js on one canvas per page, never an HTML copy. Each of the
  response's boxes is a button laid over its line in percent of the page,
  so the targets follow the canvas at any width without a redraw.
- **Click a line and type** (`editor.tsx`). A text field opens over the
  line's first box, in type sized in `cqw` of the page (each page is a size
  container), so the typed text shows at once. The field is set in Latin
  Modern, the PDF's own font (`fonts/`, loaded with `next/font/local` on
  this page only), at the line's size, weight and slant, with its baseline
  on the PDF's, so its text covers the printed glyphs and wraps where the
  PDF does; before this, a wider fallback serif wrapped early and the field
  covered the lines below. It opens with the caret where the press landed
  (`caretPositionFromPoint`, measured from the pages' top left, because the
  bar can change height in the same render). It saves after a 700 ms
  pause, on blur, on Enter, or when another line is selected; then the PDF
  renders again. Every save bumps one request counter and a response older
  than the latest is dropped, so a slow render never paints over a newer
  edit. A bullet's text becomes this resume's local variant; an entry's
  title, organization, location, GPA, coursework and honors change the
  bank (user story 61), and the header's name, phone and links change the
  profile. `model.ts`'s codecs say how each field reads and saves; a
  detail line shows its printed label ("GPA: 3.81/4.00"), so the field
  covers the whole line. Dates and the degree line are built from several
  fields, so they are not typed here: the bar links to the Experience Bank.
  The email is the sign-in address and is not typed either. A contact the
  profile lacks has no line to click, so selecting the header puts "Add
  Phone" and the next missing link in the bar. Picking a wording (bar or
  assistant) drops the typed draft, so the field shows the picked text.
  Escape, Done or Enter clears the selection (Enter saves first), and so
  does a press outside the page, the bar and the assistant panel, which
  carry `data-keeps-selection` (the assistant acts on the selected line).
  The phone editor keeps its own sheet: Enter there only saves.
- **The sticky bar** sits above the page, so a line's actions never cover
  nearby lines. With a line selected: Hide (Hide Entry), Move Up and Move
  Down (entries within their section, bullets within their entry, one PATCH
  that renumbers the siblings), the bullet's wordings (Original, each
  Tailored version, This Resume's Wording) and, on Education, Show/Hide GPA
  and Coursework. A press on a bar button keeps focus in the field. With no
  line selected: the page-count chip ("1 page", "2 pages · 3 lines over
  1 page", from the render's `lines_over`, an estimate) and, over one page,
  Fit to One Page, then Undo, which shows again everything Fit hid (the
  response's `undo` body). Undo is kept in sessionStorage per resume
  (`fit-undo.ts`), so a reload in the same tab still offers it. The bar also
  says "Saving…" or the last round trip ("Saved, 412 ms"), the measure for
  the Vercel preview check.
- **Fit to One Page is the API's** (`POST .../fit`): it cuts least useful
  first, in steps across every section: coursework (beside Experience),
  then bullets past a cap per entry, then the bottom entries of
  Leadership, Awards and Certifications before Projects and Experience,
  re-rendering until the page fits and putting back what it did not need
  (`backend/CLAUDE.md`). It never cuts Education, Skills, an entry's first
  bullet, or the top Experience and Projects entry.
- **"Not on This Resume"** (`tray.tsx`) under the page: entries the resume
  does not show (hidden, or added to the bank after Generate), hidden
  bullets of shown entries, and hidden skills. One click puts one back; an
  entry joins the end of its section with its bullets.
- Skills can be hidden but not moved: they print grouped, and a move
  inside a group is still open.
- A failed render shows "This Resume Isn't Loading Right Now" with the API's
  message and a Try Again link; a failed save shows the API's message above
  the page and keeps the last PDF.
- **On a phone** (`phone.tsx`, the KAN-201 prototype's variant A), below
  40rem of window width, the editor's same state and saves take a different
  layout; `editor.tsx` only hands them over, so the two layouts never save
  differently. The page fills the width and stays the editor. A tap on a
  line opens a bottom sheet with **no scrim** (the page above still scrolls
  and takes taps) holding the line in a **16 px field** (smaller, and iOS
  Safari zooms the page on focus), the sticky bar's actions at **44 pt**
  (Apple's smallest touch target), and **previous and next arrows** that
  step through the boxes in page order (page, then top, then left), so a
  mis-tap on a 7 px line costs one press. **Zoom** draws the page at two
  times the width, scrolled sideways; Fit Width undoes it. The selected line
  scrolls to the middle of the page area. The tray opens from a bottom
  button in its own sheet (with a scrim). The layout is a fixed layer over
  the seeker shell, **sized to `window.visualViewport`** (height, moved down
  by its offset): the iOS keyboard covers the layout viewport instead of
  shrinking it, so a layout sized to the window would put the sheet behind
  the keyboard. A back arrow goes to the Experience Bank. The first paint
  is the desktop layout (the server cannot know the width), then a phone
  switches. Manual checks on a real iPhone: the sheet stays above the
  keyboard, and the field does not zoom; and the render time on cellular
  data, read from "Saved, N ms".
- **The assistant** (`assistant.tsx`, KAN-221; the KAN-195 prototype's
  variant E) opens from Ask WorkIt in the sticky bar and **docks beside the
  page** from @4xl/main (sticky, never over the page); narrower, it stacks
  under it. On a phone, Ask WorkIt in the bottom bar or in a line's sheet
  opens it in its own sheet. It stays mounted while closed, so closing it
  keeps the chat; nothing is stored. The look is intake's (variant G:
  lavender panel, WorkIt's mark) and the bubbles, dots and composer are
  Scout's `chat.tsx`. It does four things, all through the editor's own
  saves: Fit to One Page, hide and move the selected line, and **Make it
  shorter** for a bullet, which shows the old and new wording with Use This
  (saved as this resume's wording) or Keep Mine. **It does no other
  rewording**: a typed message goes to `POST .../assistant`, which only
  names one of those actions, and every line it says is the API's fixed
  text (backend/CLAUDE.md, "The editor assistant"). The chips (Hide it, Move
  it up, Fit to one page) act with no AI call; Make it shorter and typed
  messages spend one of today's assistant messages ("N messages left
  today"). The sticky bar stays the free path for everything. Manual
  checks: a typed "hide this" on a selected bullet hides it; Make it
  shorter waits for Use This; the phone sheet opens from both buttons.

## Scout panel

Scout, the job assistant, lives in `components/scout/`; its brain is the repo's
`scout/`, so read `scout/CLAUDE.md` first. `scout-store` holds the one chat per
tab (a module store, so no provider). `scout-panel` docks beside the page, never
over it, and opens only on a click (the Jobs page's Import Your Resume
counts: `/bank?import=1` opens it on arrival, then drops the param). A page
can take it over (`scout-takeover.tsx`, the Experience Bank's intake): the
page's content replaces the chat and the panel widens to 448px. It stays mounted and opens in two moves: its
room appears at once and the page settles into its new width, while the panel
slides in from the window's edge (`docs/motion.md` has why). Escape or its X
closes it and hands focus back to the bar's launcher, which shows pressed while
the panel is open. `chat.tsx` holds the message bubble, typing dots and
composer (with the mic, `use-speech-input`) and WorkIt's mark, shared with
intake on the bank page and the editor assistant; each takes who is talking
as a prop. `stream.ts` mirrors the API's NDJSON events, which
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
