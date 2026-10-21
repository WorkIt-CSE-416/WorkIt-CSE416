# Screens

How each screen behaves and why: the Jobs page and its filters, the job
posting page and card, the seeker Dashboard, Applications, the Calendar, My
Profile (resumes, photo), Resumes & Experiences, Scout's panel, applicant
onboarding, and the company screens. Read the section for a screen before
changing it.

## Jobs page, /search and filters

**/jobs is one list with a Sort By control (KAN-288).** Best Match
(`?sort=match`), the default, is the jobs the filters keep, scored against the
seeker's experience bank and best first (`GET /jobs/recommended/{id}`, which
takes the same filters as `GET /jobs`), with the match rail showing each score
and its highlights. With an empty bank it shows the newest first under the
same filters, below the bank prompt, and so does a company account, which the
API refuses (403). Newest (`?sort=newest`) is the plain feed. Each option keeps
the filters as they stand. Until KAN-288 these were two views, Recommended and
All Jobs, behind a switcher (KAN-231); they drew the same filter row and cards,
so students read them as one page. An old `?view=all` link opens Newest and
`?view=recommended` opens Best Match (`readSort` in jobs/page.tsx). **Saved
preferences apply on a fresh visit only**: bare /jobs redirects to
`?sort=match` plus the saved filters, where the row shows them checked; from
then on the URL is the truth, so Clear All clears rather than bringing the
saved ones back. Load More pages whichever order drew the list (`FeedList`'s
`source`).

**Job Type and Experience Level never overlap (KAN-284).** Job Type says
what kind of job it is (Internship, Full-Time, Part-Time, Contract);
Experience Level how much experience it asks for (Entry Level / New Grad,
Experienced). Experience used to offer Student, which meant exactly the
internships, so Student with Full-Time matched no job; with Job Type in All
Filters only, a fresh visit on those saved preferences opened on "No Roles
Match These Filters" and the seeker never saw the pick that caused it. Every
internship counts as entry level (the API's `filter_levels`), so Internship
with Entry Level / New Grad shows the internships. A saved preference or link
that still says `?experience=student` reads as Internship
(`withLegacyStudent` in jobs/filter-query.ts): beside other job types it
joins them, alone it becomes them, and with no job type and another level it
adds nothing. Experienced holds no job until the scraper keeps such roles;
then it splits into Junior, Mid and Senior.

/jobs and /search filter on the server by the query (/search's ?q= is read by
the API's role resolver: roles, a typo corrected, then text and company):
?location= (repeated ISO
codes, US or US-CA), ?work_style=, ?role=, ?experience=, ?job_type= (repeated),
?posted_within= (days), ?min_pay= and ?max_pay= with ?pay_per= (hour or year),
?start_term= (seasons), ?visa= and ?auto_apply=true, GET /jobs' own names. jobs/filter-query.ts
reads and writes them for the pages and the row alike, dropping any value the
API would refuse, so a stale link narrows by what was valid instead of erroring.

An empty experience bank gets a card above the /jobs feed, "Add Your
Experiences" or, with an upload, "Import Your Resume"
(`jobs/bank-prompt.tsx`, stories 22 and 102): with an uploaded resume,
"Import Your Resume" opens `/bank?import=1`, which runs Import Again at
once (one click; it writes into the bank, ADR 0003). An upload imports
itself, so the card shows only for an upload the parser read nothing in or
one from before KAN-240. With none, Upload a Resume (to `/resumes`) and Add What You Did. It streams in its own Suspense
boundary and shows nothing when the bank has entries or fails to load. The
feed under it is the newest first, not a bank match, since Best Match
needs the bank; this card is Best Match's empty state.

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
All Filters stays a normal button; never stretch it across the row. The row
is 928px at most, room for five facets: Location, Role, Workplace, Job Type
and Date Posted. Job Type took Experience's place (KAN-284), since it is
where Internship is picked, and Experience Level is in All Filters only. Each facet is at least 144px and as wide as its label needs,
so Date Posted is 149px rather than cut short. While any filter is on, Clear Filters sits just before All Filters
(KAN-252, asked for 2026-10-17), an outlined X at its height with "Clear
filters" in its tooltip, and turns every filter off, keeping ?sort and ?q; a
cleared /jobs with no ?sort lands on ?sort=match, since the bare URL would
bring the saved preferences back. As the words "Clear Filters" it took
the room of Date Posted at every width and wrapped the row on a phone. The
widths at which the facets step in leave room for it whether or not it shows,
so a pick never pushes a facet out of the row (filters.tsx lists them). Role
(KAN-155: the `job_roles` list, slugs like software_engineer, a job tagged with
each role its title names, so it counts under each) sits second, after Location,
as the facet a seeker narrows by first; no pick shows every role. Its options
are not in the code: the row and the panel read their names from GET
/jobs/facets' `role` (only roles with a job, in the database's order), and the
row's Role waits on them behind a disabled button as Location waits on its
places. filter-query.ts checks a ?role= by shape only, like a place, so an old
KAN-172 link's "data_ai/ml" is dropped, not sent.

All Filters opens one panel (jobs/all-filters.tsx) with every facet's options in
view as chips, or a search picker for the long lists, and no facet popups inside
it (they landed left or right of their button by the room). Its last section,
Auto Apply (the Zap glyph a job's Auto Apply button wears), has one chip,
Auto Apply Supported: on, the feed shows only the job postings auto apply can
fill, the ones with an Auto Apply button (Greenhouse for now, `?auto_apply=true`,
counted by GET /jobs/facets' `auto_apply`); off, every job posting. Like Visa,
it is in All Filters only (asked for 2026-10-17). Its picks are a
draft until "Show N Jobs", which counts the draft as it changes (GET /jobs/count
via jobs/actions.ts). Applying a filter dims the feed at once (jobs/feed-
transition.tsx: the row and the feed share one transition), since the narrowed
page is a round trip plus the API's half second away; the row's places and
facet lists (GET /jobs/facets) are fetched once per visit and cached five minutes (COUNTS_TTL in
jobs/listings.ts), not refetched per change. Each facet button wears the glyph
the job card draws for its fact (Date Posted a clock, since the card's calendar
is the start date; Role, which the card doesn't print, a person in a suit and
tie, drawn for it since Lucide has none, KAN-252), and inside a popup only
Workplace's options carry glyphs, the card's own three, as their chips do in
the panel, where Experience Level's do too (levelIcon: the mortarboard, a
check badge; KAN-252, asked for 2026-10-17). Options are medium weight, as the
facet buttons are; at body weight they read thin beside the row. A facet's popup is as
wide as its longest option, never narrower than its button and never wider than
the screen (FacetPopup, KAN-252): the vendored Select is only the button's
width, which wrapped Role's options onto up to four lines and cut off
Infrastructure Engineer's checkbox. Salary is a range, "$ 30 /hr – $ 50 /hr", either end open,
with presets (hourly when only internships are picked, yearly when none are, `payUnits`) that fill the
minimum; a posting matches when its own range overlaps it, compared as yearly
figures in USD.

Location, Role and Start Date in the panel are one picker (SearchPicker in
components/filter-controls.tsx, shared with onboarding; Role's specialties indented under their category, as a
country's states are, and named whole, "Mechanical Engineering", since a search
lists them alone): a search field whose checklist opens only from the field and
floats over the panel like a dropdown (it never pushes the sections down; it
opens upward, and no taller than the room, when the panel's scroll area has less
room below than above, as at Start Date), a keyboard combobox (Up, Down, Enter,
Escape closing only the list), picks shown below as pills with a cross, and
nothing pre-picked. Clear All remounts the pickers so typed text clears too. The
row's Role is a checklist dropdown with a search field at its top (KAN-252,
asked for 2026-10-17: forty-odd roles were too many to scroll), Workplace's rows
under the panel picker's field. It is Base UI's Combobox, not a Select, since a
Select whose rows come and go undoes an untick (below). A pick keeps the typed
search, as the panel's picker does, and each open starts empty. A picked state narrows its country, in the panel as in the row. Start
Date offers seasons (Summer 2027), grouped by the API from the terms postings
use; Visa offers Sponsors Visas alone (Hide Jobs That Rule Me Out went in
KAN-275, as two visa filters read as one). No option shows
a job count, in the row or the panel (removed 2026-10-17, KAN-252, as clutter);
the panel's Show N Jobs is the one count. GET /jobs/facets still sends them.
Location, fed by GET /jobs/locations, is a Popover of two
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
The page is capped at 70rem (1120px), a little wider than the other reading
pages' `max-w-app`, which left its facts and checklist cramped (KAN-279).
It is the mock's `JobDetailHeader` with the card's own facts
(`listingFacts` in `listing-card.tsx`) and the employer's 40px logo and
16px name, then one
"About the Role": `[jobId]/description.tsx` reads the plain-text description's
own shape (Title Case lines as subheadings, the short lines under one as a
list), and a description the scraper cut at 8,000 characters (it ends " …")
says so and links to the whole posting. Its paragraphs and list items are
ink, the headings' colour, not body copy's lighter ink-muted: a posting is
long reading, and the grey was hard to read (2026-10-17). Each of KAN-229's
fixed section headings (Overview, Responsibilities, Requirements, Preferred
Qualifications, Pay, Details) draws an icon beside it in brand purple
(`SECTION_ICONS`; Pay reuses the salary fact's coin). All Filters' section
icons stay grey: there they label controls, here they mark where to read.
Section titles are 16px bold with a 20px icon, a step under "About the
Role"; an employer's subheading is 14px semibold. List bullets are ink, like
the text. **A sectioned description always shows Overview, Responsibilities,
Requirements and Pay** (`withCoreSections`, KAN-229 fix 5); Preferred
Qualifications and Details only when the posting has them. A missing core
section says why, as far as WorkIt can tell: pay the hiring system sent as a
field shows as the card's pay "(from <company>'s listing, not the posting's
text)"; a description cut at 8,000 characters says the section may be further
down; anything else says it isn't under its own heading and may be in the text
above, since a heading the scraper doesn't know ("Role Purpose") leaves its
text in the section before it. All
three link to the full posting. It never says a posting lacks something, since
the text may hold it in a paragraph the scraper could not place. A fixed
heading always reads as a heading, even straight before an employer's own
("Requirements" then "Required Qualifications"), which the two-in-a-row rule
read as list items. In such a
description, any other heading the employer wrote is a smaller subheading with
no icon; a description stored before KAN-229 draws its headings as before.
**Benefits, How to Apply and About the Company come last, folded**
(`EXTRA_SECTIONS`, 2026-10-18): one "More from the posting" row, bordered like a
card, names the ones the posting has and opens on a click (a `<details>`, so the
keyboard and a screen reader work without code); inside, each has its own
purple icon (a gift, a paper plane, a building, not On-Site's). The job's own
sections stay first and open, since they are what a student reads first, and
matching never reads the folded ones. Only the job's headings make a
description sectioned, so an old one with its own "Benefits" line draws as
before.
Apply Now (`jobs/apply-button.tsx`,
KAN-220) opens "Pick a Resume": the student's base resumes, the one tailored
to this posting and the uploaded resumes, with the tailored one, else the
default, picked first. Apply keeps a sent resume linked to the posting, then
shows Open in Resumes and Open the Posting (links in new tabs, so no popup
blocker stops them and the dialog stays to ask "Did You Apply?"). **The
dialog downloads nothing** (KAN-267): a student gets resume files on
Resumes & Experiences only, so Open in Resumes goes to a built resume's
editor (its Download) or, for an upload, the Resumes view. It had a
Download Resume button until then. Apply Without a Resume leaves for the employer's posting at once.
**Every Apply Now opens this dialog** (KAN-290): the page's, the feed card's
on /jobs and /search, and New Matches' Apply on the Dashboard. WorkIt cannot
see the employer's site, so the dialog is its one chance to learn which
resume went and whether the student applied; a card's Apply Now once linked
straight to the employer and recorded neither. A card's button has no
new-tab glyph, since it opens the dialog and the dialog's links carry it.
Once a resume is sent, the page reads "You sent <name> on <date>" under
the header (`[jobId]/sent-note.tsx`, story 98), the last sent resume
linked to this posting, its day in the viewer's zone. Only the job's own
page refreshes on a send (`showsSent`): on a card a refresh reran the whole
feed, Best Match scoring and all, to redraw nothing.
The job's actions sit in one bar with Back, pinned at the top from md
(`[jobId]/action-bar.tsx`, KAN-246): Save, a "…" menu, Ask Scout, Auto Apply,
Tailor My Resume and Apply Now. Below md the bar scrolls away and wraps.
The header card below holds who is hiring, the title and facts; its logo never
shrinks. Its facts use the card's `JobFacts`: two rows of three fixed slots,
two columns under 448px, with unstated facts leaving their slots empty.
The "…" menu (`MoreActions`, `[jobId]/page-actions.tsx`) holds Copy Link
and Report. Ask Scout asks about the role, Copy Link copies the page's link, and Report
stays inert. Save (KAN-261) keeps the job posting in the Saved column on My
Applications, on the card and the page alike (`jobs/save-job-button.tsx`,
over the drawing-only `components/save-button.tsx`): the bookmark fills at
once and empties again, with a toast, if the API refuses, and a second
click takes it back out. It reads its first state from the same stage the
Auto Apply button gets, so it costs no fetch of its own. A job posting
already queued or applied stays as it is, and a toast says where it is.
Saving never queues a job: Start Auto Apply's batches skip saved jobs, and
only the job's own Auto Apply button queues one. The
card's own row has Not Interested, Save, Ask
Scout, Auto Apply, Tailor My Resume and Apply Now. Tailor My Resume is the
page's button on the card too (KAN-241): it opens `/jobs/[jobId]/tailor`
and reads "Your Tailored Resume" once the student has one for that job
posting. /jobs and /search read the built resumes once beside the first
page (`getTailoredJobIds`) and hand each card its answer, as for Auto
Apply; signed out, every card reads Tailor My Resume. Auto Apply shows only on a job posting the
API marks `auto_apply` (its hiring system is one auto apply fills:
Greenhouse for now, `backend/app/auto_apply/hosts.py`); every other job
posting has no Auto Apply at all. It sits between Ask Scout and Apply
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
round. A failed Undo says so in a toast and leaves the button Queued.
A click that leaves the job queued then runs Start Auto Apply's pipeline
without the matching: it asks the extension to open the oldest queued job
in a background tab beside this one (`openNextApplication`), which is this
job only when nothing older waits. It runs after the click settles, so the
button never waits on a page load; only a failure shows, as a line above
the button (no extension stays silent). The job open in that tab reads
**Working in Browser** (the AppWindow glyph) on every card that shows it,
read once per page from the extension (`useRunnerJob` in
`src/lib/autofill-extension.ts`, asked again whenever the tab gets focus).
It goes back to Queued only when the extension says the tab is closed,
never on a failed answer: coming back from the run's tab once reset it;
a click switches to the tab (`showRunTab`, tooltip "Go to the tab"), and the job
leaves the queue from Live Activity only. Its first state comes from
the server: the job's page reads its one application (`GET
.../applications/{job_id}`), and /jobs and /search read every application
once beside the first page (`getApplicationStages`) and hand the stages to
each card, Load More's too. A stale one is harmless: a click answers the real
stage. Back returns to the list the seeker came from: the feed, filters and all, or
the Auto Apply page (`RememberFeed` on /jobs, /search and /auto-apply keeps
the last one visited in sessionStorage), or the Resumes page when a
tailored resume's posting link opened it (`rememberReturnTo`, KAN-268, set
on the click rather than the visit, so a job opened from elsewhere after a
look at /resumes does not go Back there). When the seeker came straight from
that list (`cameFrom`, (seeker)/scroll-memory.tsx), Back goes back in history
as the browser's Back does: the router redraws the list it kept at once.
Following the link instead is a fresh visit, which fetches the feed again and,
in Best Match, scores every job again, so the list sat on its skeleton
(2026-10-19). It says only "Back", whatever the
list: the server cannot read sessionStorage, so a label naming the list
would change a moment after the page loads.
**Marking a job applied** (KAN-232) is a question, not a button (KAN-242).
When a signed-in applicant leaves for the employer's posting from Apply Now's
dialog, by Open the Posting or Apply Without a Resume, the dialog stays open
behind the new tab and asks "Did You Apply?". **It shows the resume they
applied with** (KAN-267), under "Resume You Sent": the resumes Pick a
Resume lists plus No Resume, starting on the one picked at Apply, or No
Resume after Apply Without a Resume. The student can change it, since they
may have attached another file on the employer's page. Yes, I Applied keeps
a resume other than the one sent as a sent resume for this posting first
(`applyWithResume`), then calls `markApplied` (`jobs/actions.ts`) with
that sent resume's id, or null for No Resume: the application names it
(`job_applications.sent_resume_id`), and the tracker shows it. Not Yet
closes it. A job already marked is
never asked about again, and anyone else's dialog just closes. The page then
reads "You applied on Oct 17, 2026" under the header (`AppliedNote`), the
viewer's own day after hydration. An Applied button in the header did this
before, and one misclick took a job off the feed with no undo. The job then
leaves that applicant's feed, /search and count, because `listings.ts` sends
their token with those reads (`viewerToken`) and the API filters on it. There
is no undo yet.
The cards ask the same way, but only an applicant account (`isApplicant` in
`jobs/listings.ts`, the account the shell already read): a company account
can open /jobs and /search too, and its dialog just closes. A card marked
applied leaves its list at once, in the browser (`FeedList`, KAN-290
review), with focus on the next role's title: a refresh redraws only the
server's first page, so a job from a Load More page stayed listed. The kept
Load More offset drops by one with it, as the API's later pages move up one,
so the next Load More skips nothing. New Matches refreshes the route, which
drops the row.
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

**Next Up, Up Next and Waiting are archived for now** (KAN-261), and the
header's Find Jobs button is gone (the sidebar's Jobs row and New Matches'
Newest Jobs lead there; it read "All Jobs" until KAN-288 retired that view). The tracker stores no dated events yet, so Next Up and
Up Next only said "nothing scheduled", and Waiting's buckets were a fixture.
Under the numbers, New Matches runs the full width with Activity under it.
From `@4xl/main` New Matches has a fixed height (`h-96`, set in the page's
`PLACE`) and its list scrolls inside it: the tile is built to take its
height from a neighbour, so alone on a row it would collapse.
The archived tiles' code stays (`next-up-hero.tsx`, `up-next.tsx`,
`getUpNext`, `waiting.tsx`, `WAITING`); `PLACE` in `dashboard/page.tsx` says
how to bring them back. The notes below still describe them.

**The seeker Dashboard is a bento of tiles** (KAN-173), modelled on a
reference the user picked: white tiles with no outline on the white page
panel, set apart by a soft violet-tinted `--shadow-tile` alone,
`rounded-shell`, `p-5`, 16px apart. An outline on every tile read as a grid
of grey boxes, and a lavender ground under them read as muted beside the
shell's white panels; keep both off. Headings and figures are medium weight, figures in
`--text-figure` (36px), and actions are the app's rectangular buttons (they
were pills, `shape="pill"`, until KAN-251 made every pill a chip). It
alone is capped at `max-w-dashboard` (1440px) rather than `max-w-app`.
From `@4xl/main` (896px, not `@5xl`'s 1024: a 13-inch laptop at 100% zoom
gives the page about 1010px and fell back to two columns of oversized
tiles) the four numbers run across the top in a grid of their own (the
first filled violet, the only solid tile), and the tiles under them sit in
thirds. Left to right is apply, then manage: New Matches two thirds wide
beside Next Up (a white reminder tile, its title in violet over one filled
button) over Up Next, then Activity two thirds wide beside Waiting (three
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
filled primary sm button, and opens Apply Now's dialog (KAN-290). A KPI tile centres its label on its 36px ring (the ring
hides below 10.5rem of tile), keeps that header row 36px tall, pushes its
figure to the foot, and gives the line under it a fixed `h-5`, hiding "vs
last week" where it would wrap, so every figure in a row sits on one line.
A scroll area inside a tile uses `scrollbar-quiet` (globals.css) and puts
its edge on the tile's edge: New Matches reaches into the tile's right
padding (`-mr-5`) and pads its rows back in (`pr-5`), so the bar runs down
the tile's side instead of beside the Apply buttons. There is no
pipeline section: its
funnel only restated the headline numbers. Fixtures are in
`(seeker)/dashboard/data.ts` until the tracker stores stages past applied,
except Saved, which counts the live saved jobs, and Next Up and Up Next,
which take the tracker's upcoming events (`getUpNext`). The tracker stores
no dated events yet, so Next Up reads "You're All Caught Up" with Browse
Jobs, and Up Next "Nothing else scheduled." Next
Up's View Details button opens that application's own page (its old
`?app=` link redirects there) and its date that week on
the Calendar; an Up Next row opens its day in the Calendar's Agenda, and View
All the Agenda; Waiting's Follow Up opens the Applications list filtered to
Applied. That is a placeholder: it helps nobody contact anyone, and KAN-174
(still open) plans the real flow, a list of only what has waited two weeks,
a Scout-drafted note, a recruiter search, then marking an application
followed up or closed once the tracker has a backend. The headline numbers are Applications, New Roles, Interviews and Saved
(`getHeadline` in `dashboard/data.ts`); New Roles and Saved replaced
Response Rate and Offers, which for a student sit near zero all season. New
Roles is the live feed, `GET /jobs/count?posted_within=` for the range and
the window before it, cached five minutes; Saved counts the seeker's live
saved jobs (KAN-261), ignores the range, and shows a dash when they can't be
read. Only those two tiles link (to the Jobs page filtered by date posted,
and to the saved applications), since their figures are what their
destinations show; Applications and Interviews are a separate fixture from
the tracker, so a link would open a list that disagrees with its number. Its range is `?range=`, moved in place: the
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

/applications is the tracker: a list (the default) and a grid over
`applications/data.ts`, every choice in the URL; a row or card opens the
application's own page, `/applications/[jobId]`. `(seeker)/tracker.ts` is the tracker's shape
and date logic; `local-time.tsx` prints its dates in the viewer's own zone and
links them to the Calendar.

**The tracker is live, with no fixture** (KAN-261). `applications/tracked.ts`
reads the seeker's saved and applied jobs from the API
(`GET /applicants/{id}/applications?stage=saved&stage=applied&scored=true`,
the list Live Activity reads too), written by a job's Save button and its Applied button
or auto apply; `getTracker` in `data.ts` caches it per request. Interviewing
and Offer stay empty until the API stores those stages, and nothing on this
page moves a card between stages. A card is its job posting: its id is the
posting's, its tile the company's own logo (`application-tile.tsx`; initials
without one), and its panel links to the posting while it is open ("Posting
Closed" after). The page has three empty
states: the API failed, nothing tracked yet (Find Jobs), and filters that
hide everything (Clear Filters). The mock cards and their stand-in company
glyphs were removed with the fixture.

**The list is the primary view and the board is archived** (KAN-256).
A bare `/applications` shows the list, the switcher offers List then Grid,
and an old `?view=board` link opens the list. `applications/board.tsx`
stays, unused. To bring the board back: add `"board"` to `VIEWS` in
`applications/query.ts`, its option in `view-switcher.tsx`, its pane in
`page.tsx` (the comment there has it) and its `board:<stages>` key in
`view-panes.tsx`. In the list, Match outlasts Applied as the page narrows,
since the score is what a seeker scans for.

**A card shows four facts and nothing else** (KAN-256): the role, the
company, the day it was saved or sent, and its match score. The grid adds
the stage pill, which its ungrouped cards would otherwise lose.

**The list is a table that scrolls sideways** (KAN-256), as a Notion table
does, rather than dropping columns as the page narrows. In the order job
trackers read: what and who (Role, with its company), where it stands (Status, Date
Applied), how good it is (Match), the job's facts (Track, the job type;
Location; Work Model; Pay Range), where and what was sent (Source, the
hiring system the posting is on, named from its apply link in
`applications/tracked.ts`, "Company Site" for any other host; Resume;
Posting), and Notes / Next Step last, the widest and least scanned.
**Role is one column holding the company too**: the company's logo, then
the role (bold, the row's link, cut with the whole title on hover) over the
company's name in meta grey. KAN-256 split them into two frozen columns,
Company then Role; together they took about 500px, so few other columns
showed, and KAN-282 stacked them again. The company is still its own field
for the filters and the sort. **Role stays frozen** at the left
while the rest scrolls under it (a sticky cell painting the row's
background and its hover tint; the edge is a shadow, since a collapsed
table's borders don't move with a sticky cell). **It freezes from 672px of
page up only**: at 320px it is about a phone's whole table, and frozen
there it covered it, so the scroll showed no other column; below 672px it
scrolls with the rest. A sticky
cell traps a stretched link, so **the row opens the application on a click
anywhere** (`components/clickable-row.tsx`, Live Activity's rows too), leaving clicks on links and
buttons alone and opening a new tab on Cmd or Ctrl; the role is still the
real link a keyboard reaches. Sorted by Date Applied unless `?sort=` names
another column (below). Notes / Next Step is a placeholder ("No notes yet") and
Status is only Saved or Applied until the API stores notes and later
stages. Resume is the sent resume the application names
(`sent_resume`, KAN-267): the one picked on "Did You Apply?", or the one
auto apply attached; "Not sent" when the student said No Resume, applied
before KAN-267 with nothing sent, or deleted that sent resume. **With one, the cell is View Resume** (KAN-267,
`applications/view-resume.tsx`): an sm button naming the resume, the cell's
whole width, that opens it in a dialog over the list, 80% of the window's
width and height (it follows a resize), the PDF filling it. A click anywhere in
that cell around the button is a near miss and opens nothing (it is
prevented, which `ClickableRow` leaves alone), and a click inside the
dialog stops there. The dialog shows the PDF in a frame: a built resume's
snapshot rendered again, or an uploaded file through a link signed to
open, not download (asked for again on each open, since it lasts 5
minutes). A rebuilt upload (its upload replaced or deleted since) says so,
with Show Original Text for the file's own words. A Word file cannot be
shown in a browser, so it points to Resumes & Experiences instead.
Nothing downloads here. A grid card with a sent resume carries the same
button above its footer, on a strip that sits over the card's stretched
link, so the strip's gap is no misclick either. Location and Pay print as the Jobs page's card does
(`jobs/format.ts`). The cells are drawn as the job cards draw their facts
(`ui/fact.tsx`): a grey glyph, then the value in ink, and a missing value
in meta grey; Status, Match and Posting are pills (Posting `positive` Open
or `inert` Closed). Posting says Open or Closed and nothing more, because
scraped postings state no closing date: `job_postings.closes_at` is only
set when a posting disappears, and the API does not send it. The page has
no width cap and takes back the room a collapsed sidebar frees
(`docs/design.md`, The two shells), so the table shows as many columns as
the window allows before the scroll.

**The list can be arranged like a Notion table** (KAN-282). It is a
TanStack Table v9 (`applications/list.tsx`; `company/table.tsx` says why v8
examples do not apply), a client component over the rows the server
filtered.

- **The filter row, laid out as the Jobs page's** (`applications/field-filters.tsx`,
  `filter-bar.tsx`; a plain dropdown is `components/field-facet.tsx`, which
  Auto Apply's Status filter shares): under the search, a row with a dropdown for Status
  and one per field (Company, Track, Work Model, Source), each the Jobs
  page facet's look (glyph, label, chevron, brand tint while it holds a
  pick) over checkbox rows. Status lists the four stages, each with its
  stage's glyph in its colour; the fields list every value the tracked
  applications hold. **Company has a search field** at the top of its
  list, as the Jobs page's Role dropdown does, since the list grows with
  every application; a pick keeps the search. The dropdowns step out one
  at a time from the right as the row narrows (Status from 440px of row,
  Company 592, Track 744, Work Model 896, Source 1048); at
  the right end, Clear Filters as an outlined cross (shown while anything
  is picked or searched; it hands focus to All Filters), All Filters, and
  Columns in the list view. A phone's row is All Filters and Columns.
  Status was a row of stage chips with counts (KAN-256), and an earlier
  draft had one Filter button with every field in its menu; both became
  dropdowns after the Jobs page on the user's ask (2026-10-19). The
  chips' counts went with them, as the Jobs page's options carry none.
- **All Filters** is a panel with every field, as on the Jobs page: Status
  (with the stages' glyphs), Company (a search
  picker, since the list grows), then Track, Work Model and Source as
  option chips. Its picks are a draft until "Show 3 Applications", which
  counts the draft in the browser (the page hands the bar what each
  tracked application is filtered on); closing it drops the draft.
- **Picks**: in one field, any of them; across fields, all. Each is a
  repeated URL parameter (`?company=`, `?track=`, `?work=`, `?source=`),
  not a comma list, since a company's name can hold a comma. A pick
  replaces the URL (ten ticks are not ten steps of Back) and shows at once
  while the server filters, as the Jobs page's facets do.
- **Sort**: five headings sort, each one way, the way it is read: Role by
  its company A to Z, then by role, so a company's roles sit together
  (`?sort=company`; the heading's tooltip says so), Status furthest along first, Date Applied latest first, Match
  best first, Pay Range best first (the top of the range as a yearly
  figure, `payPerYear` in `applications/tracked.ts`, so hourly and yearly
  pay compare). A missing value goes last either way. A heading moves
  `?sort=` in place (shallow routing): the table sorts the rows it holds,
  with no round trip.
- **Columns**: drag a heading by its label to a new place (a brand bar
  marks the side it lands on); drag a heading's right edge to resize it,
  double-click the edge to reset it, or focus the edge and use the arrow
  keys; hide and show columns from the **Columns** menu at the filter row's
  right end, which shows only in the list view and also has Reset Columns.
  Role cannot move or hide. Each column has a fixed width
  (a fixed table layout) and cuts what does not fit, with the whole value
  on hover; an empty last column takes the card's spare width, so a resize
  never stretches the others. A drag needs a mouse: a phone keeps the
  order it has.
- **The layout is this browser's** (`applications/column-layout.ts`): order,
  hidden columns and widths, in localStorage under a `lib/local-drafts.ts`
  key, so Sign Out clears it. The server draws the default and the stored
  layout swaps in after hydration. It is not in the URL, since a shared
  link should carry the view, not the sender's column widths; keeping it
  per account needs an API change. A layout stored under column ids that
  are gone (the old Company column) drops them on reading.
- A resize press cancels the browser's default, and no move starts during
  a resize: shrinking a column slid the next heading under the pointer,
  Chrome began dragging that heading, the mouse-up never reached the
  resize, and the column kept following the pointer.

**Application dates are real dates.** Saved and applied dates are the
instants the API stored (`getNow`, `cache()`d, is what the pages compare
against). The shape is `(seeker)/tracker.ts`: an ISO instant for something
at a time, a bare ISO date for something due on a day. `<LocalDate>` reads a
bare date in UTC in the browser too, since on a local clock it is the day
before in the Americas. The server decides
what is upcoming against `getNow()` (a day-only entry stays upcoming until
its day has ended in UTC-12) but never which day an instant falls on: it
prints the UTC date, and `<When>` in `(seeker)/local-time.tsx` swaps in the
viewer's own "Tomorrow, 2:00 PM" after hydration.

**The Applications page keeps every choice in its URL** (`applications/query.ts`):
`?view=`, `?stage=` (a comma list), `?q=`, the filter fields and
the list's `?sort=`. An old `?app=` link (the side panel's) redirects to
the application's own page. The server does the filtering, so the search
is a GET form and a pick in a dropdown or in All Filters a URL replace,
and the Dashboard can link to a filtered list or one application. The
list's column layout is the one choice kept in the browser instead
(above). The layout is the exception in how it
moves, not in where it lives: the page renders all three layouts, each
building its links for itself, `applications/view-panes.tsx` shows the one
the URL names, and the switcher moves `?view=` in place. Anything else that
builds a link from the layout (the filter bar, Clear Filters, the list's
sort headings) reads it in the browser through `useApplicationsQuery`,
since a layout switch never asks the server to draw them again. A card is
one link: its role, stretched over it; a row opens on a click anywhere
(above).

**An application has its own page, `/applications/[jobId]`** (KAN-256),
which replaced the side panel: the panel had room for a timeline but not
for the job. **Its job half is the job page itself**: the pinned action bar,
the header and the Job Description tab are the parts `/jobs/[jobId]` draws
(`jobs/[jobId]/job-view.tsx`: `loadJobView`, `JobViewActions`,
`JobViewHeader`, `JobViewBody`), so the two pages look the same and cannot
drift apart. They share the job page's width too (`JOB_PAGE_WIDTH`, 1120px,
KAN-279). Only Back differs (Back to Applications, `JobActionBar`'s
`back` slot). No match rail, as on the job page: an earlier draft added the
Jobs card's ring, which made the same job look different by how it was
opened. Analytics and explanations go on the Your Application tab only.
**The bar holds the tabs once there is nothing to do**: an applied job, or a
closed posting, has no use for Apply, Tailor, Save or Ask Scout, so the bar
shows the tabs beside Back instead. A saved job with an open posting keeps
the job page's actions, and its tabs sit under the header. Two tabs, each a
URL (`?tab=job` for the second):

- **Your Application**, the default. One card tinted by its stage
  (`STAGE_COLOR[stage].panel`: violet for Applied, grey for Saved), so it
  reads as the seeker's record rather than a second white card under the
  job's header. On the tint: the stage as its glyph on a solid disc and its
  name (the board's column headers; a badge's fill is the tint itself), a
  one-line status such as "Waiting to Hear Back", when it was applied or
  saved and the resume sent, the timeline left to right (`Timeline`'s
  `horizontal`), and the day counts (waiting to hear back, save to apply,
  posted before applying; or since saving and since posting for a saved
  job). The counts and the match are rounded white boxes on the tint: each
  count a `Card`, the match the Jobs page card's `MatchRail` with
  `standalone` on white, with its reasons (`?scored=true` sends
  `highlights` with `match`). Ruled, square cells were tried first and read
  as a spreadsheet next to the app's rounded cards. The match sits right of
  the rest from 576px of card and under it below that. Under the card,
  What You Sent lists every sent resume linked to the
  posting, each as View Resume (above) with its format, a Rebuilt tag
  for a rebuilt upload and Applied With on the one the application names,
  or, with none, a dashed placeholder box (the upload dropzone's
  outline) saying "No resume sent yet". It replaced two lines of
  explanation. Neither Apply nor auto apply keeps the answers typed into
  the employer's form, so the tab cannot show them.
- **Job Description**: About the Role alone (`JobViewBody`'s
  `descriptionOnly`). The job page's sent and applied notes and its
  Key Requirements card stay off: they pushed the description down and are
  the application's record, which the first tab already holds.

The application comes from `getTracker`, so its score, resume and stage
match its row. A job the seeker has not saved or applied to is not found. A
closed posting has no job page (`GET /jobs/{id}` answers 404), so the header
shows what the tracker knows, marked Closed, and the description tab says it
is gone. The day counts round elapsed time, as "Posted 8 days ago" does:
cut, an application sent 47 hours ago read as waiting 1 day.

## Auto Apply

/auto-apply (KAN-223) is where the seeker will apply in bulk. Its sidebar row
sits between Jobs and Applications, in the order the work goes, and its page
uses the same heading block as every seeker screen. The pipeline it grows
into is `auto-apply/architecture.md` at the repo root. KAN-285 redrew it:
the run button moved into the header, and both lists became tables in the
Applications list's frame (one white card, 12px grey headings, rules between
rows), Live Activity with a Status filter and sorting kept in the URL.

**The run button is in the page's header, at the top right** (`auto-apply/
auto-apply-panel.tsx`). It is sm (36px), a header action's size, and as
wide as its widest label, so Start becoming Pause shifts nothing; on a
phone it drops under the title at full width. Its label is the run's
state: Pause while it runs, Resume while paused. It sat beside the Resume
List until KAN-285, where the list's grid stretched it to the list's whole
height, a violet block. The first redesign made it lg with a Not Started /
Live / Paused word beside it; the user found the button larger than the
app's other primary buttons and the word redundant, and both went
(2026-10-20). The brand fill marks the
action that starts work, so Pause is the bordered neutral and Resume the
brand fill again. Start Auto Apply queues a batch of the seeker's best
matches through the API (`POST .../auto-apply/batches`, the server action
`startBatch`: 10, leaving out every job they already have an application
for), says how many in a note under the header, and refreshes the route so
Live Activity lists them; an error (an empty experience bank) shows there in
red instead. Then it asks the extension to open the oldest queued
application's page in a background tab beside this one
(`openNextApplication` in `src/lib/autofill-extension.ts`, the message
`run/open`), and the note says so, or why not (no extension, signed out) in
red (`auto-apply/opened-note.ts`, shared with the job card). A tab already
on that job stays as it is, so Start never wipes a form in progress. Pause
and Resume only move the state: nothing fills a form yet. It is off until
the Resume List has a resume (the panel holds both lists' read,
`useResumes`, for that), and while a batch is queueing. It never waits on
the tab's page load: the note says how many jobs it queued at once and adds
the tab's result when it lands. The state (`idle`, `running`, `paused`) is
the page's own; a return visit starts idle, so Start queues another batch.

**"Resume List" is live** (`auto-apply/resume-list.tsx`). It lists every
resume the seeker has, not one: auto apply picks a resume per application
(the one tailored to that job posting, else the default resume, `POST
.../applications/{job_id}/resume`; `auto-apply/architecture.md`, "The
resume"), and a note under the heading says so. The default is one resume,
built or uploaded (starring one clears the other), so one row at most says
Default. It is a table: Resume (the file glyph, the name and Default
beside it; frozen from 672px of page up), Type (Built, Tailored or
Uploaded, as tags), Used For (a tailored resume's job, "Role at Company",
and "Job posting closed" under it once its posting has gone; "Any job" for
the rest) and Updated (a built resume's last edit, an upload's day), every
column but Resume centred. It has
no filters or sorting: a seeker has a handful of resumes. Built resumes
(`listBuiltResumes()`) come first, then uploaded ones (`listResumes()`),
each list's default first. **A row opens on a click anywhere**, with no
button of its own: a built resume's goes to the resume editor, as on
Resumes (`components/clickable-row.tsx`, its name the link); it never
downloads here: downloads live in the editor. An uploaded
one's previews a PDF in a new tab or downloads a DOCX (`previewResume`,
called from the click, since the tab must open inside it; its name is the
button a keyboard reaches). Open and Preview buttons and an amber "None is
your default yet" line were dropped on the user's ask (2026-10-20). Manage goes to
Resumes (`/resumes`), where uploads live too, and the empty state names
it. Both lists load on every visit; a list that fails keeps what loaded
and says the rest didn't.
It replaced "Applying with Resume", which showed the primary uploaded resume
alone because matching read it then; matching reads the experience bank now
(KAN-212).

**Live Activity is live: the seeker's applications from the API**
(`auto-apply/applications.ts`, `GET /applicants/{id}/applications`, with
`scored=true` for the Match column, as the Applications page reads it). By
default in queue order: the oldest queued first, the job the extension
opens next, and a newly queued one at the bottom (asked for 2026-10-17).
The API answers newest first and the page reverses it, so the API's order
stays as other callers know it. Each stored stage is a row (`activityOf` in
`auto-apply/activity-list.tsx`): queued Queued, needs_you Couldn't Finish,
skipped Skipped, applied Applied. The queued job open in the extension's
tab reads Working in Browser instead (`auto-apply/live-activity.tsx`, the
one client step over the server's rows), in flight.

- **The table**: Role (the company's logo, then the role, bold, over the
  company; frozen at the left from 672px of page up, as on Applications),
  Status, Match (the Applications page's `MatchBadge`, "Not scored" without
  one), Date Added (when it was queued or marked applied), Date Applied
  ("Not yet" until then), and a narrow Actions column at the right end,
  its heading for a screen reader only: it holds one icon button with its
  own tooltip, and the word would not fit its 64px.
  Each status badge leads with its own glyph, so a status reads by shape
  as well as colour (2026-10-20): a clock for Queued, a window for Working
  in Browser, the AI sparkle for Tailoring Resume, a pen for Autofilling,
  an eye for Needs Review, a warning for Couldn't Finish, the Applied
  stage's briefcase, a skip for Skipped. The Status column is 192px, the
  longest badge's width with its glyph and ringing dot.
  Every column but Role is centred, heading and cell (asked for
  2026-10-20). Under 864px of table it scrolls sideways rather than
  squeezing the role. A line under
  the status badge shows only where it says more than the badge: Couldn't
  Finish's "Finish it on the job's page", Working in Browser's "Open in a
  background tab", and "Job posting closed". A row in flight has a dot that
  rings out three times beside its badge. The rows fade in down the table
  and glide when the sort or the filter moves them (`components/reflow.tsx`).
  The body is not a live region: a sort or a filter redraws every row, and
  `aria-live` made a screen reader read them all aloud.
- **A row opens its job posting on a click anywhere** while the posting is
  open (`components/clickable-row.tsx`, the Applications list's), leaving
  clicks on links and buttons alone; the role is the real link. A closed
  one links nowhere.
- **Actions**: icon buttons only, to save width. A queued row has a cross,
  "Remove from queue" in its tooltip (`auto-apply/remove-from-queue.tsx`),
  alone in the Actions column: beside the badge, before KAN-285, it read as
  closing the badge, and a worded Remove button (the first redesign) took
  width the table needs. It takes the job out of the
  queue and refreshes the route; a toast then says "<role> from <company>
  is removed from Auto Apply." with Undo, which queues the job again
  (`queueJob`): it comes back as a new queued row at the bottom, since the
  queue orders by when a job was queued. A failure, of either the removal
  or the Undo, is a toast too. The row open in the extension's tab has a
  window glyph instead, "Go to the tab" (`showRunTab`), never the cross:
  taking it out would leave the tab on a job that is gone. No other status
  has an action. The cross, a
  job's Auto Apply and Start each take one click at a time (a ref set on
  the click): `disabled={pending}` lands a render late, so a fast double
  click once sent two removals and showed the removal toast twice.
- **The Status filter**: over the table, a Status dropdown, the
  Applications page's (`components/field-facet.tsx`), its options the five
  groups, each with its glyph in its badges' colour, as the Applications
  Status options lead with their stage's glyph: Queued (a clock), In
  Progress (Auto Apply's bolt), Needs You (a warning), Applied (the
  briefcase), Skipped (a skip).
  Any of the picks shows. While a status is picked, Clear Filters is an
  outlined cross beside it, handing focus to the dropdown; a filter that
  hides every row shows "No Jobs With That Status" with Clear Filters,
  which hands focus to the dropdown too, as the button leaves with the
  empty state. A
  row of counts by status sat above the table until the user asked for it
  to go (2026-10-20).
- **Sort**: five headings sort, each one way, the way it is read: Role by
  its company A to Z, then by role; Status what needs the seeker first
  (Needs You, In Progress, Queued, Applied, Skipped); Match best first;
  Date Added oldest first, the queue order and the default; Date Applied
  latest first. A missing value goes last. Each heading's tooltip says its
  order, and the sort in force says so in aria-sort and a brand chevron.
- **Both are in the URL** (`auto-apply/query.ts`): `?status=` (a comma
  list of the groups) and `?sort=`, so a reload, Back and a shared link
  land on the same view. The page holds every row, so both move the URL in
  place (shallow routing) and the table filters and sorts itself; a status
  pick replaces the entry, so ten ticks are not ten steps of Back, and a
  sort heading adds one.

Each status takes a badge tone by its kind (`ui/badge.tsx`): Queued and
Skipped inert grey; Working in Browser, Tailoring Resume and Autofilling
`advanced` blue, grouped under In Progress; Needs Review and Couldn't
Finish warning amber, as both wait on the seeker; Applied the Applied
stage's violet, so it reads the same as on the Applications page. None yet
is an empty state pointing at Start and the jobs' Auto Apply; a failed read
says so, never a fixture. Tailoring Resume, Autofilling and Needs Review
are the runner's live states, kept for when the extension reports them;
the statuses and the routes are in `auto-apply/architecture.md`, "The run"
and "API routes".

## Calendar

**The Calendar is hidden for now** (KAN-261): `src/proxy.ts` sends
`/calendar` to the Dashboard, its sidebar row is commented out, and the
Applications panel's Show on Calendar button is gone. The tracker stores no
dated events yet, so it could only show the days jobs were applied to. Its
code stays in place. To bring it back, delete the proxy block, uncomment the
sidebar row and its import, and put Show on Calendar back in
`applications/page.tsx` (its comment there says what it linked to). A card's
next step still links to the Calendar if an application ever has an event,
so bring the Calendar back before the tracker stores events.

**The Calendar** (`(seeker)/calendar/`) shows every dated entry: the day each
application went in, interviews, offers and their deadlines, closing dates
and follow-ups, in their kind's stage colour, with a legend. `?view=` picks
Month, Week or Agenda (two weeks), `?date=` anchors it on a bare day, and
`?app=` opens the application in a detail panel (`applications/detail-panel.tsx`,
now the Calendar's alone), with a way across to its own page.
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

**My Profile holds the photo and the identity fields**, the Application
Questions, and a "Resumes & Experiences" section that links to both views of
that page.

**Contact & Links (KAN-262)** is an open section between the identity band
and Resumes & Experiences. It lists all six fields under visible labels, two
columns where the page is wide: Contact Email, Phone, LinkedIn, GitHub,
Portfolio or Website, Other Link. Each field is drawn like a job posting's
section heading (16px bold ink beside a 20px brand glyph), its value hanging
under the heading's text.

- **Two modes, like a form you open.** Reading, each field is text: its
  value (the email a mail link, the phone a call link, each link opening in
  a new tab, printed as the resume header prints it: `linkedin.com/in/jake`)
  or "Not added" in grey. The section's Edit turns every value into a text
  field in place, the first one focused, with Cancel and Save under them;
  Escape cancels. Clearing a field and saving removes it. Save sends what
  changed since Edit was clicked, as Application Questions does (below).
- **Tried and dropped on 2026-10-20:** only the filled fields in one row
  under the name (a seeker with no links saw no sign they could add any,
  and nothing said which email it was), then an Add button on each empty
  field (it offered an edit while the section was not being edited).
- **These fields are edited here only.** The identity band's Edit opens a
  dialog with Full Name and Headline alone, so no value has two editors.
- **Example text only where it cannot pass for a saved value**
  (`you@example.com`, "Your phone number", `your-name`): the sign-in email
  as Contact Email's placeholder read as already filled in, and so did a
  realistic headline and phone number. Other Link has no example and no
  hint: each site named there (Behance, then LeetCode and Devpost) read as
  the only kind of link it takes.

The identity band holds only the photo, the name and the headline. With no
headline the line is dropped, so the name centres beside the photo: an empty
headline line used to leave a gap between the name and the row below.

- **Two emails, on purpose.** The sign-in email belongs to Supabase Auth and
  is never edited here. The contact email is the one employers see: resume
  headers print it and the autofiller fills it. Empty means the sign-in
  email, so the section and every reader fall back to it. The section says
  "Your sign-in email" under the address whenever it is the sign-in one.
  In edit mode, a Contact Email that is empty or differs from the sign-in
  email shows Use Sign-In Email, which fills the field with it, and the hint
  says which email employers will see. The sign-in email in the field is
  saved as empty: retyping it by hand left a seeker unsure it was the
  sign-in one (2026-10-20). A seeker may apply with a different
  address than the one they sign in with.
- **Four link fields, named for what hiring systems ask:** LinkedIn,
  GitHub, Portfolio or Website, and Other Link. Each matches a box that
  Greenhouse or Lever asks for by name, so the autofiller can fill it. Any
  other page goes in Other Link, and the section labels it by its site
  when it knows the site (a LeetCode link reads "LeetCode", `siteName`
  in `lib/profile-links.ts`). A list of any number of links was weighed and
  left out: it needs a new table and a rule for which link fills which box.
- **A link is a web address or nothing.** "linkedin.com/in/jake" gains
  `https://` on Save, in the section and again in the API; anything that
  is not an http(s) address is refused with "Enter a web address" under the
  field. The section never makes an href of a link that fails the check.

**Application Questions (KAN-269)** is an open section between Contact &
Links and Resumes & Experiences: the nine questions onboarding's Profile
step asks (work authorization, sponsorship, citizenship and visa status,
clearance, and the voluntary gender, Hispanic or Latino, race, veteran and
disability self-identification), with the seeker's answers
(`(seeker)/profile/application-questions.tsx`).

- **The same two modes as Contact & Links.** Reading, each question is its
  answer's label or "Not answered" in grey. Edit turns every answer into a
  picker (`ui/select-field.tsx`) in place, the first one focused, each over
  the question as forms word it, with Cancel and Save; "Not Answered" in a
  picker clears that answer. Escape cancels, but Escape in a picker's open
  list closes the list alone: the list is portalled outside the form, and
  only a key from the form's own fields cancels.
- **Pickers, not onboarding's tiles**: nine questions of up to seven large
  tiles made a screen-long form on a page of settings.
- **Two screens edit these answers, safely.** Onboarding asks them once;
  this section is where they change after. Both read one question list
  (`lib/autofill-answers.ts`) and save through one server action
  (`lib/autofill-answers-actions.ts`), and the API merges only the answers
  sent, so neither screen erases what the other saved.
- **Shown only once loaded.** A failed read shows the page's one notice,
  never nine "Not answered" lines that would pass for real answers.
- **Save sends what changed since Edit was clicked**, compared with the
  answers the edit started from, never the latest ones: a return visit
  shows the cached answers and refetches, and a refetch landing mid-edit
  made another tab's newer answers look changed, so Save wrote the cached
  ones back over them (review, 2026-10-20).

**Resumes moved
out on 2026-10-18**: the Resume card (the uploads and their dropzone) became
the Resumes view's Your Resumes card (below), beside the base resumes,
which then shared its limit of 5. With one limit split across two pages,
each page's "n of 5" and star depended on a list the other page held. The Application
Settings section, an "Autofill Applications" switch that saved nothing,
went the same day; the extension's own popup runs autofill.

**Resume facts are not edited here or on Resumes** (KAN-211). The
parsed-JSON editor (a review dialog after upload, and Work Experience and
Skills cards editing the primary resume's `parsed_json`) is gone, so the
experience bank is the only place to edit resume facts. KAN-240 dropped
`parsed_json` itself. Do not bring back an editor of an upload's facts: two
places to edit the same facts drift apart, and the bank is what built
resumes read.

**My Profile is cached for the life of the seeker shell.**
`(seeker)/profile-cache.tsx` keeps the page's last state (the photo URL,
the applicant profile fields and the Application Questions' answers) in a provider
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

## Resumes & Experiences

One sidebar row, above My Profile, for one page in two views (KAN-249):
**Resumes** (`/resumes`, the row's link) and **Experiences** (`/bank`, the
experience bank). Both draw one header (`resumes/header.tsx`; it stays
beside the Resumes view though `/bank` imports it too, since the two routes
are one page's views, not two consumers), laid out as the Dashboard's is: the view's own title and line on the left ("Resumes",
"Experiences"), and at the top right, level with the foot of that block, a
segmented switcher between the two views and then the view's primary
action, Generate Resume or Fill With Scout; on a narrow page the controls
wrap under the title. A shared "Resumes & Experiences" title on both views
said less about where the student was. The views stay two routes, so every link to either still
lands (the Jobs page's `/bank?import=1` included), and the switcher is plain
links, since each view reads its own data on the server; the sidebar row is
lit on both (`also` in `app-sidebar.tsx`) and in the editor under
`/resumes`. They were two pages and two rows, Experience Bank and My
Resumes, each with a button pointing at the other; a student building a
resume went back and forth between them. "Experiences" is the name students
see for the experience bank; the glossary term stays.

## Experiences (`/bank`)

`(seeker)/bank` (KAN-206). The experience bank is where resume facts are
kept, once (`GLOSSARY.md`), and the only place they are edited: the
Resumes view keeps the uploads, and its upload note links here.

**Layout, top to bottom**: the shared header (above) with Fill With Scout,
then the section cards and Skills. The page is the filled-out bank itself.
The resumes it makes moved out in KAN-249 (Resumes, below). At the foot of
the bank, as settled on 2026-10-13, a student editing entries scrolled past
every section to reach a resume, and the page read as two pages in one.

**Intake lives in Scout's panel** (2026-10-13), where Scout does: the bar's
Scout button or Fill With Scout opens it. On this page the panel shows
intake in place of Scout's job chat (`components/scout/scout-takeover.tsx`)
and widens to 448px (460px of room with its gap). Three bands, top to
bottom: the stage card (the step chips), the chat (with the draft in it,
`draft-preview.tsx`), the composer.

**The resume question comes first, alone** (KAN-249), when the bank is
empty and no draft is kept: Scout's greeting asks "Have a resume?" with
Upload Resume, Use One I Uploaded and Start Without One under it, and no
section or stage card shows until one is picked. **Every answer Scout
offers is a suggestion Chip** (`ui/chip.tsx`, KAN-251), these and the
section chips alike: one size, one look, each with its glyph. The resume
answers were a fill, an outline and a text link of three heights, the last
on a line of its own. Start Without One goes in
the chat as the student's answer, then the first section starts; an import
starts the walk on what the resume left out, as before. Upload Resume
uploads, and the upload fills the bank itself; Use One I Uploaded runs
Import Again on the default upload. A bank with
entries has no stage: the walk opens on its gaps at once, and Scout's
second line asks "Have a resume?" with Upload Resume and Use One I
Uploaded, until the student imports once. With no offer there, as the
first version of KAN-249 had it, a student whose bank held one entry had
no way to import a resume. The first version also asked about the resume
and Education at once, which read as two tasks on one screen.

**The stage card is the one block above the chat, and it only finds the
way** (KAN-249, KAN-257): the current section's name and "Section 1 of 6" over
the step chips (`compact`; a chip still jumps, so there is no Back). The
current chip carries the section's icon. With no section open it reads
"Your Sections" and how many are done. It is lavender
(`--color-stage-card`): white on the panel's white, behind a ring of the
same pale tint, it read as one more line of the chat.
**The draft and its actions live in the chat** (KAN-257), under Scout's
newest line, the way an assistant's answer carries what it made. Once
Scout has a title, it is a white card: the title, the status and the
entry, each line fading in as Scout fills it, and in its foot Skip Section
(or "Leave As Is" on a visit), Edit and Save Entry. There is one, and it
follows Scout's newest line, so it sits by the composer and never goes
stale higher up. Before a title there is nothing to preview, so the same
ways on are suggestion chips under Scout's question: Fill In Myself (the
form, for when Scout cannot answer: the API's "Fill in the card
yourself") and Skip Section. Skip is disabled, not hidden, while Scout
answers or a save runs. The draft, Edit and Skip had been pinned in the
stage card above the chat, where they crowded a card that is for finding
your way and stood apart from the conversation they answer. Before that
(KAN-249), a step bar with its own Back, step line and Skip sat over a
separate draft card with a second Skip, the section named again, a hint
line and a disabled Save Entry: two blocks that read as unrelated, which
left the chat about 300px at 800px tall. A student happy with an entry
looked for "next" near it and found only the step bar's small Skip, which
is why Skip sits with the draft it skips.
**The draft reads from most to least important** (KAN-257): the title;
what the entry is with, in the darker body grey (a school's degree and
GPA, a job's or club's organization, a certification's issuer); when and
where, in the meta grey; then a school's college, coursework and honors,
or a project's link without its `https://`; then two bullets of two lines
each. Every line under the title had been the same small grey, so a
school's degree read like its coursework, and the dates floated right on
the organization's line, alone at the edge of an empty row for an
import's school, which has none. **Under the title, the status says what
the draft still needs** (`DraftStatus`): "Still needed: Start Date" in the
bank's warning amber, or "Ready to save" in green once Scout has no
questions and nothing is missing, and nothing while Scout asks about
optional facts. It replaced a pulsing dot with "Filling in as you talk",
which said nothing the chat did not, and a row of dashed "Still needed"
chips at the card's foot. The form over the panel shows the same status.
**The page marks what Scout is working on** while the panel is open
(`Intake`'s `onFocus`, `ScoutMarked` in `bank-screen.tsx`): the section card
takes the brand outline, and a visited entry takes a brand tint with a band
of light crossing it (`animate-shimmer`), so it reads as Scout at work on
it. A "With Scout" tag did this until KAN-249 and read as one more line of
the entry; a screen reader still hears it, and reduced motion keeps the
tint still. A new entry gets no row (KAN-257): the outline already says
where Scout is, and a "New Education entry, Filling in as you talk to
Scout" row only repeated it. **When Scout moves to another section** (a
step chip, or a save or Skip moving on), **the page scrolls that section's
top into view** (instantly under reduced motion); within one section, the
next entry Scout visits scrolls only as far as it needs to be seen. The
marked row had scrolled itself to the nearest edge, which landed the page
on a section's foot or middle. Gemini in
Docs and Grammarly mark the text their side panel acts on the same way;
before this, the student could not tell which entry the questions meant. The status's list is
`sections.ts`'s `neededFacts`: only what intake asks about (a school's or
job's dates, a job's or role's organization, a school's degree and field,
bullets) and the title. An optional field such as a school's college never shows; an early
version listed every empty field and asked for "College or Department".
Before the draft has a title the status stays hidden, since the chat's
question is the next step. Edit opens the
full form over the panel, with Back to Chat (Escape goes back too). The
import card opens in the chat's place. A save
reads the bank again, so the page behind updates at once. An empty bank
gets no card of its own (removed in KAN-249): the title's Fill With Scout
and each section's Add already say where to start, and the card only
repeated them. Any other page gets Scout's own
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
  a container, since Scout's panel is not).
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
- **Import Your Resume** (`import-card.tsx`, KAN-240) opens inside intake,
  from the resume question's answers in the chat (the first stage for an
  empty bank, Scout's second line otherwise), offered until the student
  imports once. It says what went into the bank (`lib/import-summary.ts`)
  and holds Continue and, while an AI reading is left, Read It With AI.
  Nothing waits for review: the entries are in the bank, and the page
  behind shows them at once.
  Upload Resume (PDF or DOCX) uploads through `uploadResume`, as the Resumes
  view does; the upload writes its reading into the bank and the card shows its
  `bank` result. Use One I Uploaded, and `?import=1` (the Jobs page's
  prompt, which opens the panel on arrival), run Import Again
  (`importResume`) on the default upload, else the newest. The card takes
  the chat's place until Continue. The API's 5-upload limit shows as the
  strip's error; with no upload the API's 404 message shows. Until
  KAN-240 this was a review of draft entries the student saved one by one
  or with Save All; students who uploaded on My Profile never reached it,
  and their banks stayed empty (ADR 0003).
- **One entry editor** (`entry-editor.tsx`) for every section and for
  intake drafts: it edits a draft and hands the whole draft
  back, and the caller decides between create and edit. Only the title is
  required. Each section adds its own fields (`sections.ts` names the
  title and organization for each). Months use the browser's month picker,
  which falls back to a `YYYY-MM` text box where there is none.
  **Two columns at every width** (KAN-257): a pair of short fields shares
  a row (the start and end, with the end month under End; a degree and its
  field; a GPA and its scale), a long one takes the row, and the
  organization and location pair up where the form is wide (the bank
  page). A school leads with its degree, dates and GPA and ends with its
  optional college, location, coursework and honors. In Scout's panel the
  form had been one column of up to thirteen boxes, with the college and
  location ahead of the dates intake was asking about. Chrome's empty
  month prints its dashes in the placeholder grey (in ink they read as a
  broken field), coursework is a box that grows with its text and turns a
  line break into a comma (a one-line field cut the list off), and a GPA
  has no spin arrows.
  **Bullets read as the list they make** (KAN-249): each is a box with its
  bullet mark drawn in, and under them a dashed box of the same size, Add
  Bullet Point, whose + sits under the marks. The box it makes takes the
  cursor; while the last box is empty it goes back to that box rather than
  stack another. It is the shared field box (`FIELD_CONTROL`) drawn dashed.
  Add Bullet used to sit under the label as bare brand text, which read as
  crowded against it. **A bullet box grows with its text**
  (`field-sizing-content`, as the resume editor's lines do), so a long
  bullet wraps in view; a one-line input scrolled it sideways out of sight.
  Its mark and × stay on the first line. A bullet is one line on the
  resume, so it never holds a line break: Enter goes to the next box (from
  the last, it adds one, as Add Bullet Point does), and a pasted break
  becomes a space.
- **A duplicate warns and never blocks.** When a new entry matches one in
  the bank (section, title and organization, ignoring case), the editor
  says "This looks like …" and its save button becomes Save as New; Cancel
  closes it. Two real roles may share a title.
- **Editing an entry** sends its fields in one PATCH, then its bullets as the
  adds, edits and deletes that turn the saved list into the draft's
  (`entry-save.ts`'s `editSteps`, shared with intake's entry visits).
- **Delete asks once**, inline, with the count above.
- **Skills are a plain list** with an optional group, one row per group.
  A name appears once, ignoring case; the API answers 409 otherwise. The
  group names make one column from `@md/main`, so every group's skills start
  at one edge; on a phone each name sits over its skills. **Add opens the
  form**, at the top right as on the section cards. It stays open after an
  add, for the next skill, and closes after an edit; the skill being edited
  takes the brand outline. A form always open under the list made Skills the
  only card that never looked finished.
- **Skill links live in the entry editor** (KAN-216, `skill-links.tsx`):
  "Skills Used Here" shows one toggle per bank skill, pressed when linked.
  The editor only edits the list; on save the screen sends the link and
  unlink calls after the entry's own save (for a new entry, after it is
  created). Once the entry has saved, a failed later step closes the editor
  and says "Some changes did not save", because a retry would repeat the
  steps that worked. Intake omits `skills`, so no links show.
- **Intake** (`intake.tsx`, KAN-213), in the look of the intake prototype's
  variant G: a lavender chat with Scout's gradient mark and a chapter line
  per section. On the bank page it is in Scout's panel, in the three bands
  above. In onboarding it leads the page: the draft card sticky beside the
  chat from `@4xl/main` and, below that, a one-line draft that opens as a
  bottom sheet. The student picks a section from its chips; the opener
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
- **Intake's step bar** (`intake-steps.tsx`, KAN-214): one step per
  section in the order intake walks (Education, Projects, Leadership &
  Activities, Experience, Awards, Certifications: user story 41, not the
  bank's order), Back on the left, Skip on the right (in Scout's panel, the
  steps alone inside the stage card, as above). A step jumps to its
  section; the steps are disabled while Scout answers or a save runs, so
  a late reply never lands on another section. The percentage starts at
  25% and grows as sections are dealt with.
  **A skipped section counts toward the percentage** (settled in KAN-214,
  as the prototype does): the bar measures sections dealt with, so a
  student with no awards still reaches 100%; a later save in it marks it
  done. Skip and a jump drop the unsaved draft, as in the prototype.
  Skipped sections persist beside the draft in `lib/local-drafts.ts`.
  **The steps are icon chips** (KAN-257), the same in both bars: a 32px
  round button per section with its own glyph (the chat's chapter icons),
  on a line from the first to the last. One signal per meaning: where the
  walk is, the chip filled with the brand and ringed; what became of the
  section, a corner badge (a green check for done, a grey dash for
  skipped, with a dashed edge); which section, the glyph, a tooltip with
  the name and status in Title Case ("Projects · Not Started"; lower case
  read as a broken sentence), and the name under the chip in onboarding.
  Only a save changes
  a badge, so a visit to a done entry ("Leave As Is") keeps its check and
  its share of the percentage. The draft's own progress is the draft
  card's status ("Still needed: Start Date"), not the bar's. It replaced a
  bar of thin segments, unlabelled in the panel, where a 6px sliver was the
  target for a jump and colour carried everything: done green, untouched
  grey, skipped hatched, the current one ringed or filling in brand as its
  draft grew. Visiting a done section had turned it purple, as if it had
  come undone, and dropped it from the percentage.
- **Walking.** The bank page always walks, in the step bar's order: a
  section with entries is passed over, except that each entry with gaps
  (`sections.ts`'s `gapQuestions`: no dates for a school or job; no organization for a job or
  role; no bullets for a job, project or role; no degree, field or GPA for
  a school, which a resume import often lacks) gets a visit. The card opens
  on the saved entry, Scout's first line asks about the gap, the model is
  told what the card has and lacks, and saving edits the entry. Skip on a
  visit passes over that entry only. An entry visited once is not visited
  again on the page. A section with no entries gets the full questions.
  **A jump or a chip visits too**: picking a section opens its first entry
  with gaps not yet visited, never a blank card that asks the student to
  retell what the bank holds. Otherwise it opens a new card, and Scout's
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
- **Intake is not part of onboarding** since KAN-275: the wizard's last
  step is a resume upload (Applicant onboarding, below). Intake had run
  there from KAN-214 on a page of its own, always walking; its step bar
  counts the sections alone ("Section 3 of 6"), since that page's step rail
  above it already counted the wizard's steps (KAN-259).
- **Students see "Experiences"** (KAN-249) on the bank's view; it was
  "Experience Bank" from KAN-214 until then. The glossary term stays
  "experience bank".

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

## Resumes (`/resumes`)

`(seeker)/resumes` (KAN-249), the other view of Resumes & Experiences: the
resumes the bank makes and the uploads, in cards, Your Uploaded Resumes, then
Generated Resumes, then Tailored Resumes when there is one, under the shared header with Generate Resume (it was the
base resumes' card's own Generate). They sat in one "Your Resumes" card at the foot of the bank page
until KAN-249; the spec's "the resumes page" now means this view. The
editor lives under it (`/resumes/[resumeId]`), so the sidebar keeps the row
lit there and the phone editor's back arrow lands here. The page needs
the built list and the uploaded list: if either fails it
shows "Your Resumes Aren't Loading Right Now" and a Try Again link.

- **Your Uploaded Resumes** (`your-resumes.tsx`; "Your Resumes" until
  KAN-268), the uploads, newest first, under
  an "n of 5" badge of uploads alone (the API's limit; generated resumes
  counted toward it until KAN-268), with the upload dropzone in a narrow track beside the
  list from @4xl (under the heading, before the rows, below it). It held
  base resumes alone until 2026-10-18, when My Profile's Resume card moved
  in; both kinds then shared it until KAN-268, and a student could not
  tell which resumes they had generated. With no upload it holds the grey
  empty box: "No uploaded resumes yet".
- **Generated Resumes** (in `built-resumes.tsx`), the base resumes
  (KAN-207), always shown, with the same grey empty box ("No generated
  resumes yet") until Generate makes one. It was "Base Resumes", saying
  "Made from every entry in your bank" until KAN-258: students see
  "Experiences", never "bank".
  **Every change to either list reloads both** (`reload` in
  `built-resumes.tsx`): one primary star spans them, and the API makes a
  student's only resume, uploaded, base or tailored, the primary on every add and
  delete, so the page never guesses at stars.
  Generate makes a base resume with every entry, bullet and skill in the
  bank, except a copy of an entry already on it (same section, title,
  organization and months: an import saved "as new"), which waits in "Not on
  This Resume"; two copies of one job sent a resume to two pages. It is
  named "Resume #N", one past the highest number the student's resumes
  carry; every one was "Base Resume" until KAN-258, so the list read as one
  name repeated. Generate has no limit (KAN-268); a failed one shows its
  message as Generated Resumes' error. **A Generate that would make a
  resume the student already has makes nothing** (KAN-267): a pop-up says
  "Duplicate Resume found: <name>" with an OK button, and nothing else
  happens. "The same" is what prints: a new resume holds the whole bank,
  so it matches only when nothing changed since an earlier Generate.
- **Uploads** in Your Uploaded Resumes: picking a file uploads it at once
  (`uploadResume`); the API reads it itself, and the client never sends
  parsed content. **A file whose text the student already uploaded is
  refused** (KAN-267): nothing is kept, whenever and however the file was
  exported again, and Generate's pop-up opens, "Duplicate Resume found:
  <name>" with OK (`resumes/duplicate-resume-dialog.tsx`). Import Updated
  Resume refuses the text of another upload the same way (its dialog
  closes and the pop-up opens), but takes its own row's text in a new file.
  Intake and onboarding uploads show the message as their error line. **The upload fills the experience bank** (ADR 0003): a
  note under the dropzone says what went in ("Added 6 entries and 2 skills
  from resume.pdf", or "WorkIt couldn't find any entries in …"), links to
  Experiences, and offers **Read It With AI** while the student has an AI
  reading left. Before KAN-240 an upload showed nothing, and its facts
  reached the bank only if the student found the import inside intake;
  most never did. **A click anywhere on an upload's row previews it**
  (`src/components/resume-row.tsx`, KAN-268), as a generated resume's row
  opens the editor: a short-lived signed link from `getResumeFileUrl`,
  opened by `src/lib/preview-resume.ts`. A PDF opens in a new tab, opened
  inside the click so it is not blocked as a popup (if it is blocked
  anyway, the page says so rather than leaving it); a DOCX downloads. An
  eye button did this until KAN-268. The row's icons are a star that makes
  it primary (`setPrimaryResume`), **Rename** (the pencil, the same form as
  a generated resume's; `renameResume`, and the API keeps the file's
  extension on the name), **Download** (the stored file through
  `getResumeFileUrl(id, true)`, which makes even a PDF download; an upload
  keeps no sent resume, since its file never changes), **Import Updated
  Resume** and Delete, which asks
  first in the line under the row, as a base resume's does. Import Updated
  Resume names the row after its new file again. Import Updated
  Resume opens `resumes/update-resume-dialog.tsx`: a dropzone for a newer
  version of that file, which replaces it on the same row (`replaceResume`;
  the row keeps its primary star and moves to the top with today's date)
  and merges its reading into the bank. The dialog then says what went in,
  with Read It With AI while a reading is left, and Done. It replaced
  Import Again on the row (2026-10-18): the stored file never changes, so
  re-reading it only said "already in your bank". The star, Rename, Import
  Updated Resume and the delete are optional props, so a screen that only shows a
  resume leaves them out. The `ResumeUpload` component
  (`src/components/resume-upload.tsx`) is a pure dropzone + file preview —
  it knows nothing about upload logic or limits.
- **Tailored Resumes** (KAN-258), after Generated Resumes, only while
  the student has one: each is made for one job posting with Tailor
  (KAN-217). They sat in Base Resumes with a Tailored tag until KAN-258,
  under a name they do not have. A tailored resume takes the star like any
  other since KAN-268 (the API refused it before); Apply and auto apply
  still send a posting's own tailored resume first, and Apply's list shows
  a primary tailored to another posting as "Tailored resume". It gets a
  "Posting Closed" badge once the Jobs
  page no longer lists its posting (story 90, the API's `posting_closed`).
  It still opens and downloads; only Tailor needs a live posting. Its day
  line names the posting it was made for ("Made Oct 17 · For Intern at
  Acme", the API's `posting_title` and `posting_company`, KAN-268), a link
  to the posting's page above the card's stretched link; once the posting
  closes the name stays as plain text, since that page is a 404.
- **Each built resume is a row drawn as an upload's is**
  (KAN-258, `resumes/built-resume-row.tsx`), from `components/resume-row.tsx`'s box (`RESUME_ROW`), star
  (`PrimaryStar`) and icon buttons (`ROW_ACTION`), so the two lists cannot
  drift apart: the PDF mark, the name, one line with one day, then the
  star, Rename, **Download PDF** and Delete. **The whole card opens the resume editor**: the
  name's link stretches over it and the icons sit above that link, and it
  lifts under the pointer as every whole-target card does (`docs/motion.md`).
  It held Open, PDF and Word buttons until KAN-258, when downloading moved
  into the editor; KAN-268 put Download PDF back on the card. It is the
  editor's PDF download (`useResumeDownload`: a sent resume), and its
  missing-character warning shows under the row; Word stays in the editor.
  The star works as an upload's does and uses its word, "primary": filled
  on the primary resume, an outline on the others, always shown (KAN-268;
  it showed only under the pointer before). The view said "default" and showed a
  Default badge for the same setting (the API's one default resume,
  uploaded, base or tailored).
- **The day**: when the resume was last edited ("Last edited Oct 20"), or
  when it was made until its first edit ("Made Oct 17"). The year shows only when it
  is not this one, as on an upload's row and in the tracker. With it, "Last
  edited" wrapped on a phone. Both days together said one day twice for a resume
  edited the day it was made, and the made day mattered less. The
  template's name was on that line until 2026-10-18, when it went: there is
  one template, so every row said the same.
  "Last edited" is the API's `edited_at`, the last change to the resume
  itself (what shows, its order, its wording or its name); a fix in the
  bank changes every resume and does not count. The days are the student's
  own (`LocalDate` in `(seeker)/local-time.tsx`); the UTC day showed a
  resume sent on an evening as sent the next day.
- **Rename** opens the name in place, in a field with Cancel and Save Name
  at the field's height, as the bank's Skills form is drawn; Escape cancels
  and an unchanged name saves nothing. A sent resume keeps the name it went
  out under.
- **Delete asks first**, on every resume, drawn as a bank
  entry's confirm is (`delete-confirm.tsx`, which Experiences uses too): the
  question, then Delete Resume and Keep It, the two
  buttons wrapping as one, since wrapped apart Keep It sat alone on a line.
  Both went at one click until KAN-258. Deleting a resume keeps the files
  already sent from it.
- **No Sent card since 2026-10-18.** It listed every file the student
  downloaded or applied with (KAN-208), to download again or delete. Sent
  resumes are still kept on every Apply (a download keeps nothing since
  KAN-267), and a job posting's page still says "You sent <name> on
  <date>"; no screen lists them all or deletes one now.

## Resume editor

`(seeker)/resumes/[resumeId]`, opened from a resume's card on the Resumes
view. KAN-209 proved the overlay; KAN-218 edits on it; KAN-219 adds the
phone layout; KAN-221 adds the assistant. The page loads the render, the bank, the resume's choices and
the profile (the header's fields), and shows the error state if any fails.
A **Back** button above the title returns to the Resumes view, drawn as the
job posting page's Back is; until KAN-258 the editor had no way back but
the sidebar. The phone layout keeps its own back arrow.

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
  fields, so they are not typed here: the bar links to Experiences.
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
  line selected: the hint "Click a line to edit it." first, in ink at label
  size with a brand pointer glyph (a grey note after the page count until
  KAN-258, it read as fine print); then, only over one page, **one amber
  group** (`fit-notice.tsx`): the warning glyph and the count ("2 pages · 3
  lines over 1 page", from the render's `lines_over`, an estimate), a
  hairline, and Fit to One Page in the same amber. An amber badge beside an
  outline button read as two unrelated things. Then Undo, which shows again
  everything Fit hid (the response's `undo` body). A one-page resume shows
  no count: a green "1 page" said what the page itself shows, and stood
  apart from the rest of the bar. Undo is kept in sessionStorage per resume
  (`fit-undo.ts`), so a reload in the same tab still offers it. The bar also
  says "Saving…" or the last round trip ("Saved, 412 ms"), the measure for
  the Vercel preview check. **Download** (PDF or Word) and Ask Scout end
  the bar whether or not a line is selected, so Download stays in reach down
  a two-page resume (`../download-menu.tsx`, KAN-258; it was on each card
  of the Resumes view). It keeps a sent resume and holds a PDF with
  characters the font lacks for Download Anyway, as Download always has;
  the warning and any error show under the bar. The status, Download and
  Ask Scout wrap as one group, so on a narrow page they stay together at
  the right. **The bar is the brand tint**, not the surface colour, so its
  secondary buttons stand out (`docs/design.md`, Components), and **Ask
  WorkIt is the brand's filled button**, the editor's primary action; it
  was an outline until KAN-258. The phone layout's top and bottom bars take
  the same tint and its Ask Scout buttons the same fill, and its sheets
  are white.
- **A toast says it first** (`fit-notice.tsx`, KAN-258): when the editor
  opens on a resume over one page, or an edit pushes one over, a toast at
  the bottom right (above the bottom bar on a phone) says by how much, with
  Fit to One Page and a cross. It closes on Fit, on the cross, once the
  resume fits, or after 10 seconds, since the bar's group keeps the same
  fix. On a phone it does not show while a line's sheet is open, which it
  would cover. The editor notices the change while rendering (the last
  count is kept in state), not in an effect.
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
  times the width, scrolled sideways; Fit Width undoes it. Download sits
  beside Zoom in the top bar, and beside the back arrow the top bar says
  "Tap a line to edit it.", or, over one page, the bar's amber group in its
  place, short to fit there: "3 lines over" and "Fit" (named Fit to One
  Page for a screen reader). The toast spells it out. The selected line
  scrolls to the middle of the page area. The tray opens from a bottom
  button in its own sheet (with a scrim). The layout is a fixed layer over
  the seeker shell, **sized to `window.visualViewport`** (height, moved down
  by its offset): the iOS keyboard covers the layout viewport instead of
  shrinking it, so a layout sized to the window would put the sheet behind
  the keyboard. A back arrow goes to the Resumes view. The first paint
  is the desktop layout (the server cannot know the width), then a phone
  switches. Manual checks on a real iPhone: the sheet stays above the
  keyboard, and the field does not zoom; and the render time on cellular
  data, read from "Saved, N ms".
- **The assistant** (`assistant.tsx`, KAN-221; the KAN-195 prototype's
  variant E) opens from Ask Scout in the sticky bar and **docks beside the
  page** from @4xl/main (sticky, never over the page); narrower, it stacks
  under it. On a phone, Ask Scout in the bottom bar or in a line's sheet
  opens it in its own sheet. It stays mounted while closed, so closing it
  keeps the chat; nothing is stored. The look is intake's (variant G:
  lavender panel, Scout's mark) and the bubbles, dots and composer are
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
composer (with the mic, `use-speech-input`) and Scout's mark, shared with
intake on the bank page and the editor assistant; the panel's header wears
the same mark (KAN-257), where a brand-tint circle with a hand-drawn
sparkle had made the panel and its chat look like two assistants; each takes who is talking
as a prop. `stream.ts` mirrors the API's NDJSON events, which
`app/api/scout/` (the one route handler, since the reply streams) forwards with
the session's token. `reply-text` renders a reply's **bold** and "- " bullets,
the prompt's whole formatting vocabulary, with no markdown library (a reply
stays escaped text otherwise).

## Applicant onboarding

/onboarding/applicant is a three-step wizard (KAN-231), outside both shells:
each step's question is the page's h1 on a lavender left half
(`onboarding/applicant/story-panel.tsx`, a band across the top below lg that
holds the logo and the question alone), and the fields answer it on the
right, with Back and Next pinned to the foot. Each new question takes focus,
so a screen reader reads it out; focus used to stay on the footer button.
From lg the screen is one window tall and only the right column scrolls, with
its scrollbar's room kept on every step: when the page scrolled, only the
long step 1 grew a scrollbar, and the panel and form shifted against step 2.
Step 1 is Role, Job Type and Workplace (all required), and Start Date,
Experience Level, Location and Salary Range, Experience Level after Job Type
(KAN-284); step 2, Profile, is the questions every application asks
(KAN-283, all optional); step 3 is Resume (KAN-275), with Skip and Continue
in place of
Next. Start Date shows only once
Internship is picked, and unpicking Internship clears it: a saved season keeps
only the jobs that name one, which a new-grad role rarely does. Preference Tags, free-text skills, were dropped
(KAN-231): the feed has no filter for them.

**One step rail counts the whole journey (KAN-259).** The wizard heads its
fields with the shared `components/stepper.tsx` at `size="lg"`: Role,
Profile, Resume (`onboarding/applicant/steps.ts`). It replaced a thin bar and
a 14px grey "Step 1 of 2" at the foot of the left half: the smallest type on
the screen, far from the fields, and wrong, since intake then opened six more
sections on a page of its own. That page carried the rail too, with
Experiences as the third step, until the resume step replaced intake
(KAN-275). The second step was Pay & Visa until KAN-283.

**The question and Scout stand apart (KAN-259).** The question sits under the
logo; Scout sits at the left half's foot, from lg only, and types a tip the
question does not give ("Both are optional..."). They were one block, the
bubble 28px over the question and asking it again in other words, so it was
not clear who was asking.

**The way out is quiet (KAN-259).** "Signed in as … Not you? Sign Out"
(`onboarding/applicant/signed-in-as.tsx`) closes the wizard, in the 12px of
the inline button. Onboarding has no account menu, and sign-in brings an
unfinished applicant back here, so the screen needs an exit; as a Sign Out
button at the top right of the form it was the column's first thing and read
as part of the step.

**The left half moves, from lg.** Between the question and Scout a showcase
(`onboarding/applicant/showcase.tsx`) cycles three scenes on one clock: a
mock screen (a matched job, a resume, the applications board) with the
notification that screen would send tucked over its corner. A scene glides
in, its notification follows a beat later, and both leave together while the
next arrives (`--animate-arrive` and `--animate-leave`), so the change is a
crossfade. Two clocks, one per part, drifted out of step. The scenes are
scaled as a whole to fill the room the panel leaves (up to 1.8x), so a tall
window gets a big picture; under 0.85x the stage hides and its room stays
empty, with the question still at the top. Scout types its tip in a chat
bubble on every step. It is all decoration over made-up data, so it is
aria-hidden, and it holds still under reduced motion.

**Profile asks what every application asks (KAN-283).** Authorization to
Work and Visa Sponsorship (yes or no), Citizenship and Visa Status, Security
Clearance, then the voluntary Gender, Hispanic or Latino, Race/Ethnicity,
Veteran Status and Disability, in the order real forms ask them, each under the question as forms word it. The options
are real forms' options (`lib/autofill-answers.ts`): gender's are the
EEO Male, Female and decline plus Non-Binary, which many forms add;
Hispanic or Latino (KAN-299) is Yes, No or decline, and Race/Ethnicity one
EEO-1 category or decline, the EEO's own two questions, which every U.S.
form keeps apart; veteran
status's three are the U.S. protected veteran self-identification's, disability's
three are Form CC-305's words. One answer each, as dots; pressing a picked
answer again clears it. They are not filters: Continue saves them to the
answer bank (`PATCH /applicants/{id}/autofill-answers`, only the changed
ones), which auto apply fills forms from. The step was Pay & Visa until
KAN-283: pay moved to step 1, beside the job types that set its units, and
the visa filter question left onboarding. A visa filter saved before is
kept, and the Jobs page still sets it.

**Step 1's answers are the Jobs page's filters.** Every question takes
`FeedFilters` and the options in `jobs/filter-query.ts`, and Role, Location,
Start Date and Salary use All Filters' own pickers
(`components/filter-controls.tsx`), so the saved answers fill the feed's
filters with no translation. Start Date differs from All Filters
(KAN-275): it lists only seasons still ahead, with no bare year ("2027
(Season Not Stated)") and no season already under way, both dropped in
`page.tsx`. KAN-275 also asked Visa Sponsorship as two filter tiles (No
Visa Sponsorship, Sponsor Visas) on the second step; KAN-283 replaced that
step with Profile, whose sponsorship question is an application answer, not
a filter. A saved `visa` passes through unchanged, and All Filters still
sets it. They share All Filters' rules too, from
`filter-query.ts`: `payUnits` picks the salary's units from the job types,
and `statesNarrowCountries` saves United States and California as
California. A fixed choice is a `ChoiceTile`
(./choice-tile.tsx): a box for any-of, a dot for one-of.

**It sets larger than the app.** Each step is one question with the screen to
itself, so the question is `text-hero` (40px) from lg, and the shared pickers
take `size="lg"` (taller fields); All Filters keeps their default size. The
right side has three type sizes at every width: 20px for each section title,
16px for every answer (tiles, chips, pills, typed text, the rail's step
names) and 14px for every note beside one, the rail's numbers too; the
signed-in line at the foot is the one 12px exception. `text-subtitle`, the answers' size, carries a 600 weight of its
own, so each answer sets its weight; without it the typed salary and search
text came out semibold.

**The resume step (KAN-275)** is the Resumes view's dropzone
(`components/resume-upload.tsx`), inside the wizard so it keeps Scout's
panel, the step rail and the footer's Back. Picking a file only holds it,
with a Remove; Continue is disabled until one is picked, and Skip is the way
on without one. The dropzone says "Uploading…" only while the file is on its
way: it once took the save's busy state too, so Skip read as if it had sent
a file. The footer's "Saving…" covers the save. It replaced intake
(KAN-214), whose chat asked about each section in turn, on its own page and
in another design: one upload fills most of the bank in one step, and intake
still runs on the Experiences view for what the resume missed.

**Continue or Skip saves the answers.** The Profile step's go to the answer
bank first (`PATCH /applicants/{id}/autofill-answers`, only the changed ones,
KAN-283), then step 1's as the seeker's preferences (`PUT
/applicants/{id}/preferences`, KAN-231, which also marks onboarding
complete). The bank goes first because a finished seeker is never sent back
here, and no other screen asks those questions yet.
Continue then uploads the file through `uploadResume`, and the API reads it
into the experience bank as it reads any upload (ADR 0003). Both open /jobs,
whose Best Match order scores the saved filters' jobs against the bank. The
answers save first: a failed save or upload leaves the seeker on the step,
saying why in the API's words (a sixth upload's 409 among them), and a retry
saves the answers again harmlessly. Date Posted is not asked: a saved "past
24 hours" would empty the feed within days. Sign-in sends an applicant here
until they finish (`docs/auth.md`); a finished one who opens the page again
finds the wizard filled with their saved answers, and Continue saves the
edits. `?step=2` opens the wizard on its second step, Profile; intake's "Back to
Pay & Visa" linked there until KAN-275, and nothing does now. Without saved
answers `?step=2` opens on the first step, which holds the answers that must
be given.

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
