# Screens

How each screen behaves and why: the Jobs page and its filters, the job
posting page and card, the seeker Home, Applications, the Calendar, My
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
preferences apply on a fresh visit only**: a bare /jobs visit draws Best
Match with the saved filters in the same response, where the row shows them
checked, then writes that exact address into the address bar in place (a
shallow replace, `jobs/canonical-url.tsx`; KAN-368). From then on the URL is
the truth, so Clear All clears rather than bringing the saved ones back. A
`redirect()` here made the sidebar's Jobs link pay two round trips with a
blank panel between; do not bring it back. Load More pages whichever order drew the list (`FeedList`'s
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
fill, the ones with an Auto Apply button (every hiring system the Fill engine fills, `?auto_apply=true`,
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
tie, drawn for it since no icon set has one, KAN-252), and inside a popup only
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

**A search's own filters show as chips** (KAN-308). The API reads some of a
search's words as filters: "remote" is the Remote work style, "intern" the
internships, "new grad" Entry Level / New Grad, "summer 2027" or "2027" a
start term (`docs/search.md`). They narrow the results as the row does, but
the row never showed them, so "remote" with Hybrid ticked found nothing and
nothing on the page said why. Above the results, "Your search also filters
by" lists each as a pressed chip in the row's words (search/search-facts.tsx,
GET /jobs/search-facts). Its cross is a link to the same search without the
words that set it, the row's filters kept; when those words were the whole
search, it goes to /jobs under the same filters. Chips, not ticks in the
row: a fact also matches a title that says it ("Remote", "Summer 2027"), a
little more than the row's filter does. They arrive with the results, not
with the heading, so they never push a list already on screen.

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
The page is capped at `max-w-dashboard`, as every seeker page is
(2026-10-27); 1024px had left its facts and checklist cramped (KAN-279).
**A rail of jobs sits on its left** (KAN-297, after Cooper's job board): the
roles the seeker last saw on /jobs or /search, in that list's order, the open
one marked, each a link to its own page. Each rail card has the logo, title,
company, when it was posted and its match, then the feed card's six facts in
the feed card's own grid (`JobFactGrid` in `components/job-posting-card.tsx`,
fed by `listingFacts`), two columns in a narrow rail and three from 448px of
card: asked for 2026-10-22, when a card showed only the company and place.
It lives in `jobs/layout.tsx`
(`jobs/jobs-rail.tsx`), above the job's segment, so it stays mounted and
scrolled where it was while the seeker opens one job after another; Tailor
and /jobs itself draw no rail. `FeedList` writes the list as it shows it
(`jobs/shown-list.ts`, sessionStorage `workit:shown-list`) with its own
query and order, and the rail's Load More continues it with the same
actions. A list over 30 minutes old is fetched again, and a job opened with
no list (a shared link) shows the newest roles. The rail shows from
`@4xl/main`; below that the page is as it was. Beside it the job's page
stops at 60rem, and the rail takes the room past that, from 18rem
to 40rem: 288px at a 1280px window. It scrolls on its own, held to the
page's height by the shell's 64px bar (4rem); change that with the bar's
height.
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
**Pick a Resume is hidden for now** (2026-10-21, on the user's ask): Apply
Now is a plain link that opens the employer's posting in a new tab, and for
a signed-in applicant who has not marked the job the same click opens
"Did You Apply?" (below) behind it, its resume list starting on the one
Pick a Resume would have picked (tailored, else the default). Yes, I
Applied stays off, under "Loading your resumes…", until that list is in:
before it, the pick is only a guess. **Upload Resume**, in the list's row
beside the search and the Type filter (KAN-406), uploads the file the
student sent (`uploadResume`, which reads it into Experiences as any
upload does): the new resume is picked once the list reloads, under
Uploaded, with the search and the filter cleared so nothing hides it, and a duplicate picks the one
it matched, saying "Duplicate Resume found: <name>". **At the 5-upload
limit** (`lib/resume-limits.ts`, the API's own) a file waits under the
row while the student picks an upload to replace, then Replace It runs Import Updated
Resume (`replaceResume`) on that row: the old file's sent resumes keep a
frozen copy, so past applications lose nothing. Yes, I Applied stays off
while an upload runs or a file waits. The hidden
steps stay in `jobs/apply-button.tsx`, commented out, with how to bring
them back. What follows describes them as they were.
Apply Now (`jobs/apply-button.tsx`,
KAN-220) opened "Pick a Resume": the student's base resumes, the one tailored
to this posting and the uploaded resumes, with the tailored one, else the
default, picked first. Apply keeps a sent resume linked to the posting, then
shows Open in Resumes and Open the Posting (links in new tabs, so no popup
blocker stops them and the dialog stays to ask "Did You Apply?"). **The
dialog downloads nothing** (KAN-267): a student gets resume files on
Resumes & Experiences only, so Open in Resumes goes to a built resume's
editor (its Download) or, for an upload, the Resumes view. It had a
Download Resume button until then. Apply Without a Resume leaves for the employer's posting at once.
**Every Apply Now opens this dialog** (KAN-290): the page's, the feed card's
on /jobs and /search. WorkIt cannot
see the employer's site, so the dialog is its one chance to learn which
resume went and whether the student applied; a card's Apply Now once linked
straight to the employer and recorded neither. A card's button has no
new-tab glyph, since it opens the dialog and the dialog's links carry it.
Once a resume is sent, the page reads "You sent <name> on <date>" under
the header (`[jobId]/sent-note.tsx`, story 98), the last sent resume
linked to this posting, its day in the viewer's zone. Only the job's own
page refreshes on a send (`showsSent`): on a card a refresh reran the whole
feed, Best Match scoring and all, to redraw nothing.
A job's Key Requirements list is read with the page's other reads
(`loadJobView`) and handed to the card, not fetched by the card after them
(KAN-368); it still answers an empty list on any failure, so the page draws
without the card, and the application page's description tab skips the read.
The page has a `loading.tsx` whose header and Key Requirements skeletons
stand at the height of what replaces them; Tailor has its own, so this one
never stands in for it.
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
every hiring system the Fill engine fills, `backend/app/auto_apply/hosts.py`); every other job
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
without the matching: it starts batch apply, or tops up the batch running
(`openNextApplication`, KAN-370): the extension opens the queued jobs in
background tabs in this window, at most five filling at once, and sorts
each filled tab into its "Ready" or "Needs you" tab group. The student
stays on this page. It runs after the click settles, so the
button never waits on a page load; only a failure shows, as a line above
the button (no extension stays silent). A job open in a batch tab reads
**Working in Browser** (the AppWindow glyph) on every card that shows it,
read once per page from the extension (`useBrowserJobs` in
`src/lib/autofill-extension.ts`, asked again whenever the tab gets focus).
It goes back to Queued only when the extension says the tab is closed,
never on a failed answer: coming back from the run's tab once reset it;
a click switches to its tab (`showRunTab(jobId)`, tooltip "Go to the tab"), and the job
leaves the queue from Live Activity only. Its first state comes from
the server: the job's page reads its one application (`GET
.../applications/{job_id}`), and /jobs and /search read every application
once beside the first page (`getApplicationStages`) and hand the stages to
each card, Load More's too. A stale one is harmless: a click answers the real
stage. Back returns to the list the seeker came from: the feed, filters and all, or
the Auto Apply page (`RememberFeed` on /jobs, /search and /auto-apply keeps
the last one visited in sessionStorage), or the Resumes page when a
tailored resume's posting link opened it, or Home when a Top
Matches row opened it (`rememberReturnTo`, KAN-268 and KAN-342, set on the
click rather than the visit, so a job opened from elsewhere after a look at
/resumes or Home does not go Back there). When the seeker came straight from
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
applied with** (KAN-267): the resume list (below), whose row holds
**Upload Resume** (above), then a full-width **No Resume** button, not
a section: pressed (the brand fill, `aria-pressed`), it is the pick and
every radio above clears; a radio pick unpresses it. The dialog is wide
(`sm:max-w-3xl`, not the default `sm:max-w-sm`) and scrolls inside itself
on a short window.
**The resume list** (`ResumeLists` in `jobs/resume-picker.tsx`, KAN-360,
KAN-406) is the one picker in all four resume dialogs: this one, Tailor's
Pick a Resume to Tailor, Auto Apply's Choose a Resume and the Experiences
view's Choose a Resume to Show (KAN-361, which builds its rows from the
bank's resumes, with no posting). It is the Resumes page's grouped list
(`components/resume-list.tsx`): one row with a search by name and by the
posting a resume was tailored for, the **Type** filter and, in Did You
Apply? and Tailor, **Upload Resume** (as two even halves under the search
below a 36rem row; no Sort or Generate Resume, which a dialog does not
need), then **Uploaded**, **Generated** and **Tailored**
under pill headings with counts, each heading folding its group for this
opening, in one scroll five cards high. Each card is the Resumes page's
box with a radio: the file mark, the name, one line ("Uploaded Oct 21",
"Last edited Oct 21 · For Backend Intern at Initech", "Made Oct 21 · For
This Job") and the Primary star. A group lists the resume tailored to this
posting first, then the primary, then the newest. A click anywhere on a
card picks it, and the arrow keys move the pick across every group (one
radio group); the search only filters, so the pick survives it. Names
wrap, never truncate: two resumes tailored for one company differ only at
the end of their names. A table came before it (KAN-360): a Generated or
Uploaded switch, then Type, Tailored For and Last Edited columns. Once the
Resumes page took the grouped list (KAN-404) the two read as different
apps, and the columns said what a card's one line says. Two lists side by
side came before the table, and the user found them ugly once a student
had a few tailored resumes. Did You Apply? and Tailor each had an upload
section under the list ("Sent a Different Resume?", "Tailor a Different
Resume?"), a dropzone that took more room than the list, until KAN-406
moved Upload Resume into the row as the Resumes page has it. It lists the resumes Pick a
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
so the next Load More skips nothing.
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

## Seeker Home

/home is the seeker's home: sign-in lands there.

**Next Up, Up Next and Waiting are archived for now** (KAN-261), and the
header's Find Jobs button is gone (the sidebar's Jobs row and the Good
Matches tile lead there). The tracker stores no dated events yet, so Next Up and
Up Next only said "nothing scheduled", and Waiting's buckets were a fixture.
Under the numbers, Activity runs the full width.
The archived tiles' code stays (`next-up-hero.tsx`, `up-next.tsx`,
`getUpNext`, `waiting.tsx`, `WAITING`); a note in `home/page.tsx` says
how to bring them back. The notes below still describe them.

**Top Matches sits under the numbers** (KAN-342, `home/top-matches.tsx`):
the seeker's twelve best-scoring open jobs, best first, from the Best Match
scores (`getMatches` in `home/data.ts`, `GET /jobs/recommended/{id}/home`),
with no score floor. A new seeker's thin experience bank can score every job a Weak
Match, and their best weak ones are still where to start; the Strong Matches
number above counts only 80 and up. Each is a flat row in one tile: a well
with the logo, the title (its link to the job posting page), the company,
the match ring, when it was posted, then Save and Apply Now (the same
dialog as everywhere, KAN-290). From `@4xl/main` the match ring and the
posted date are columns of their own, centred on the row's height at fixed
widths, so they line up down the list (KAN-423); squeezed onto the
company's line they read as one cramped run. Below it they stay on that
line. Tailor My Resume sat between them and was
taken out at the user's ask: the list is for choosing what to apply to. The
title's link (`top-match-link.tsx`) makes the job page's Back return to the
Home. **Auto Apply**, at the heading's right beside See More Matches,
turns the list into a picker (`top-matches-list.tsx`) of the seeker's best
matches that auto apply can fill (the same call's `auto_apply` list, each
as `?auto_apply=true` lists it): the top list may hold none, since auto apply
fills Greenhouse alone for now. Each row gets a checkbox in front, the whole
row toggles it, and its buttons step aside; a row that already has a stage
(queued, applied) is dimmed with it. "Add N to Queue" queues each pick
through `queueJob`, the job's own Auto Apply button's call, then asks the
extension to open the oldest queued job (`openNextApplication`), and a toast
says how many went in, with View Queue. The seeker picks every job, so auto
apply still never queues a saved job on its own. The button is off when no
match can be auto applied to. The checkbox takes `border-ink-meta`, as
CheckRowBox does: the vendored hairline drew the empty box at 1.19:1. See More Matches, a secondary button at the heading's
right, opens Best Match. From `@4xl/main` the list scrolls inside the tile at
`h-scroll-box` (320px, the token every scroll box in a dialog or tile
shares), about four and a half rows, with a quiet bar along the tile's edge
and a fade at its foot; below it the list shows five rows and does not
scroll (a box that scrolls inside a scrolling page traps the swipe), and
below `@xl/main` Save and Apply Now take their own full-width line, since
beside the text they squeezed the title to two words a line. The Jobs page's own cards
were tried here first and were too tall for a glance: three filled the
screen. With an empty bank it asks for the bank. It streams in its own
`<Suspense>` with a skeleton in the same frame, so the numbers never wait on
scoring, and the page starts its reads first, before its other awaits, or
the scoring call runs one whole call late (KAN-368). **Home makes one
scoring call** (KAN-425): Top Matches, its picking mode and the Strong
Matches dates come from `GET /jobs/recommended/{id}/home`, one pass the API
keeps until the bank, the job postings or the applied jobs change, so a
return to Home is served from it in well under a second. It was three
`GET /jobs/recommended` calls and the tracker's scored read at once, each
a full scan of the job postings' vectors, and took 13 to 23 s on
2026-10-28. The tracker read here is `getTrackerUnscored`: Home shows no
application's score. The page awaits
only the account: the headline numbers (the Strong Matches count is a full
scoring pass), Top Matches and Activity each stream over a skeleton of their
shape, and `home/loading.tsx` draws the same frame (`HomeFrame`),
so a prefetched click shows it at once and the page replaces it in place. It replaced New Matches, the newest postings in posting order in
the same scrolling frame, which went when Strong Matches replaced New Roles
and came back ordered by fit at the user's ask. The notes below that name
New Matches describe the archived three-column layout.

**The seeker Home is a bento of tiles** (KAN-173), modelled on a
reference the user picked: white tiles with no outline on the white page
panel, set apart by a soft violet-tinted `--shadow-tile` alone,
`rounded-shell`, `p-5`, 16px apart. An outline on every tile read as a grid
of grey boxes, and a lavender ground under them read as muted beside the
shell's white panels; keep both off. Headings and figures are medium weight, figures in
`--text-figure` (36px), and actions are the app's rectangular buttons (they
were pills, `shape="pill"`, until KAN-251 made every pill a chip). It
is capped at `max-w-dashboard` (1440px), as every seeker page now is.
From `@4xl/main` (896px, not `@5xl`'s 1024: a 13-inch laptop at 100% zoom
gives the page about 1010px and fell back to two columns of oversized
tiles) the four numbers run across the top in a grid of their own
(each tinted with its own colour: KAN-423, below), and the tiles under them sit in
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
Draw a new Home section with `SectionCard`, never a one-off box.
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
funnel only restated the headline numbers. Everything the page shows is
live (KAN-342); the one fixture left in `(seeker)/home/data.ts` is the
archived Waiting tile's buckets. Next Up and Up Next take the tracker's
upcoming events (`getUpNext`). The tracker stores
no dated events yet, so Next Up reads "You're All Caught Up" with Browse
Jobs, and Up Next "Nothing else scheduled." Next
Up's View Details button opens that application's own page (its old
`?app=` link redirects there) and its date that week on
the Calendar; an Up Next row opens its day in the Calendar's Agenda, and View
All the Agenda; Waiting's Follow Up opens the Applications list filtered to
Applied. That is a placeholder: it helps nobody contact anyone, and KAN-174
(still open) plans the real flow, a list of only what has waited two weeks,
a Scout-drafted note, a recruiter search, then marking an application
followed up or closed once the tracker has a backend. The headline numbers are Strong Matches, Saved, Applied and Interviewing
(`getHeadline` in `home/data.ts`), all live (KAN-342). **The Tracker's
tiles are named for its stages**, the Status filter each one opens: Applied
was "Applications", the same word as the page it opened, and Interviewing
was "Interviews". **The order is the search, left to right**: find, save,
apply, hear back, as the Applications Tracker's stages and the landing page's route run,
so the left half is what is left to do and the right half how it is going
(in the 2 x 2 grid on a phone too). Interviewing sits last as the outcome, not as a gap in the middle. The order
was Applications, New Roles, Interviews, Saved, which read out of sequence.
**Each tile is tinted with its own colour, its glyph white in a solid disc
of that colour** (KAN-423, `STAT_TONE` in `home/headline.tsx`). The user
picked the colours: Strong Matches green, Saved grey, Applied violet,
Interviewing yellow. The grounds are the tints each colour already has
(`--color-positive-tint`, and the stages' tints from `stage-colors.ts`,
the board's panels); the ink-meta note holds 4.7:1 or better on each, the
green or red change 4.5:1 or better. The discs: Strong Matches
`--color-positive-ink` (5.35:1 under the white glyph), Saved and Applied
their stage fills, Interviewing `--color-warning-deep` (Tailwind's
yellow-700, 4.92:1), more yellow than the stage's own orange-leaning
amber. Strong
Matches' green is Offer's stage hue, a known overlap. Strong Matches was
the one filled tile, in violet, until then, and Applied before it: violet
is Applied's stage colour, so the loud tile and the Applied badges said
two things in one colour. Tried and turned down on the way: the match
ramp's magenta, a burnt amber, every tile filled with its solid colour,
and plain white tiles with only the discs coloured. Applied
counts the tracker's applications sent in the range, against the same
length of days before it. Strong Matches counts the job postings from the
range that score Strong Match (80) or better for this seeker (it was Good
Matches, counting from 65, until the user renamed it; the threshold moved
with the name, so a 70% job never sits under a label its own Good Match
badge contradicts), from the Best
Match scores (`getMatches`' `strongPosted`: the dates of the postings from
the longest range scoring 80 or more, counted per range in `data.ts`). It
shows no change, since a score fades with a posting's age and last week's
postings would always count fewer; with an empty experience bank it says
"Add your experience first" and opens the bank. It replaced New Roles, a
count of every posting in the feed, which said nothing about the seeker and
drew a red change whenever employers posted less. Interviewing counts the
applications in that stage now, "Right now", the same in every range
(KAN-413: the stage menu or an interview added on the application's page
sets it); it was a dash, "Not tracked yet", until the API stored the
stage. Saved counts the seeker's live saved jobs (KAN-261)
and ignores the range. Applied and Saved show a dash when the tracker
can't be read. **Every tile links**: a click anywhere on a tile opens the
page that lists what it counts (the Applications Tracker filtered to applied,
interviewing or saved; the Jobs page in Best Match order, filtered to the
week or 30 days posted). The lists take no date window, so the Applied
list can hold more than its number. Under the pointer a tile lifts 2px onto
`--shadow-lift` and its glyph slides out of its disc as an arrow slides in, so it reads as clickable; a press
settles it, and reduced motion keeps only the colour. A lift alone, which
only two linked tiles once had, was too slight to say so. A keyboard focus
rings the tile. Its range is `?range=`, moved in place: the
headline (`home/headline.tsx`) is handed every range's figures and reads
`?range=` itself (`useRange` in `range-switch.tsx`), so a new range counts
its numbers with the switch's thumb instead of after the server draws the
page again. The streak always shows the full year regardless of range.

**A filled day opens its applications** (KAN-423,
`home/day-applications.tsx`): a click, a tap or Enter on a day with any
applications opens a dialog headed with the day, a table of what was sent
that day, earliest first (the company tile over the role and company, the
time it went in on the viewer's clock, its stage's badge now), and View All
Applications. A row opens that application's page. The day is the viewer's
own (`localDay`), the day the streak counted it on, so `getAppliedApplications`
in `data.ts` hands the streak each sent application, not just its instant.
An empty day opens nothing; a tap on it pins its count as before. **Both
views draw every day as a rounded square** (KAN-423, `streak-canvas.ts`,
`RING`): the outline is built on the ground in world units and projected,
so the 3D skyline stands as rounded pillars, each side shaded by where it
faces. The 3D view used to round the box's top in screen space by a radius
that shrank to almost nothing as it rose, so the skyline was square boxes
beside the heat map's rounded tiles.

**Activity is a daily streak** (`(seeker)/home/streak.tsx`), no longer
a weekly pace chart: the past year of applications per day as a heat map that
folds into a 3D skyline, adapted from 21st.dev's Contribution Skyline. Its
heading is Activity; its files and tokens say streak. It opens on the 2D heat
map, and its four numbers (Past Year, Busiest Day, the two streaks) show only
there, each in a grey well (`--color-well`) with its dates in a tag pill, as
Home draws every date; as open text in ink-muted under each figure
they read as loose lines (KAN-342). A number with nothing to date says so in
its pill ("None yet", "Apply today"), so the four keep one shape. Label,
figure and pill each take a line of their own: with the pill on the
label's line, "Apply today" wrapped under "Current Streak" alone and that
well stood taller than the other three. **The section is one height in both views** (KAN-342): the 3D
skyline takes the room the heat map and its numbers share, growing over the
numbers as they fade (`--streak-h2` and the room in `streak-canvas.ts`).
With a 3D height of its own the section swelled and shrank through each
switch, since the canvas and the folding numbers ran on different curves,
and in 3D it ran past the fold. The page scrolls: at 1280 × 720 the numbers
and the top of Top Matches show above the fold, and Activity follows it. Before Top Matches came back the whole page fit with no scroll. They show only
there: the 3D skyline stands alone, with no numbers under it or in its corners. `streak-model.ts`
is its pure maths (grid, levels, stats, camera), `streak-canvas.ts` the
canvas engine (no React: the section mounts it once and it re-reads a ref
every frame), `streak.tsx` the section. It stays beside Home rather
than in `components/ui` until a second route wants it. The canvas reads its
colours off the section at mount: `--color-streak-1..4`, a violet ramp
validated as ordinal in `globals.css`, and `--color-border-subtle` for an
empty day, so a token edit restyles it. The current streak runs to the
viewer's today (yesterday while today is open), so `today` comes from
`useSyncExternalStore`: UTC on the server, the browser's own after hydration.
It ignores `?range=`, since a streak is every day. It is live (KAN-342):
`getAppliedApplications()` in `data.ts` hands it each sent application's
`appliedOn` instant, and the streak counts each on its UTC day until
hydration, then on the viewer's own (`localDay`), by the same
`useSyncExternalStore` swap as `today`. A failed tracker read draws the
empty year with a line saying the applications aren't loading.

## Applications (the Applications Tracker)

**Its name on screen is the Applications Tracker** (KAN-342): in the
sidebar, the browser tab and its heading, and "Back to Applications
Tracker" on an application's page when the tracker opened it (its Back
names the page that did, KAN-363). It was "Applications", the word the
Home also used for a count, so the page and the number read as one
thing; then "Tracker" in the sidebar with "Application Tracker" as its
heading, until the user named it Applications Tracker everywhere. The
marketing site still calls the feature "Application Tracker". The URL, the
folder and the code keep `applications`: moving the folder would collide
with every open branch that edits the page. Say "the Applications Tracker"
in copy; a stage is one of Saved, Applied, Interviewing, Offer and Rejected
(`GLOSSARY.md`).

/applications is the tracker: a list (the default) and a grid over
`applications/data.ts`, every choice in the URL; a row or card opens the
application's own page, `/applications/[jobId]`. `(seeker)/tracker.ts` is the tracker's shape
and date logic; `local-time.tsx` prints its dates in the viewer's own zone and
links them to the Calendar.

**Emails live on their own page, the Inbox** (KAN-413, below). This page
keeps one line above the filters while any email needs review ("3 emails
need a look", Open Inbox, to `/inbox`), counted from `GET
.../events?status=proposed` (`getUpdatesOnce`). An email table sat here
first and read as a second copy of the list, so it went (the Inbox
section says what else was cut).

**The tracker is live, with no fixture** (KAN-261). `applications/tracked.ts`
reads the seeker's applications from the API (`GET
/applicants/{id}/applications?stage=saved&stage=applied&stage=interviewing&stage=offer&stage=rejected&scored=true`,
the list Live Activity reads too), written by a job's Save button and its Applied button
or auto apply, and the events on them (`GET /applicants/{id}/events`,
KAN-413), joined by job id; `getTracker` in `data.ts` caches it per
request. A stage past applied comes from the stage menu or an event on the
application's page (below); nothing on this list moves a card. A card is its job posting: its id is the
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
Applied), how good it is (Match), the job's facts (Job Type, as the Jobs
page names it, though the code and `?track=` keep the older name Track;
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
another column (below). Notes / Next Step is a placeholder ("No notes yet")
until the API stores notes. Status is any of the five stages; Rejected is
red (`--color-danger`), last in the Status filter. Resume is the sent resume the application names
(`sent_resume`, KAN-267): the one picked on "Did You Apply?", or the one
auto apply attached; "Not sent" when the student said No Resume, applied
before KAN-267 with nothing sent, or deleted that sent resume. **With one, the cell is View Resume** (KAN-267,
`applications/view-resume.tsx`): an sm button naming the resume, the cell's
whole width, that opens it in a dialog over the list, 92% of the window's
width and height (80% looked squished) (it follows a resize), the PDF filling it. A click anywhere in
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
  and one per field (Company, Job Type, Work Model, Source), each the Jobs
  page facet's look (glyph, label, chevron, brand tint while it holds a
  pick) over checkbox rows. Status lists the four stages, each with its
  stage's glyph in its colour; the fields list every value the tracked
  applications hold. **Company has a search field** at the top of its
  list, as the Jobs page's Role dropdown does, since the list grows with
  every application; a pick keeps the search. The dropdowns step out one
  at a time from the right as the row narrows (Status from 440px of row,
  Company 592, Job Type 744, Work Model 896, Source 1048); at
  the right end, Clear Filters as an outlined cross (shown while anything
  is picked or searched; it hands focus to All Filters), All Filters, and
  Columns in the list view. A phone's row is All Filters and Columns.
  Status was a row of stage chips with counts (KAN-256), and an earlier
  draft had one Filter button with every field in its menu; both became
  dropdowns after the Jobs page on the user's ask (2026-10-19). The
  chips' counts went with them, as the Jobs page's options carry none.
- **All Filters** is a panel with every field, as on the Jobs page: Status
  (with the stages' glyphs), Company (a search
  picker, since the list grows), then Job Type, Work Model and Source as
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
and Home can link to a filtered list or one application. The
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
KAN-279). Only Back differs (to the page that opened it, else the
tracker, `JobActionBar`'s `back` slot; `(seeker)/back-link.tsx`). No match rail, as on the job page: an earlier draft added the
Jobs card's ring, which made the same job look different by how it was
opened. Analytics and explanations go on the Your Application tab only.
**The bar holds the tabs once there is nothing to do**: an applied job, or a
closed posting, has no use for Apply, Tailor, Save or Ask Scout, so the bar
shows the tabs beside Back instead. A saved job with an open posting keeps
the job page's actions, and its tabs sit under the header. Three tabs, each a
URL (`?tab=emails`, `?tab=job`; **Emails**, KAN-413, lists the job's
emails as the Inbox does, `[jobId]/emails-tab.tsx`, each opening in the
Inbox) that moves in place (KAN-368,
`applications/[jobId]/tab-panes.tsx`): the server draws both panes once and
the tabs change `?tab=` with `useShallowParams`, as Home range does,
so a click no longer draws the page again with the scored tracker read and
the job's reads. The job's buttons take their stage and applied date from the
tracker row, and the tab title comes from the posting's own read:

- **Your Application**, the default. One card tinted by its stage
  (`STAGE_COLOR[stage].panel`: violet for Applied, grey for Saved, amber,
  green and red for the three after), so it
  reads as the seeker's record rather than a second white card under the
  job's header. On the tint: the stage as its glyph on a solid disc and its
  name (the board's column headers; a badge's fill is the tint itself),
  and at the row's right the **stage menu** (KAN-413, `StageMenu` in
  `[jobId]/tracker-controls.tsx`): Applied, Interviewing, Offer or Rejected,
  any way, "Move To…" on a saved job, since saved is a bookmark it never
  goes back to; then a one-line status per stage (`HEADLINE`: "Waiting to
  Hear Back", "In Interviews", "Not Moving Forward"...), the resume sent (and
  when it was saved, for a saved job), the timeline left to right (`Timeline`'s
  `horizontal`; each dot wears its stage's glyph, not a check, KAN-317), and
  two cards of facts (KAN-286): whether the posting is
  Open or Closed, then the days since the seeker applied (for a saved job,
  the days since the posting went up). The status line drops the applied
  date, which the card and the timeline already carry. **What one action
  wrote is one step** (KAN-317): Apply saves, sends the resume and applies
  within a second, in no fixed order, and sorted by the millisecond the
  timeline once read Sent, Saved, Applied at one minute. A resume sent
  within two minutes of applying is now the Applied step's "Resume sent",
  and a save within five seconds is left out (the same click writes both at
  one time; a two-minute window once hid a save made a minute before
  applying); steps further apart keep their own dot,
  and a tie sorts Saved, Sent, Applied. The application's events follow
  on the same row (KAN-413): one still ahead is an empty ring, and the
  first of those is marked Next. A closed posting
  says so in its card only, with no badge beside the stage. The cards
  replaced day counts that did not help: save to apply read 0 for every
  Apply (Apply saves and applies at once), and posted before applying only
  told the student about the past. A suggested follow-up day was tried and
  dropped, as any fixed number of days is a guess. A total applicant count
  would fit, but no hiring system WorkIt reads publishes one; a count of
  WorkIt's own applicants is possible from `job_applications` and would
  need a field on the tracker's response. **Interviews & Dates** sits
  under the card (KAN-413, `TrackerEvents`): every event, soonest first,
  each with its kind's stage glyph, its day in the viewer's zone, Join
  Meeting for its link, its note and a Delete (the stage stays), and **Add
  Event**, a dialog: Type (Interview, Assessment, Offer, Rejection,
  Follow-Up), Title (blank takes the type's name), Date, an optional Time
  (blank is a whole day, sent as a bare date; a time is the viewer's own,
  sent as an instant), Meeting Link and Note. Its line says when adding it
  moves the stage (an interview to Interviewing, unless further along).
  Each write refreshes the page, so the one tracker read draws it
  everywhere. Editing an event is not built: delete it and add it again.
  The cards and the match are
  rounded white boxes on the tint: each
  card a `Card`, the match the Jobs page card's `MatchRail` with
  `standalone` on white, with its reasons (`?scored=true` sends
  `highlights` with `match`). Ruled, square cells were tried first and read
  as a spreadsheet next to the app's rounded cards. The match sits right of
  the rest from 576px of card and under it below that. Under the card,
  What You Sent has two parts, Resume and Answers (KAN-317). Resume lists
  every sent resume linked to the posting as a row in the Resumes view's
  box (`SentResumeRow` in `view-resume.tsx`, on `RESUME_ROW`): the file
  mark, the name, "Sent Oct 21 · PDF", a Rebuilt tag for a rebuilt upload
  and, on the one the application names, the Applied status badge (the
  list's own, not a green Applied With). The whole row opens
  View Resume's dialog (`useResumeViewer`, shared with the list's button).
  It was a bare View Resume button with loose tags until KAN-317, unlike a
  resume anywhere else. With none sent, a dashed placeholder box (the
  upload dropzone's outline) says "No resume sent yet". Answers is that
  same dashed box for now: neither Apply nor auto apply keeps the answers
  typed into the employer's form yet, and the slot holds their place so
  the section keeps its shape when they arrive.
- **Job Description**: About the Role alone (`JobViewBody`'s
  `descriptionOnly`). The job page's sent and applied notes and its
  Key Requirements card stay off: they pushed the description down and are
  the application's record, which the first tab already holds.

The application comes from `getTracker`, so its score, resume and stage
match its row. A job the seeker has not saved or applied to is not found. A
closed posting has no job page (`GET /jobs/{id}` answers 404), so the header
shows what the tracker knows, marked Closed, and the description tab says it
is gone. The cards round elapsed time, as "Posted 8 days ago" does: cut,
an application sent 47 hours ago read as waiting 1 day.

## Inbox (`/inbox`)

**Archived (KAN-428).** Hidden behind `INBOX_LIVE` (`inbox/live.ts`) until
WorkIt has a source of emails: no sidebar row, no Emails tab, no Tracker
notice and no Gmail row in Settings, and `/inbox` redirects to
`/applications`. Everything below is the Inbox as it stands, for the day
the switch goes back on.

KAN-413, `../../docs/email_tracker.md`. Every email about the student's
applications, a sidebar row after Applications Tracker (Tray glyph, no
count badge), laid out as a mailbox: one filter dropdown over a list
beside a reading pane (`inbox/inbox.tsx`). The filter and the open email
are the URL (`?status=interview,offer`, `?email=<id>`), moved in place by `ShallowLink`, so a click never asks the
server and an application's Emails tab can link to one email. Below md
the list and the email take turns, with Back to Inbox.

- **The filter** (KAN-427) is one of the Applications Tracker's dropdowns
  (`components/field-facet.tsx`), Status: what the email says of its
  application (Interviews, Assessments, Offers, Rejections, Application
  Received, Updates), each option in its pill's glyph and colour as the
  Tracker's Status options wear their stage's (`emailKindGlyph` in
  `applications/email-kinds.tsx`: a stage's glyph where the kind has one,
  a clipboard for an assessment, grey for the two that change nothing),
  with a cross to clear it. It was six chips (KAN-413),
  which grew with every kind, then two dropdowns, Kind and a review Status
  (Needs Review, On Your Tracker, Set Aside). The review one went with the
  cards' Needs Review badge as noise, and the kinds took the name Status:
  an interview or an offer is where the application stands. The Tracker's
  "emails need a look" line links the plain Inbox.
- **The toolbar** (`inbox/toolbar.tsx`, KAN-427) is Gmail's, over the
  list: a select box (a click picks every shown email, or unpicks while
  any is picked; a dash while some are) beside a menu that picks All,
  None, Read or Unread. While nothing is picked: Refresh
  (the page's read again) and More, with Mark All as Read. While some are:
  "N selected", Add to Tracker and Set Aside (the banner's Confirm and Cancel on the
  picked emails that need review; Add to Tracker skips one with no job and
  says how many it left), and one read toggle, Mark as Read while any
  picked is unread, else Mark as Unread. The right end counts the shown
  emails ("3 of 6"). A row's box sits beside its link, never inside it. A
  pick lasts while its email is shown; an action clears the picks. Below
  md the toolbar hides while an email is open.
- **Read state** (`application_events.read_at`, KAN-427) is Gmail's:
  opening an email reads it, Mark as Read and Unread set it for the picks
  (`PUT .../emails/read`), and accepting or setting one aside reads it
  too. The Inbox draws a mark at once and the write follows; a refused
  mark is put back with a toast, and a failed read-on-open says nothing
  (it only stays unread).

The page is exactly the screen under the bar (`h-[calc(100svh-4rem)]`, the
job rail's height, KAN-427). The heading and the filters stay in
place; the frame under them takes the rest, the toolbar's row then one that may
shrink (`grid-rows-[auto_minmax(0,1fr)]`), and the list and the open email each scroll
inside their own column (`overflow-y-auto overscroll-contain`), so
scrolling one never moves the other. The frame's floor, `min-h-80`, lets a
very short window scroll the page instead of leaving a sliver of list.
Below md the one column shown scrolls the same way, and Back to Inbox sits
at the top of the email's column.

- **The read:** `GET .../emails` (`getEmails`, every status, newest first
  by when it was read) and the tracker's own read for each job's logo,
  role and stage. A failed read of either is an error state, never an
  empty inbox: without the jobs every email read as Unknown Sender and
  Not Linked. An application's Emails tab says its read failed the same
  way, never "no emails yet".
- **A row** (`inbox/email-row.tsx`, shared with the Emails tab): the
  sender's logo and name (the job's company; Unknown Sender unmatched),
  the received time (the time today, else the day), the subject, one
  line of the text past its greeting, the kind's pill (its glyph and name,
  the glyph its Status option wears, KAN-427). An email that matched no
  job shows an empty dashed circle with a broken link in the logo's spot
  (`SenderAvatar`, shared with the reading pane's sender line; "Not linked
  to an application" to a screen reader and on hover), not a Not Linked
  badge, which was a second pill on the row (KAN-427). One whose job the
  list does not hold (a queued one) is linked, and keeps the envelope.
  Read and unread are Gmail's (KAN-427, `rowFill`): unread is white with
  the sender, subject and date in bold, read is grey (`bg-app`) in
  regular weight with a quieter subject, and the open or picked email is
  lavender, the open one with a brand bar at its left edge. The pointer
  raises a row with `--shadow-row` (side hairlines and a short drop), not
  a fill, which would barely show on grey. An email that waits
  (`proposed`) has no mark in the list: its status banner says so when it
  is opened. A brand dot on the sender's logo meant needs review until
  KAN-427, and read as a mark on the company rather than the email; a
  Needs Review badge after it was noise beside the kind's pill.
- **The reading pane** (`inbox/reading-pane.tsx`), as Gmail lays out an
  open message: the subject and its kind's pill, with View Application and
  Add to Calendar (Google Calendar's own new-event page, filled in) as
  secondary buttons at the right, each a glyph and its word (View
  Application the Tracker's ListChecks, Add to Calendar's CalendarPlus). Both were round icons until KAN-427: the
  arrow out of a box said "another site" for a page in WorkIt, and the
  calendar glyph said nothing until hovered. No date sits beside the pill (KAN-427):
  it repeated the received time on most emails. Then, only while it needs
  review, the status banner (`Decision`, KAN-427): a head naming the
  change (Update Application Status, Add to Application Timeline, Link
  This Email to an Application, Add This Email to Your Tracker), the
  application's logo, role and company, and a before and after, its stage
  now → the stage the email moves it to in each stage's pill, or "Stage
  stays", with Cancel and Confirm; an interview or a due date adds a line
  with its date ("Adds the interview, Nov 4, 2:00 PM, to its timeline").
  An email that matched no job shows Choose Application in the
  application's place: a modal with a view of the Applications Tracker
  (`applications/pick-application.tsx`, shared with Create Event: a search over role and company, and the
  list's rows, logo over role and company, the stage's pill and the
  applied day, latest first), where a row's click picks it and closes the
  modal. The banner then shows the pick with Change, and its before and
  after; nothing is saved until Confirm. It was a dropdown of "Company ·
  Role" lines, which hid where each application stood; one matched to a job the
  Inbox does not list (a queued one) only asks to add it, since a picker
  would not hold that job. It replaced a one-line question ("Move Intern
  to Rejected?"), which said neither where the application stood nor
  which company it was. Then the sender's line (logo, name, "to me",
  "Tue, Oct 27, 9:42 AM (8 hours ago)", a reply arrow to Gmail) and the
  text. Cancel dismisses it from the tracker; the email stays here. An
  email's event has no Delete in Interviews & Dates, and the API refuses
  its delete: every email stays here as a record.
- **Most emails ask nothing:** the API files an email that changes no
  stage onto its job when it arrives (`needs_review`, `file_email`).
- **Pills:** Interview amber, Offer green, Rejection red, Assessment the
  "advanced" tone, Application Received and Update grey
  (`applications/email-kinds.tsx`).
- **What the critique cut** (2026-10-27), so it does not come back: a
  sidebar badge; an email table on the Applications Tracker (cards with
  Move to Interviewing, Not Right and Wrong Job? under two tabs, then a
  table with Accept and dismiss on every row, then three columns opening
  a side panel); that panel's row of worded buttons; violet pills for
  emails that change nothing; an Emails section stacked on Your
  Application.

## Auto Apply

/auto-apply (KAN-223) is where the seeker will apply in bulk. Its sidebar row
sits between Jobs and Applications, in the order the work goes, and its page
uses the same heading block as every seeker screen. The pipeline it grows
into is `auto-apply/architecture.md` at the repo root. KAN-285 redrew it:
the run button moved into the header, and both lists became tables in the
Applications list's frame (one white card, 12px grey headings, rules between
rows), Live Activity with a Status filter and sorting kept in the URL.
KAN-359 put jobs first: Up Next, Ready to Queue and History, below.

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
red instead. Then it starts batch apply (KAN-370): the extension opens the
queued applications in background tabs, at most five filling at once,
the next opening as one finishes, and puts each filled tab in its "Ready"
or "Needs you" tab group (`openNextApplication` in
`src/lib/autofill-extension.ts`, the message `run/open`). The note says so,
or why not (no extension, signed out) in red (`auto-apply/opened-note.ts`,
shared with the job card). Tabs already open stay as they are, so Start
never wipes a form in progress, and the student is never taken to a tab.
Pause and Resume only move
the state. It is off until
the seeker has a resume (`hasResume`, read on the server with both resume
lists), and while a batch is queueing. It never waits on
the tab's page load: the note says how many jobs it queued at once and adds
the tab's result when it lands. The state (`idle`, `running`, `paused`) is
the page's own; a return visit starts idle, so Start queues another batch.

**Add to Claude** (KAN-383) is a secondary button with the sparkle, the AI
mark, in the setup strip while the student's Claude isn't connected
(KAN-424; it sat in the header beside Start, for good, until then). It
opens Claude's Add Custom
Connector dialog in a new tab with WorkIt's name and connector address
(`<api>/mcp`) filled in, so the student checks and confirms and never pastes
a URL (`src/lib/claude-connector.ts`, Anthropic's documented link). Claude
then signs in to WorkIt through the consent page (`/connect/claude`), and
the student's own Claude writes the batch's essay answers
(`auto-apply/architecture.md`, 14.6). Once Anthropic lists WorkIt in its
connector directory, `CLAUDE_CONNECTOR_LINK` points the button at the
listing instead.

**Written Answers** (`/auto-apply/answers`, KAN-385) is batch apply
without Claude. The extension fills every factual field itself and leaves
the written questions (why this company, a project you're proud of) to the
student's own Claude through the connector. A student without Claude
answers them here: every question the batch's open tabs need written and
have no answer for (`GET .../written-questions`), one white card per job
posting, oldest application first, each question with a box for their own
draft or text pasted from any AI (`auto-apply/answers/answer-box.tsx`).
**Check and Save** sends it through the connector's own save, so WorkIt's
checks run on it as on Claude's (machine-made words, numbers the student's
experience and the posting don't hold, another employer's name, the form's
own limit...). A failing answer shows each reason in the warning amber
under its box and is not saved, so it never reaches the form; a passing one
says Saved, and the open tab fills it within about ten seconds and moves to
Ready once nothing else needs the student. The count under a box is the
form's own limit, amber past it. The list is read once as the page loads;
a saved answer stays, marked Saved, until the next visit. Nothing left
reads "Nothing Left to Write". **The Auto Apply page links to it** from
each Up Next row with questions waiting, whose chip ("2 Questions to
Write") opens it, and, while the student's Claude isn't connected, from
the setup strip's Or Write Them Yourself (KAN-424). A card over Up Next,
"N Written Questions Waiting", did this until KAN-424; it counted the
questions without saying whose. **Write with Claude** (`auto-apply/write-with-claude.tsx`,
beside Written Answers' heading while a question waits) is a
secondary button with the sparkle: it opens a new claude.ai chat in a new
tab with "Write my WorkIt answers" in its box, not sent, and copies the
same text, with "Press Enter in Claude (or paste)" under it in meta type.
The link holds only that fixed text (`src/lib/claude-connector.ts`).
**Your Answers**, below, lists every written question already answered
(`GET .../written-answers`, KAN-369), one white card per job posting at any
stage, newest application first: the question, the answer as sent and,
when the student's Claude named one, its **Named fact**, the company brief
fact the answer uses, linked to the page that states it, so the student can
read up on it before an interview. Every answer has a muted **Delete**
under it (KAN-369): the student's own (a Looks right or Save for next time
in a batch tab), one saved here with Check and Save, and their Claude's;
not own limits reuse, not removal. It asks first on that line ("Delete
this answer? Later forms won't fill it.", the red Delete Answer and Keep
It, as on Resumes), then calls `DELETE
.../applications/{job_id}/answers?name=&own_only=false` and refreshes the
list; a question an open tab still asks shows above again, unanswered. A
failed delete keeps the answer and says why in red under it. The list is left out when nothing is answered or it doesn't load.

**New** (KAN-369): an answer the student typed into a batch tab's form is
saved as they type, and the tab's panel says "Saved N new answers" with
**Review**, which opens this page. Each of the student's own answers saved
since their last visit wears a brand status Badge, New, beside its question.
The last visit is the `answers_seen` cookie, the newest save time the page
showed (`auto-apply/answers/new-answers.ts`, written by `seen-now.tsx` once
the page shows), so the marks clear on the next visit; a student who never
opened the page sees every own answer New.

**Jobs lead the page** (KAN-359): the heading with **Start Auto Apply**,
its one action, and under the title the queue in a line ("2 ready to apply
· 1 needs you", each part only when it counts something); then the
**setup strip**; then **Up Next**, and nothing else for now. It opened
with a "Resume List" table of every resume until KAN-359, then a line
naming the default resume, which the user removed: each queued job now
shows and changes its own resume. Manage Resumes and Add to Claude sat
beside Start until KAN-424, three bordered buttons of one weight for a
page with one action.

- **The setup banner** (`auto-apply/setup-strip.tsx`, KAN-424): one card
  under the heading, only while something a batch needs is missing, gone
  once all of it is done. Three parts across: "Set Up Auto Apply" at
  subtitle size over "1 of 3 done" at the left, the steps centred in the
  room between, and Configure at the right (they stack below 42rem of
  page). With the title small and the steps beside it, the middle stood
  empty and the banner read as off. Each step is its logo, with a mark on
  the logo's corner (a green check, or a gray dot), and its name: Chrome
  Extension (Chrome's mark; asked of the extension itself on load and
  when the tab comes back into focus), Default Resume (a resume in the
  brand violet; read on the server) and Claude MCP (Claude's spark; the
  WorkIt connector in the student's Claude, GET `.../connector`; left out
  when it can't be read). `ChromeIcon` and `ClaudeIcon` are brand marks in
  `components/icons.tsx`, in their own colours, beside Google's; Claude's
  is not WorkIt's AI mark, so Connect wears Claude's spark, never
  `SparkleIcon`. Its one button is **Configure**, since the
  banner sets up the tool: it opens the **Set Up Auto Apply** dialog,
  laid out as a settings page is (after Claude's settings): a row per
  step, its logo in a 40px bordered tile, its name over its reason in a
  column of its own, and its control
  in a fixed column at the right, centred on the row, so every button
  and status lines up and no text runs under one. The control is the
  step's action (Install while `NEXT_PUBLIC_EXTENSION_INSTALL_URL` is
  set, else a Not Installed outline pill, the reason saying to ask the
  team; Open Resumes, where the star sets the default; Connect, Claude's
  Add Custom Connector dialog, with Written Answers linked in its reason
  as the other way), or a green status pill with a check once done
  (Installed, Starred, Connected). No footer: its × closes it. The first
  dialog put a mark before each name, let the reasons run toward the
  button and left "Installed" as loose green text at the row's top, which
  read as off. A first version showed
  the first missing step's action on the banner itself ("Set Default"),
  which read as a puzzle out of context, and named the third step
  "Claude". The extension counts as done until it answers, so a student
  with everything set up never sees the banner flash in.

- **Up Next** (`auto-apply/up-next.tsx`): the queue in one table, **the
  rows that need the student first** (KAN-424; `needsYou`: a closed
  posting, a fill that couldn't finish, or no resume, each saying why in
  its chip), then the rest, each part oldest first, the order the
  extension takes it. A "Needs You · 2" heading over its own table was
  tried and removed: it said again what the header's line and the chips
  say. Live Activity's table with its "queue" columns (`QUEUE_COLUMNS`):
  Role, Status, **Resume**, Match, Date Added and the row's ⋯. No sorting,
  since the order is the run's. **Only a row that opens something takes a
  hover tint**, the whole row: a closed posting's row opens nothing, and
  its frozen Role cell, which followed the row's hover group, once tinted
  alone.
- **The Status cell is a chip only where a row isn't simply waiting**
  (KAN-424, `QueueChip` in `auto-apply/activity-list.tsx`), most urgent
  first: Posting Closed (danger), Couldn't Finish (warning; "Finish it on
  the job's page" in its tooltip), No Resume (danger), Working in Browser
  (advanced, with its ringing dot), "2 Questions to Write" (warning, a link
  to Written Answers), else an inert Ready. Every row read "Queued" until
  then, with "Job posting closed" as gray text under it.
- **The Resume cell is a button** (a bordered pill with a pencil): it
  opens the row's resume picker (`auto-apply/resume-dialog.tsx`), the
  Apply dialog's own resume list (`jobs/resume-picker.tsx`, Job posting
  page), opened on the row's resume. It links nowhere else: Tailor for
  This Job and Build a New Resume links under it went (KAN-360), since
  the job and Manage Resumes reach both. Use This Resume calls `chooseResume`
  (`PUT .../applications/{job_id}/resume`), which the API keeps as a sent
  resume the application names; the run's resume step then sends that
  resume, from its current content. The cell shows that pick
  (`sent_resume`), else the run's rule, `pick_resume`, worked out in
  `auto-apply/page.tsx` (`ruleFor`): the built resume tailored to that job
  posting, else the default, else none. Keep `ruleFor` in step with
  `pick_resume`. **Still open: the extension does not ask the API which
  resume to attach**: it attaches the default resume itself
  (`resolveResumeFile`, `autofiller_extension/src/background/api.js`), so
  a pick reaches the form only once the extension calls `POST
  .../applications/{job_id}/resume` for the job it fills.
- **Add Jobs**, at Up Next's right, opens the seeker's saved jobs in a
  dialog (`auto-apply/add-jobs-dialog.tsx`). **The one place a seeker
  queues several jobs at once**: the Jobs page and Home keep one
  click per job, and the Applications Tracker is the record. A row's
  checkbox, or a click on the row but its title, picks it; Select All picks
  every job auto apply can fill. One it can't fill (not Greenhouse, for
  now) can't be picked and says why. "Add N to Queue" queues each pick
  through `queueJob` in the list's order, asks the extension to open the
  oldest queued job, toasts how many went in, and redraws the page. There
  is no "auto apply all saved jobs": the seeker picks each one. It was a
  Ready to Queue section under Up Next, which the user found redundant
  beside the saved jobs, and before that the Tracker's Saved view.
- **History is archived for now** (its code kept, `auto-apply/live-activity.tsx`
  and the table's "history" variant): an applied job is on the
  Applications Tracker already, so the table only repeated it, and a
  skipped one needs nothing. **Needs-you jobs moved into Up Next**
  (Couldn't Finish, "Finish it on the job's page"): they wait on the
  seeker, and the Tracker doesn't list them. `auto-apply/page.tsx` says how
  to bring History back.

**Up Next is live: the seeker's applications from the API**
(`auto-apply/applications.ts`, `GET /applicants/{id}/applications`, with
`scored=true` for the Match column, as the Applications page reads it). By
default in queue order: the oldest queued first, the job the extension
opens next, and a newly queued one at the bottom (asked for 2026-10-17).
The API answers newest first and the page reverses it, so the API's order
stays as other callers know it. Each stored stage is a row (`activityOf` in
`auto-apply/activity-list.tsx`): queued Queued, needs_you Couldn't Finish,
skipped Skipped, applied Applied. A queued job open in one of the
extension's batch tabs reads Working in Browser instead (`auto-apply/live-activity.tsx`, the
one client step over the server's rows), in flight.

- **The table**: Role (the company's logo, then the role, bold, over the
  company; frozen at the left from 672px of page up, as on Applications),
  Status, Match (the Applications page's `MatchBadge`, a faint dash without
  one, "Not scored" for a screen reader only: the words in every row were
  noise), Date Added (when it was queued or marked applied), Date Applied
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
- **Each row's actions are one ⋯ menu** (KAN-424, `auto-apply/row-menu.tsx`),
  in the narrow Actions column, worded: **Go to Its Tab** (the row open in
  a batch tab, `showRunTab`), **I Already Applied** (every row not applied
  or skipped: an application the student sent that the extension's submit
  detection missed; `markSubmitted`, POST `.../applications/{job_id}/finish`,
  dated now, then a refresh and the toast "<role> is marked Applied.") and
  **Remove From Queue** (a queued row only, last and in the danger colour:
  it takes the job out of the queue and refreshes; the toast "<role> from
  <company> is removed from Auto Apply." has Undo, which queues it again,
  at the bottom, since the queue orders by when a job was queued). A
  failure of any of them is a toast. Until KAN-424 these were bare icon
  buttons side by side, a briefcase for "I submitted this" and a cross for
  Remove: no one could read them at 16px, the cross looked like a chevron,
  and the destructive one sat one slip from the other. A row takes one
  action at a time (a ref set on the click): `disabled={pending}` lands a
  render late, so a fast double click once sent two removals and showed
  the removal toast twice.
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

**The Calendar is back** (KAN-413): it was hidden from KAN-261 (the proxy
sent `/calendar` to Home) while the tracker stored no dated
events. Events added on an application's page fill it now; its sidebar row
is restored after the Applications Tracker. The Applications panel's Show
on Calendar button is still gone, since an application opens its own page
now; a link to the Calendar from that page is not built.

**The Calendar** (`(seeker)/calendar/`) shows every application's dates
(KAN-429): the student's own **Apply By** for a job not applied to yet
(`job_applications.apply_by`, set under Your Application on its page), the
posting's **Closes** date where it publishes one (`closes_at`: company
jobs; most scraped postings have none), **Applied**, and the tracker's
events, **Assessment** (its own kind now, not folded into a deadline),
**Interview**, **Offer**, **Rejection** and **Follow-Up**. Apply By and
Closes stop showing once the job is applied to. Saved dates are left out
on purpose: a student who saves 40 jobs would get 40 entries. Each kind
wears its stage's colour and its own glyph (`KIND_STAGE` and `KIND_ICON`
in `stage-colors.ts`, which Home's Up Next, the timeline and Interviews &
Dates draw with too). `?view=` picks
Month, Week or Agenda (two weeks), `?date=` anchors it on a bare day, and
`?app=` opens the application in a detail panel (`applications/detail-panel.tsx`,
now the Calendar's alone), with a way across to its own page.
Without `?date=` it opens on the viewer's today, which the server cannot
know, so the views render in the browser behind a placeholder
(`calendar-view.tsx`, `useHydrated`). They read the view and the day from
the page's query themselves (`useCalendarQuery` in `view-switch.tsx`), and
the view switch, the arrows, Today and a day's number move it in place.

**Create Event** (KAN-429, `applications/create-event.tsx`) is the
toolbar's last control, the page's one filled button, as Google Calendar's
Create: the same dialog as an application's Interviews & Dates, with an
Application to choose first, opening on
today when today is on screen, else the span's first day. **It is wide,
not tall**, as Google Calendar's editor: 672px (`sm:max-w-2xl`), the
title first, Application (picked in Choose Application, the Tracker's rows
from `applications/pick-application.tsx`, as a step of this same dialog:
from the Calendar it opens on that step, a pick goes to the form, Change
comes back with a Back arrow, and the form keeps what was typed; never a
dropdown, never a dialog over this one) beside Type
(each kind in its glyph and colour), Date (WorkIt's calendar), Start and
End (quarter hours, the End list naming each length, an hour after the
start until picked) on one row, All Day under them, then the link and a
two-line note, about 600px in all; no control is the browser's own
(`docs/design.md`, Components); it scrolls inside
itself on a shorter window. In the stock 384px dialog, one field a row
ran past the foot of a 900px window. Until then the
only way in was an application's page, so a student on the Calendar could
not add to it or tell where its entries came from. The card's second line
says who made an event ("Added by you", "From an email"), and its note
sits under "Your Note" or "From the Email", never as a bare grey box.

**What the Calendar holds, by where it comes from** (KAN-429):

- The tracker's own dates: Applied (the day it went in), Apply By (the
  student's own date) and Application Closes (the posting's), the last
  two only while the job is not applied to. Always all day.
- Events the student adds on an application's page: an interview, an
  assessment, an offer, a rejection or a follow-up, each at a time (with
  an optional end) or on a day, with an optional note and meeting link.
- Emails filed onto an application (`source` gmail). **Only the ones that
  name a date or an outcome show**: an interview or an assessment at the
  time it names, and an offer or a rejection all day on the day it came.
  A confirmation or an update (`emailKind` confirmation or other) is a
  record, not a date, so it stays on the application's timeline and off
  the Calendar (`onCalendar` in `entries.ts`): it sat on the grid at the
  minute it arrived, as if it were a meeting, beside the Applied entry it
  repeats.

**An entry opens its own card, not the timeline** (`event-card.tsx`), as
Google Calendar's event card, **in one layout for every kind**: the glyph
and the title; a line saying what it is (the kind, "· From an email" for
an email, and for the tracker's own dates what the date means: "Application
sent", "Your own day to apply by", "The posting stops taking
applications", since "Applied" and a day alone said nothing); then When
(a range, a closing cut-off or All Day, and for Apply By and Closes how
far off, "In 3 days"), Application, Resume (the one an Applied entry went
out with), Meeting and the note, each only where the entry has it; then
View Application, a real link to `?app=` since the panel is drawn on the
server. A note longer than about six lines scrolls in its own box. Each
entry opened the panel straight away until then, so a bare closing day
and an interview with a note showed the same timeline.

**The card sits beside its entry and never leaves the window**: to the
right, or the left where the right has no room, its top level with the
entry's, moved up only as far as it must (`align: "shift"`), at least 16px
from the window's edge, and no taller than the window (it scrolls inside
then). base-ui's default flips the alignment instead, so a tall card that
did not fit below ended level with the entry's foot, well above it, and
its default boundary is the grid's scroll box, not the window. Checked on
2026-10-28 by opening every entry at 1024 × 768, 1440 × 640 and a 375px
phone: none left the window.

**The page is the screen under the bar and never scrolls** (KAN-429), as
Google Calendar's is: `h-[calc(100svh-4rem)]`, no visible heading (an
`sr-only` one; the toolbar's span title says where you are), the toolbar on
top and the view taking every pixel under it. A window under 32rem tall
lets the page scroll rather than crush the grid.

The layout (KAN-429), after Google Calendar: **one toolbar**, the span's
title at the left, then the **Type** filter (a `FieldFacet` dropdown, as on
every page with filters: each kind in its glyph and colour with how many
fall in the span on screen, a cross to clear it; this visit's own state),
Today, the arrows and **Week / Month / Agenda**, which wrap apart on a
phone; then the view, the full width of the page. An Upcoming list beside
it (the next two weeks of what was due) was tried and taken out: the grid
itself says what is next, and it narrowed the week.

- **No Day view** (dropped after a draft, KAN-429): a search's entries are
  points in a week, not a day's schedule, so one day's grid was mostly empty
  hours. An old `?view=day` opens the default view.
- **Week is a time grid** (`time-grid.tsx`): a header of days, an
  **all-day row** for what has no time of its own (folded to two a day and
  "+N more", with one toggle under All Day that opens the whole row, as
  Google's does: five all-day entries on one day pushed the morning off the
  grid),
  and 24 hours at 48px an hour that scroll inside the box, which fills the
  page's height (the header and all-day row stay put), and open at 8 AM,
  or an hour before the day's first event. A timed event is a block from
  `at` to `endsAt` (`application_events.ends_at`, Create Event's End field), an
  hour long without one, in its kind's tint with its stage's bar;
  overlapping events sit side by side (`layout`). A red line marks now on
  today's column. They were a list a day with no hours, which hid when
  things were.
- **What is timed** is one rule, `isTimed` in `entries.ts`: an entry with a
  time of its own, except Applied (its instant is only when the button was
  clicked), Apply By (a day) and Closes (a deadline, not an appointment),
  which go in the all-day row, Closes with its cut-off in its label.
- **Month is one ruled table**: white days on hairlines (1px gaps over
  `--color-border-subtle`), weekday names in a grey band, other months' days
  grey with faint numbers, today's number in a brand disc. As Google draws
  it, an all-day entry is a filled bar in its stage tint with its kind's
  glyph, and a timed one a dot in its colour with its time and the company,
  unfilled. **The weeks share the page's height** (`gridTemplateRows`, five
  or six rows), so a day shows as many entries as its row has room for
  (`useFit`, from the grid's measured height) and folds the rest into "+N
  more"; a short window shows fewer a day, never a scrollbar. A date or "+N
  more" opens the week that holds it. Rows were 112px at least, so a month ran past the
  fold.
- **Agenda** scrolls inside the page's height too.
- **The sample week** (`demo.ts`): `/calendar?demo=1`, in local
  development only, adds a spread of made-up entries to the current week
  (overlaps, a chain of three, a 15-minute call, a 90-minute interview, a
  7 AM start, a stacked all-day day, every kind, a few with a note or a
  meeting link, a rejection filed from an email with a long note), each on a real application so its card's View
  Application opens a real panel. Nothing is written, every
  Calendar link keeps the switch, and production ignores it. Use it to
  judge a layout change against a busy week.
- It replaced a wall of separate grey rounded tiles, lavender company-only
  chips, a key of tiny dots under the grid, and a view switch in the page's
  header.

A
link into the Calendar from anywhere else goes through `DayLink` in
`(seeker)/local-time.tsx`, which picks the viewer's local day the way
`<When>` picks their words.

## My Profile

**My Profile holds the photo and the identity fields**, the Application
Questions, and a "Resumes & Experiences" section that links to both views of
that page. The photo, name and headline are shown here and edited in
Settings' Personal Details (KAN-326): the identity band's Edit is a link
there.

**Application Answers (KAN-369)** is an open section under Application
Questions, edited the same way (Edit at the top right; Cancel and Save under
the fields; Escape cancels; Save sends only what changed). Its groups:
Availability (on-site, full time), Start Window (earliest start, latest end,
the next six terms as chips), Relocation (willing, places ranked best first
as numbered chips, where they'll live), Address (street and ZIP; city and
state are the profile's location), Languages (English shown as a suggestion
until saved), Age and Pay (18 or older; expected dollars an hour, typed by
the student and never guessed; whether a posted range is fine), More About
You (kinds of work as chips; an X profile; the countries they are a citizen
of), Communities (chips, with
None of These and I Don't Wish to Answer, each standing alone) and Screener
Facts, one card with Yes and No each and a None of
These Apply button that answers only the unanswered ones; a Yes on a list
question asks which companies. School Year (class year, back to school after
the internship) is worked out from the latest education entry's end month
(`lib/school-year.ts`) and only shown, with "From your education: ...". The
same controls are `components/answer-fields.tsx`, shared with onboarding.
Application Questions also lists the EEO extras (sexual orientation,
transgender, pronouns), each with a decline answer; onboarding skips them
with the other self-identification, and the extension never asks them.

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
- **These fields are edited here only**, and the photo, name and headline
  in Settings only, so no value has two editors. The identity band's Edit
  opened a Full Name and Headline dialog, and a pencil on the photo changed
  it, until KAN-326 moved both to Settings' Personal Details. (The resume
  editor's header still writes the name, phone and links back.)
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
Links and Resumes & Experiences: the nine questions most applications ask
(work authorization, sponsorship, citizenship and visa status, clearance,
which onboarding's Profile step asks, and the voluntary gender, Hispanic or
Latino, race, veteran and disability self-identification, which the
extension asks on the first form that does, KAN-387), with the seeker's
answers (`(seeker)/profile/application-questions.tsx`).

- **U.S. Citizen as the citizenship answer puts "U.S. Citizen" on every
  resume header** (PDF, Word and LaTeX), first on the contact line.
  A separate check box for it in Contact & Links was built and removed
  on 2026-10-21: it asked the same question twice.
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

**Writing Samples (KAN-384, KAN-387)** is an open section after
Application Questions (`(seeker)/profile/writing-samples.tsx`): up to three
pieces of the student's own writing (a class essay, a cover letter), from
which their own Claude builds a style card through the connector, so the
answers it writes read the way they write. Optional; WorkIt's own AI never
reads them.

- **Asked for once, after the first written batch.** The extension's panel
  asks, with Add Samples and Skip, once the first batch's answers from the
  student's Claude have all landed, and only when the student has none;
  Add Samples opens `/profile#writing-samples`, which opens Add at once.
- **Add, in place.** Add (the section's action, gone at three) opens a text
  box with Cancel and Save; Escape cancels. The API refuses an empty one or
  one over 10,000 characters, with its reason under the box.
- **Each sample is its first three lines, with Remove.** A sample is
  replaced by removing it and adding the new one: changing a sample drops
  the style card either way, and Claude builds a new one next time.

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
return visit renders it at once and refetches in the background, through one
server action (`getProfilePage`), since Next runs server actions one at a time
(KAN-368). Only
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
are one page's views, not two consumers), laid out as Home's is: the view's own title and line on the left ("Resumes",
"Experiences"), and at the top right, level with the foot of that block, a
segmented switcher between the two views, then on Experiences its
primary action, Fill With Scout; on a narrow page the controls
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
the Showing card (the picked resume, drawn as the Resumes page draws one,
with Change Resume in it; a click on it opens the resume), the section
nav, then the section cards and Skills. An entry's editor names the other
built resumes a save changes too (KAN-363); a name in it shows that resume
here.
The section nav (KAN-349) is a row of links, one per card with its count
under the current pick, held at the top of the page while the cards scroll
under it: a click glides to that card, and the card in view is lit, so a
long bank is one click from end to end. The page is the filled-out bank itself.
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
and each card's + already say where to start, and the card only
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
  beside the control and leaves the screen as it was. A skill's × is the
  one exception (KAN-388): the skill leaves at once, and a failed delete
  puts it back with the message under the card.
- **One card per section**, in the fixed order (Education, Experience,
  Projects, Leadership & Activities, Awards, Certifications), then Skills.
  Entries come back from the API ongoing first, then newest; the screen
  never sorts. After every change it reads the whole bank again, so the
  order shown is always the API's; a skill's × only drops that skill,
  which changes no order.
- **A card's heading is a + and a pencil** (KAN-363), as LinkedIn's
  profile draws them: the + adds an entry (a skill on Skills), on every
  card; the pencil, shown while the card lists something, opens that
  card's edit mode, one card at a time. In edit mode each entry shows its
  pencil (each skill its pencil and ×), and the heading's pencil gives way
  to Clear All and Done. Outside it a card is its content alone. Each
  heading held Clear All and Add as words, and every entry a pencil and a
  trash, so a card read as a row of controls before what it holds.
- **Clear All empties a card** (KAN-352): in the card's edit mode, on each
  section card and on Skills. It deletes
  what the card shows in one call (`POST .../bank/entries/delete` or
  `.../skills/delete`, all or none), after a confirm (`bank/clear-all.tsx`)
  that names the count and the built resumes that show them
  (`builtShowing` in `holdings.ts`, from the bank's `resume_ids`). It
  deletes from the whole bank, as Delete Entry does: under a built
  resume's pick the items belong to uploads (ADR 0005), so the confirm
  names the uploads that lose them too (`uploadsOwning`). It never deletes
  what the pick hides: a button on a card acts on what the card shows.
- **An entry's row holds its dates, and its pencil in edit mode**
  (KAN-363). Delete Entry sits at the foot of the editor the pencil opens
  (`entry-editor.tsx`'s `onDelete`). A trash beside the pencil, under a
  heading with Clear All and Add, put four controls in one corner, and a
  student could not tell which acted on the section and which on the
  entry.
- **An entry's dates sit under its title below `@xl/main`**, beside the
  pencil above it. Beside them on a phone, the dates never
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
  (story 18): the editor's Delete Entry reads `GET .../entries/{id}/resumes` first,
  then asks. A resume that hides the entry is not counted.
- **Bullets show their original wording only** (KAN-218). Wording typed on
  a resume in the editor is that resume's local variant and never shows
  here (`docs/resume.md`).
- **Import Your Resume** (`import-card.tsx`, KAN-240) opens inside intake,
  from the resume question's answers in the chat (the first stage for an
  empty bank, Scout's second line otherwise), offered until the student
  imports once. It says what went into the bank (`lib/import-summary.ts`)
  and holds Continue (Read It With AI sat beside it until KAN-353).
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
- **The entry editor has no skills field.** KAN-216's "Skills Used Here"
  toggles (skill links) were removed: a skill is one list per student,
  edited on the Skills card only.
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

The design is `../../docs/tailor_resume.md`: one click tailors and saves,
with no proposals to accept and no Done (2026-10-25).

- **Opened from "Tailor My Resume"** on the job posting page, which reads
  "Your Tailored Resume" once the student has one for that posting.
- **Each pick step has its own title and line** (`HEADINGS` in
  `tailor-screen.tsx`, drawn by `TailorHeader`): "Pick the Resume to Start
  From" (WorkIt saves a tailored copy and leaves the pick as it is), and
  "Add the Keywords You Have Used" (Tailor Resume then rewrites the
  bullets, never adds a number or tool, and can be undone; the keyword
  card's own note says what a picked keyword means). Both read "Tailor
  Your Resume to <job title>" over one line about the whole flow until
  2026-10-26.
- **Every step names its job in one line under its title**
  (`TailorJobLine`), the review's resume name included: the employer's
  small logo, then "Title · Company", a link to the job posting's page.
  Step 2's keywords and step 3's changes are read against that job, and
  the resume's name, which the student can rename, is no stand-in. The
  pick steps showed a job card until 2026-10-26, with the posting's
  location, pay, type and level, which help neither pick, and the review
  showed none. The intro sat
  inside the picker card until 2026-10-26, as the card's heading and a
  paragraph; the user wanted the card to hold the list alone.
- **The review step's header is one slim row** (`TailorReviewBar`,
  2026-10-26), so the resume starts near the top: Back (`TailorBack`, to
  Choose Keywords on the run's source, `?step=keywords&source=`),
  "Review Changes · Step 3 of 3" on one line in the middle, and
  Finish (filled, to the job posting's page) at the right. The page's h1, "Tailor for
  <title> at <company>", is for screen readers only. Under it the
  resume's name leads, renamed in place (`ResumeTitle`, below). The step
  had the pick steps' Back, the resume's name as a big title, a line, the
  job card and the timeline, about 300px over the resume, which the user
  found overwhelming (Quinncia's slim bar was the model); then the
  employer's logo and "Title · Company" beside Back, which crowded it and
  repeated what the tailored resume's name already says.
- **One step at a time** (2026-10-26), each under the same top row in the
  brand tint (`TailorBar`): Back, the step on one line ("Pick a Resume ·
  Step 1 of 3"), and the step's way on, Use This Resume, Tailor Resume or
  Finish. Then the step's title, its job line and its line
  (`TailorHeader`), then the step's own view (`TailorScreen` keeps the step in state; a
  reload starts at the pick). The keyword match appeared under the picker
  on one page before, so the student scrolled past the list to read it.
  Pick a Resume shows the list across the full width, and each card's
  Preview opens that resume in a dialog (below). The top row replaced a
  step timeline (`TailorSteps`, circles and lines), the pick steps' Back
  above the title, and Use This Resume, Back and Tailor Resume at each
  card's foot. Back never loses a pick:
  the same resume picked again keeps its match and its picked keywords,
  with no second read. Review Changes is the tailored resume's own page.
  The run was a fourth step, Tailor, until later the same day; it only
  waited, so the user had it folded into a loader (below).
- **A posting has one tailored resume, and a new run replaces it.** The
  posting's Tailor page opens its review once it has one. The review's
  Back opens Choose Keywords on the run's source (`?step=keywords&source=`;
  `?step=pick` for Pick a Resume), where a line above Tailor Resume says
  the run replaces the tailored resume; the run keeps its id, name and
  star. The posting's own tailored resume is never the first pick and
  cannot be a source (422). It was tailored once, a second run refused
  with a 409, until 2026-10-26.
- **The screen picks through the shared resume list** (KAN-318, KAN-406):
  `ResumeLists` from `jobs/resume-picker.tsx`, as every resume dialog
  does, with its search, Type filter and Upload Resume (the same limit,
  replace step and duplicate rule) and the Uploaded, Generated and
  Tailored groups. A dropdown and a dropzone under it stood here first;
  the dropzone took more room than the list. It starts on the resume
  tailored to this job, else the primary unless that is tailored to
  another job, else the first resume not tailored to any (`tailorFirst`):
  tailoring another job's tailored resume starts from that job's changes.
  Use This Resume moves to Choose Keywords and reads the resume's keyword
  match (`matchTailor`); while it reads, the Keyword Match card's place
  says what WorkIt is doing, over the card's shape (`MatchWaiting`), not
  made-up stages: the read is one call with none to report. A failed
  read returns to the pick with its error on the card. An upload is read into the bank and
  tailored as its own entries; a run changes only what the picked resume
  shows.
- **Each card has a Preview button** (an eye, labelled "Preview <name>",
  `onPreview` on `ResumeLists`), which opens the resume in a dialog
  (`ResumePreviewDialog`, `resume-preview.tsx`) without moving the pick.
  The other resume dialogs pass no `onPreview` and show no eye; the
  Resumes page's built resume rows open the same dialog (KAN-358). A preview
  sat in a column beside the list until 2026-10-26; the list needed the
  width, and a dialog gives the page room to read. The dialog takes a
  name and a `TailorSource`, so the review step opens it too, for View
  Original. A built resume's PDF is rendered (as it is now) and an
  upload's PDF is read, then drawn page by page with the editor's
  `PdfPages`, read-only, with no click targets. A DOCX upload gets a
  note and Download, as its own page does: pdf.js cannot draw one. The
  PDF comes from `GET /api/resume-preview?built=<id>` or
  `?uploaded=<id>`, a route handler, not a server action: Next runs a
  client's actions one at a time, so each render would hold back Use
  This Resume. Each answer is kept by its resume while the dialog stays
  mounted, so a late answer for another resume never shows and a resume
  opened again shows at once. The page's skeleton shows while it loads,
  and a failure says so in one line with Try Again.
- **The keyword match is one calm card** (`KeywordCard`, 2026-10-26):
  "3 of 14 keywords matched" over a bar of the same share, the matched
  keywords as quiet tags, then Add Missing Keywords: the missing ones as
  toggle chips (+ when off, a check when on), Required then Preferred,
  each under its own label (`MissingKeywords`, KAN-408), with a count
  ("4 of 11 selected"). The student picks those they have used, to add
  as skills. A short note says a picked one goes into the resume's skills
  and may be named in its bullets, since picking it lets the truth rule
  pass it. Select All is a small secondary button and asks first on a
  tinted line ("Select all 11? Only if you have used every one."); Clear
  shows beside it once anything is picked. Back and Tailor Resume sit at
  the card's foot. The user found the card before overloaded: a big
  "12 of 18", required matched keywords in brand, a checkbox drawn in
  every chip, and Add All as a text link that turned into Clear All. A
  keyword not picked is never written in. A posting with no description
  shows the "weak match" notice.
- **Tailor Resume runs once** under a loader in the middle of the window
  (`TailorRunning`, a modal over Choose Keywords that Esc and a click
  outside do not close, since a run cannot be stopped): a spinner, the
  resume's name and the keyword count, and the run's phases as they
  stream (Retrieving Info, Asking AI, Generating Resume, Compiling
  Resume), the done ones checked. A failed run closes it and shows its
  error on the card. It saves the posting's tailored resume, then opens
  it in the editor on this route (`?resumeId=`). The run's record of
  changes and its dropped count go to sessionStorage (`tailorEditsKey` in
  `lib/local-drafts.ts`, cleared by Sign Out) for the editor's review
  (Resume editor, below), with the keyword match before and after
  (`MatchShift`). Like the marks, it lives in that tab only.
- **The review is one resume with a Suggestions panel**
  (`tailor-suggestions.tsx`, `../../docs/tailor_resume.md`,
  "Suggestions"), kept quiet after Quinncia's resume review: the
  resume's name over the page (`ResumeTitle`: plain text that shows a
  faint outline and a pencil when pointed at, and a click makes it a field
  in the same box; Enter or a click away saves, Esc cancels), the
  editor's slim toolbar over the page with the panel level beside it, and
  "Suggestions" with its count in a
  filled pill over a 360px panel in the brand tint (the editor's bar's
  colour) of white sections that sticks beside the page, its top fixed
  and its sections scrolling under it. The
  resume's name row holds the view switch at its right, Resume Only (the
  page alone at full width), Suggestions (with its count) or Original,
  which sets the source resume beside the tailored one at one width in
  place of the panel, under a toolbar-like bar with a Read Only tag. The
  top row sits in the brand tint, rounded. The toolbar holds only tools
  for the page: at the left Undo and Redo (UI only for now, disabled)
  and, idle, the page count when over one page as an amber chip with a
  warning sign and a caret (its click offers Fit to One Page); at the
  right Download, secondary. No "Not on This Resume" on this page
  (the editor's own page keeps it); while a line is open, its moves, Hide and its choices with "Esc
  when done"; no Ask Scout and no Done. Each changed line has a small
  purple dot in the page's margin and is highlighted (its tint, a 1px dark
  border, rounded, after Quinncia) only while its suggestion is pointed
  at or open; a dot or a changed line opens it. The panel's top holds a
  type filter in the heading row (a dropdown of All Types
  and each change type, each with its coloured badge, added green,
  reworded blue, removed red, moved amber, and its count); under it one white section per resume entry, top to bottom
  as on the page, each heading with the entry's title, organization,
  count and a caret, and each suggestion a row with its type's badge and
  a green ✓ and a red ✕, always open over its change (only sections
  fold): a white outlined card with one row per thing that changed (each
  moved bullet with an amber "3 → 1" tag), and under the
  list Reject All and Accept All. Pointing at a row highlights its lines;
  only a click on its name scrolls the page to them. On a phone the panel is a sheet opened by
  "Suggestions (n)". With no record (a new tab or device) the editor
  shows alone, with a line saying the suggestions live in the tab that ran
  Tailor. A before and after side by side came first (2026-10-26) and was
  replaced the same day: two full resumes and hover Revert controls showed
  too much at once; then a panel of open cards over fully tinted lines,
  which gave everything the same weight; then a grey panel under quiet
  small-capitals labels ("RESUME · <name>", "SUGGESTIONS · n"), which the
  user found muted; then numbered cards and dots, which read as an order
  to follow, and a panel that folded to a rail, which looked dated.
- An empty bank (409) shows a link to the bank page, where intake starts.

## Resumes (`/resumes`)

`(seeker)/resumes` (KAN-249), the other view of Resumes & Experiences: the
resumes the bank makes and the uploads, under the shared header. **One
list holds every resume** (KAN-362, `built-resumes.tsx`), laid out as the
Applications Tracker is: the search (names and postings) on its own row,
then the **Type** filter (Uploaded, Generated, Tailored; the Applications
list's dropdown, `FieldFacet`) and the **Sort** dropdown with Upload
Resume and Generate Resume at the right, then the list (below). Sort
(KAN-366) is one pick of three: Last Edited, newest first and the
default; Oldest First; Name (A to Z). An upload dates from its upload, a
built resume from its last edit. It is drawn as the Type filter is, but
never takes the filter's brand tint, since an order is always in force;
it is a dropdown, not the Jobs page's Sort By pills, because the header
already holds the Resumes or Experiences pills. Each resume is its card, with its own
line saying what it is ("Uploaded Oct 21", "Last edited Oct 21 · For
<posting>") and its star, Rename, Download and Delete. With no resume at
all the list's place holds "No Resumes Yet"; filters that hide every
card show "No Matching Resumes" with Clear Filters (`EmptyState`, as the
Applications page's). The type and the order are the URL's (`?type=uploaded,tailored`,
`?sort=oldest` or `name`; Last Edited has none), moved in place and
replacing the entry, so a reload or a shared link keeps them and a tick
is not a step of Back; Clear Filters keeps the order; the search's words are the
page's own. A Generate clears a Type filter that would hide its new
resume. It took six shapes in KAN-362: three cards stacked one under
another (Your Uploaded Resumes, Generated Resumes, Tailored Resumes),
which a student with many resumes scrolled past; one card behind a pill
switcher, under the header's own; underline tabs with counts; and the
two tables under The list. The views split one list in three though
every card acts alike once Import Updated Resume left the upload's card,
and a student looking for their latest resume looked in three places.
Generate Resume sat in the header, on every view though only generated
resumes come from it, and the upload dropzone sat in a track beside the
uploads. The resume picker dialogs draw this same grouped list
(KAN-406, Job posting page). They sat in one "Your Resumes" card at the foot of the bank page
until KAN-249; the spec's "the resumes page" now means this view. The
editor lives under it (`/resumes/[resumeId]`), so the sidebar keeps the row
lit there and the phone editor's back arrow lands here. The page needs
the built list and the uploaded list: if either fails it
shows "Your Resumes Aren't Loading Right Now" and a Try Again link.

- **Uploaded** (Upload Resume and the upload's row are
  `upload-resume.tsx`; the Your Uploaded Resumes card until KAN-362,
  "Your Resumes" until KAN-268). Only uploads count toward the API's
  limit of 5 (generated resumes counted until KAN-268): an upload past it
  says so; an "n of 5" badge showed it until KAN-362. Upload Resume opens the
  file picker (PDF or DOCX, under 5 MB, the dropzone's checks through
  `resumeFileError` in `components/resume-upload.tsx`). The dropzone went
  in KAN-362, and with it drag and drop onto the page. It held
  base resumes alone until 2026-10-18, when My Profile's Resume card moved
  in; both kinds then shared it until KAN-268, and a student could not
  tell which resumes they had generated.
- **Generated**, the base resumes (KAN-207). It was "Base Resumes", saying
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
  <name>" with OK (`resumes/duplicate-resume-dialog.tsx`).
  Intake and onboarding uploads show the message as their error line. **The upload fills the experience bank** (ADR 0003): a
  note under the filter row says what went in ("Added 6 entries and 2 skills
  from resume.pdf", or "WorkIt couldn't find any entries in …") and links
  to Experiences. It offered Read It With AI until KAN-353. Before KAN-240 an upload showed nothing, and its facts
  reached the bank only if the student found the import inside intake;
  most never did. **A click anywhere on an upload's card opens its own
  page** (`src/components/resume-row.tsx`'s link, KAN-366; Uploaded
  resume page, below), as a generated resume's card opens the editor.
  Until KAN-366 it opened a short-lived signed Storage link in a new tab
  (a DOCX downloaded), and an eye button did that before KAN-268. The row's icons are a star that makes
  it primary (`setPrimaryResume`), **Rename** (the pencil, the same form as
  a generated resume's; `renameResume`, and the API keeps the file's
  extension on the name), **Download** (the stored file through
  `getResumeFileUrl(id, true)`, which makes even a PDF download; an upload
  keeps no sent resume, since its file never changes) and Delete, which
  asks first in the line under the row, as a base resume's does. **A newer
  version of a file is a delete and an upload.** The row had **Import
  Updated Resume** from 2026-10-18 until KAN-362, a dialog that swapped a
  newer file onto the same row (`replaceResume`) and replaced the upload's
  entries; KAN-362 took it off the row to keep the row to four icons. The bank ends
  the same: deleting an upload deletes its entries and skills, and the new
  upload brings its own (ADR 0005). Only the primary star does not carry
  over. The resume picker's replace at the 5-upload limit (Job posting
  page) still uses `replaceResume`. The `ResumeUpload` component
  (`src/components/resume-upload.tsx`) is a pure dropzone + file preview —
  it knows nothing about upload logic or limits.
- **The list** (`resumes/resume-list.tsx`) is one card that scrolls
  inside itself and runs down to the foot of the page, 24px above the
  window's bottom (`ResumeScroll`'s `fill`, KAN-434), never shorter than
  five cards under a group heading (`FIVE_ROWS`, 351px), so the search
  and the buttons stay in view however many resumes a student keeps. On
  a window too short for that the page scrolls too. It stopped at five
  cards until KAN-434, which left half a laptop screen empty under it;
  the resume pickers keep five cards, since they sit in a dialog. It is
  grouped by
  type, as Notion's Group by (KAN-404): **Uploaded**, **Generated**, then
  **Tailored**, each under a heading with its name in a pill (`Badge`,
  brand, alike for all three) and its count, which sticks to the card's
  top while its cards scroll and folds the group away on a click
  (`ResumeGroup`; the folded groups ride in `?collapsed=`, with the type
  and the order). The search, Type and Sort run over every row first; the
  order then runs inside each group, the starred resume leads its own,
  and a group with no row left hides. The list keeps one scroll, not one
  per group, and every resume in a group shows: a Show N More after the
  first 5, as Notion's load limit, was tried and dropped. Uploaded stays
  open while a file uploads, and a Generate opens Generated. Uploads are capped at 5 and
  Generate refuses a duplicate, but a student has one tailored resume per
  job posting with no cap, so ungrouped by Last Edited the tailored ones
  buried the uploads, and a student needed the Type filter to find their
  own file. A teammate asked for the three stacked cards back; groups in
  the one list kept the one search. A first version had two groups
  (Uploaded and Generated, then Tailored) named in grey capitals. Below a
  42rem row the filters are two even rows, Type and Sort over Upload
  Resume and Generate Resume, and below 24rem those say only Upload and
  Generate. Two table versions
  came first in KAN-362: one with Type and Last Edited columns and sort
  headings, then one with each row's icons in a `⋯` menu. The columns
  said what each card's line already says, and the menu hid the actions a
  student uses, so the cards came back.
- **Tailored** (KAN-258): each is made for one job posting with Tailor
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
  star, **Preview**, Rename, **Download PDF** and Delete. Preview (an eye,
  KAN-358) opens the resume read-only in Tailor's Preview dialog
  (`ResumePreviewDialog`, rendered as it is now), so a student can look at
  it without the editor. An upload's row has no eye: its card opens its
  own read-only page. **The whole card opens the resume editor**: the
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
- **Delete asks first**, on every resume, in a popover hung from the
  trash that opened it (KAN-347, `DeleteResumeConfirm` in
  `delete-confirm.tsx`): the question, then Delete Resume and Keep It, the
  bank entry's words and buttons. Escape or a click outside keeps the
  resume. It opened under the card until KAN-347, below the row's notes
  and away from the icon, and pushed the cards under it down. Both went at
  one click until KAN-258. Deleting a resume keeps the files already sent
  from it. The card
  leaves the list as Delete Resume is pressed (KAN-388); a failed delete
  brings it back, with the error above the list.
- **No Sent card since 2026-10-18.** It listed every file the student
  downloaded or applied with (KAN-208), to download again or delete. Sent
  resumes are still kept on every Apply (a download keeps nothing since
  KAN-267), and a job posting's page still says "You sent <name> on
  <date>"; no screen lists them all or deletes one now.

## Uploaded resume page (`/resumes/uploaded/[id]`)

KAN-366: an upload's own page, opened from its card on the Resumes view,
so every resume opens inside WorkIt (a built one opens the editor, next).
Back (to the page that opened it, such as Experiences, else `/resumes`;
`(seeker)/back-link.tsx`), the file's name as the heading, then a sticky bar in
the editor's look: "Uploaded Oct 21" and "★ Primary" on the primary, then
Make Primary (while it is not), Rename, Delete and **Download**, the
page's main action, filled. Under it the PDF, drawn page by page with the
editor's pdf.js preview (`PdfPages`, no click targets: an upload is read
here, its facts are edited in Experiences). The server reads the file
(`readUploadedResume`, which asks for the list and the file link together,
KAN-368), so the browser never opens the Storage link. A DOCX
cannot be drawn, so its place holds "This File Can't Be Shown Here" and
Download. Rename turns the heading into the cards' Rename form; Delete
asks in a popover under its button, as a card's trash does, and then
returns to the Resumes view.
An id the student has no upload by is a 404; a list or file that fails
to load shows "This Resume Isn't Loading Right Now" with Try Again. On a
phone the bar's buttons wrap and the pages take the width.

## Resume editor

`(seeker)/resumes/[resumeId]`, opened from a resume's card on the Resumes
view. KAN-209 proved the overlay; KAN-218 edits on it; KAN-219 adds the
phone layout; KAN-221 adds the assistant. The page loads the render, the bank, the resume's choices and
the profile (the header's fields), and shows the error state if any fails.
A **Back** button above the title returns to the page that opened the
editor (KAN-363, `(seeker)/back-link.tsx`), such as Experiences, else the
Resumes view (`[resumeId]/back.ts`), going back in history when that page
is the one before. It is drawn as the job posting page's Back is; until
KAN-258 the editor had no way back but the sidebar. The phone layout's
back arrow goes the same way. Back went to Resumes from everywhere, so a
student who opened a resume from Experiences landed on another view.

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
  covered the lines below. Its 1.5px ring (2px read too thick over the
  page's fine type) is the line's only outline while it is open: the
  line's own selected outline sat a few pixels off the field, and with the
  field's drop shadow it showed as extra lines under the ring, so both go
  while the field shows, as does a Tailor highlight's border. It opens with the caret where the press landed
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
  does a press outside the page, the bar and the assistant (in Scout's
  panel), which carry `data-keeps-selection` (the assistant acts on the selected line).
  The phone editor keeps its own sheet: Enter there only saves.
- **The title row** (`ResumeTitle`, `[resumeId]/resume-title.tsx`) holds
  the resume's name, renamed in place as on Tailor's review: plain text
  that shows a faint outline and a pencil when pointed at, and a click
  makes it a field in the same box; Enter or a click away saves
  (`renameBuiltResume`), Esc cancels. It is the page's h1 here and an h2
  on the review, under its step's sr-only h1. It spans the page and the
  column beside it, so the review's panel starts level with the bar.
  It was a plain h1 at heading size until KAN-411; a failed load still
  shows it over the error.
- **The sticky bar is the slim toolbar** (`SlimBar`), the same on this
  page and on Tailor's review (KAN-411), so a line's actions never cover
  nearby lines. It is a quiet white row (`--color-panel`). At its left,
  Undo and Redo, UI only: the editor keeps no history yet, so both stay
  disabled. With a line selected: the line's kind, Move Up and Move Down
  first (`LineActions`' `movesFirst`: entries within their section,
  bullets within their entry, one PATCH that renumbers the siblings),
  then Hide (Hide Entry), the bullet's wordings (Original, each Tailored
  version, This Resume's Wording) and, on Education, Show/Hide GPA and
  Coursework; at the right, "Esc when done" in place of a Done button,
  since Escape or a click off the page already saves and closes. A press
  on a bar button keeps focus in the field. With no line selected, only
  over one page, the page count as an amber chip with a warning sign and
  a caret ("⚠ 2 pages ⌄"), which reads as a problem to open; its popover
  says by how much (the render's `lines_over`, an estimate) and offers
  Fit to One Page. Then Undo Fit, which shows again everything Fit hid
  (the response's `undo` body), kept in sessionStorage per resume
  (`fit-undo.ts`), so a reload in the same tab still offers it. A
  one-page resume shows no count: a green "1 page" said what the page
  itself shows. No "Click a line to edit it." hint: the pointer's own
  highlight on a line says so. In both states the bar says "Saving…" or
  the last round trip ("Saved, 412 ms"), the measure for the Vercel
  preview check. Idle, **Download** (PDF, Word or LaTeX) ends the bar,
  secondary, so it stays in reach down a two-page resume
  (`../download-menu.tsx`, KAN-258; it was on each card of the Resumes
  view). It keeps nothing (KAN-267) and holds a PDF with characters the
  font lacks for Download Anyway; the warning and any error show under
  the bar. **No Ask Scout**: the top bar's Scout opens the assistant
  (below). Ask Scout ended this bar for a day, filled, and the user
  found two Scout buttons on one page one too many.
  **Until KAN-411 this page had its own full bar**, brand-tinted, with
  the hint first, the page count and Fit to One Page as one amber group
  (`fit-notice.tsx`'s `FitNotice`, now the phone's), a Done button, and
  Download and Ask Scout in both states, while Tailor's review had the
  slim one: a student saw two editor designs.
- **On Tailor's review step the editor takes a Suggestions panel**
  (`suggestions`, a render prop; `tailor-review.tsx`,
  `../../docs/tailor_resume.md`, "Suggestions"). Only then does the page
  carry the run's changes: a small purple dot in the margin beside each changed
  line (`dots` on `PdfPages`), and a see-through highlight, so the PDF's
  text shows, on the lines of the suggestion in focus or open: an added
  skill green (`positive`, bordered in `positive-ink`), a new wording blue
  (`advanced`), an entry's bullets in a new order amber (`warning-fill`,
  bordered in `warning-strong`). There the page has no "Not on This
  Resume" (a run's own removals have Reject), and the top bar's Scout
  stays the job search chat. The panel sits in the column beside the
  page; on a phone it is a sheet from the bottom bar. Reject goes through the choices PATCH
  (the wording back to the source's, the old order, the skill hidden),
  and any later edit of a changed item drops that change's mark. The
  run's record is in sessionStorage (`tailorEditsKey`, under
  `lib/local-drafts.ts`'s prefix, so Sign Out clears it): a reload in the
  same tab keeps it, and a new tab or device opens with none. `phoneBar`
  is a row the phone layout's header shows, for the page's own line,
  since that layout covers the page.
- **The phone layout keeps its own bars** (`phone.tsx`): its top and
  bottom bars take the brand tint and its Ask Scout buttons the brand's
  fill, and its sheets are white.
- **A toast says it first** (`fit-notice.tsx`, KAN-258): when the editor
  opens on a resume over one page, or an edit pushes one over, a toast at
  the bottom right (above the bottom bar on a phone) says by how much, with
  Fit to One Page and a cross. It closes on Fit, on the cross, once the
  resume fits, or after 10 seconds, since the bar's chip keeps the same
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
- **"Not on This Resume"** (`tray.tsx`) under the page (not on Tailor's
  review, where a run's own removals have Reject): entries the resume
  does not show (hidden, or added to the bank after Generate), hidden
  bullets of shown entries, and hidden skills. One click puts one back; an
  entry joins the end of its section with its bullets.
- Skills can be hidden but not moved: they print grouped, and a move
  inside a group is still open.
- A failed render shows "This Resume Isn't Loading Right Now" with the API's
  message and a Try Again link; a failed save shows the API's message above
  the page and keeps the last PDF.
- **The editor draws before its PDF compiles** (KAN-368). The page starts the
  LaTeX render without awaiting it; `editor.tsx` reads it with `use()` inside
  a `<Suspense>` around the page area only, over a Letter-sized skeleton with
  its own error state, so Back, the title and the bar do not wait on the
  compile. Line editing, the assistant and the tray stay off until it lands, and
  the phone's "Click a line" is not offered when the first render failed. pdf.js starts
  downloading as the editor mounts. The editor and an upload's page each have
  a `loading.tsx` in their own frame.
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
- **The assistant** (`assistant.tsx`, KAN-221) **opens from the top
  bar's Scout, in Scout's panel** (KAN-411): the editor takes the panel
  over (`ScoutTakeover`, as the Experience Bank does with intake), under
  "Scout · Edits this resume as you talk", so the page has one way to
  Scout. The panel's header and X close it. Until the first render lands
  the panel stays Scout's job chat, since the assistant reads the page
  count and acts through renders. Not on Tailor's review, whose Scout
  stays the job chat. Until KAN-411 it opened from Ask Scout in the
  sticky bar and docked beside the page (the KAN-195 prototype's variant
  E); with Ask Scout gone from the bar, the top bar's Scout opened only
  the job chat, which left desktop no way to the assistant, so the panel
  took it in. Its root is a div: the panel or the phone's sheet holds
  it, names it and draws its close button. On a phone, Ask Scout in the
  bottom bar or in a line's sheet opens it in its own sheet. It stays
  mounted while closed, so closing it keeps the chat; nothing is
  stored. The look is intake's (variant G:
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
  shorter waits for Use This; the phone sheet opens from both buttons; a
  click in the panel keeps the selected line.

## Scout panel

Scout, the job assistant, lives in `components/scout/`; its brain is the repo's
`scout/`, so read `scout/CLAUDE.md` first. `scout-store` holds the one chat per
tab (a module store, so no provider). `scout-panel` docks beside the page, never
over it, and opens only on a click (the Jobs page's Import Your Resume
counts: `/bank?import=1` opens it on arrival, then drops the param). A page
can take it over (`scout-takeover.tsx`: the Experience Bank's intake, the
resume editor's assistant): the
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

/onboarding/applicant is a five-step wizard (KAN-231), outside both shells:
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
(KAN-284); step 2 is Resume (KAN-275), read and confirmed before it is
saved (KAN-372); step 3, Profile, is the questions every application asks
(KAN-283, all optional), right after the resume (KAN-372); step 4,
Availability, asks on-site and full time, the earliest start and terms, and
the screener facts card, all optional with Skip (KAN-369; the rest of the
Application answers are on My Profile); step 5, Extension, and step 6,
Practice, add the WorkIt extension and run a practice batch (KAN-378). Start Date shows only once
Internship is picked, and unpicking Internship clears it: a saved season keeps
only the jobs that name one, which a new-grad role rarely does. Preference Tags, free-text skills, were dropped
(KAN-231): the feed has no filter for them.

**One step rail counts the whole journey (KAN-259).** The wizard heads its
fields with the shared `components/stepper.tsx` at `size="lg"`: Role,
Resume, Profile, Extension, Practice (`onboarding/applicant/steps.ts`; Availability, KAN-369, is Profile's second page on the rail;
Resume was last until KAN-372, Profile until KAN-378). It replaced a thin bar and
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
Work and Visa Sponsorship (yes or no), then Location and Links (KAN-372:
where the student lives, typed as forms ask it, "Stony Brook, NY", and
LinkedIn, GitHub and Portfolio or Website; `onboarding/applicant/contact-fields.tsx`),
then Citizenship and Visa Status and Security
Clearance, each under the question as forms word it. The options
are real forms' options (`lib/autofill-answers.ts`). One answer each, as dots; pressing a picked
answer again clears it. They are not filters: Finish saves them to the
answer bank (`PATCH /applicants/{id}/autofill-answers`, only the changed
ones), and the location and links to the profile (`PATCH
/applicants/{id}/profile`, only the changed ones; My Profile edits the same
fields), which auto apply fills forms from. A link that is no web address
is marked under its box and stops Finish before anything saves. The step was Pay & Visa until
KAN-283: pay moved to step 1, beside the job types that set its units, and
the visa filter question left onboarding. A visa filter saved before is
kept, and the Jobs page still sets it.

**The voluntary self-identification is not asked here (KAN-387).** Gender,
Hispanic or Latino, Race/Ethnicity, Veteran Status and Disability
(`SELF_ID_KEYS`) wait for the first form that asks one: the extension's panel
on that form asks them once, with the same options (gender's are the EEO
Male, Female and decline plus Non-Binary; Hispanic or Latino and
Race/Ethnicity are the EEO's own two questions, which every U.S. form keeps
apart; veteran status's three are the U.S. protected veteran
self-identification's, disability's three Form CC-305's words), saves them
to the same answer bank, and fills them on that form and every later one.
Asked at sign-up, they were five more questions before a student had seen a
single form; asked on the form, the student sees why. My Profile's
Application Questions still shows and edits all nine.

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

**The resume step (KAN-275)** is the dropzone the Resumes view had until KAN-362
(`components/resume-upload.tsx`), inside the wizard so it keeps Scout's
panel, the step rail and the footer's Back. Picking a file only holds it,
with a Remove; Read Resume is disabled until one is picked, and Skip is the
way on without one. **The student sees the reading before it is saved
(KAN-372, ADR 0006; `onboarding/applicant/resume-step.tsx`).** Read Resume
sends the file to `POST .../resumes/preview`, which saves nothing, and the
step shows what it found: each entry by section (title, organization and
dates, bullets), then the skills, each a tag with a × (Remove <name>,
KAN-369). A skill taken out goes with the upload as `removed_skills`: it is
not saved, and no later reading or Tailor adds it again. The skills shown
are only those the skills catalog knows. An entry an earlier upload already holds
carries Replaces Earlier Copy, and the note above counts them. Save Resume
uploads the same file with `?replace=matching`, so the earlier copies are
replaced, not doubled, then opens Profile; Choose Another File drops the
reading. A file already uploaded says so, and Next goes on. A file with
nothing read can still be saved. The resume saves at once, before onboarding
is done; coming back to the step shows "Saved …" over the dropzone. The
dropzone says "Reading…" only while the file is being read: it once took
the save's busy state too, so Skip read as if it had sent a file. It replaced intake
(KAN-214), whose chat asked about each section in turn, on its own page and
in another design: one upload fills most of the bank in one step, and intake
still runs on the Experiences view for what the resume missed.

**Profile's Next saves the answers.** The Profile step's go to the answer
bank first (`PATCH /applicants/{id}/autofill-answers`, only the changed ones,
KAN-283), then step 1's as the seeker's preferences (`PUT
/applicants/{id}/preferences`, KAN-231, which also marks onboarding
complete). The bank goes first because a finished seeker is never sent back
here, and only My Profile's Application Questions asks those questions
again. Step 1's fields are `role-step.tsx`, which Settings' Job Preferences
draws too, so the wizard and Settings ask the same questions.
Next then opens the Extension step (Finish opened /jobs until KAN-378), so
a seeker who leaves during the last two steps has a finished profile. A failed save or upload leaves the seeker on the step,
saying why in the API's words (a sixth upload's 409 among them), and a retry
saves the answers again harmlessly. Date Posted is not asked: a saved "past
24 hours" would empty the feed within days. Sign-in sends an applicant here
until they finish (`docs/auth.md`); a finished one who opens the page again
finds the wizard filled with their saved answers, and Profile's Next saves
the edits. `?step=2` opens the wizard on Profile (the second step until
KAN-372, now the third); intake's "Back to
Pay & Visa" linked there until KAN-275, and nothing does now. Without saved
answers `?step=2` opens on the first step, which holds the answers that must
be given.

**Step 4 adds the extension (KAN-378;
`onboarding/applicant/extension-step.tsx`).** Two lines, Add WorkIt to
Chrome and Pin It to the Toolbar, each turning done (a green check and an
Added or Pinned badge) as the page sees it: the page asks the extension
(`ping`, `lib/autofill-extension.ts`'s `extensionState`) every 1.5 seconds,
so no reload is needed. Add to Chrome opens
`NEXT_PUBLIC_EXTENSION_INSTALL_URL`, the Chrome Web Store listing once there
is one; unset, the line says to ask the WorkIt team for it. Chrome lets no
page pin an extension, so the pin line says how (the puzzle piece, then the
pin) and the extension reports whether it is pinned
(`chrome.action.getUserSettings`); a pin is asked for, not required. Next
waits for the extension; Skip opens /jobs.

**Step 5 is a practice batch (KAN-378;
`onboarding/applicant/practice-step.tsx`).** Start Practice asks the
extension to open WorkIt's two practice forms (`lib/practice-form.ts`,
served at `/practice/<company>/<job>/apply`) as a batch: the student sees
the tabs fill in the background and land in the Ready and Needs you tab
groups (one asks only facts, the other a written answer), checks each and
presses the form's own Submit. Each practice job's row shows where it is
(Waiting, Filling, Ready, Needs You, Submitted, Tab Closed), from the
extension's `practice/status` every second, with Show Tab while its tab is
open; the footer's main button is Show Next Tab (a Needs You tab first),
or Start Again once the tabs were closed. Once both are submitted the step
says You're Ready and Find Jobs opens /jobs in its Best Match order. A
first real batch then fills the factual fields only: a batch tab leaves the
written answers to the student until Claude is added. Skip Practice opens
/jobs.

**The practice forms look like a hiring system, not like WorkIt**
(`lib/practice-form.ts`, served by `app/practice/[company]/[job]/[page]/route.ts`).
Each is a whole HTML page, not a React page: a made-up company's initials
and posting over a plain form in the system font, laid out as Lever's
hosted form so the Fill engine's Lever Filler fills it. Its colours are
WorkIt's tokens copied by name into the page (it loads no app stylesheet;
change both together), and a band across the top says it is WorkIt's
practice form. **Its Submit sends nothing**: the form has no action, and
the page's own script opens the job's `/thanks` page with no data once the
browser's check of the required fields passes, which the extension counts
as the submit. The extension's end-to-end test serves the same module
(`autofiller_extension/test/practice.extension.spec.ts`), so keep it free
of imports.

## Connect Claude (`/connect/claude`, KAN-377)

The connector's consent page: Claude's sign-in to WorkIt opens it with
`?request=<id>` (`docs/auth.md`, "Claude's sign-in to WorkIt"). The auth
screens' card over the skyline, outside both shells. It names the client
("Claude wants to use your WorkIt account"), says in two lines what it may
do (read the next application's questions, posting and experience; save
answers that fill into open tabs), that it writes on the student's own
Claude plan and that WorkIt never submits, then **Allow** (primary) and
**Deny** (secondary). Either sends the browser back to Claude. A sign-in
that is over, or a company account, shows the API's message instead of the
buttons. Signed out, the page goes to `/login?next=...` first.

## Settings (`/settings`)

KAN-326. **Settings is always a modal** (KAN-364): five sections, each
with its own address, `/settings/<section>`; bare `/settings` opens
Personal Details. **From the account menu (the bar's photo) it opens over
the current page** (`(seeker)/@modal/(.)settings`, an intercepting route),
and closing goes back to that page. **A hard load or a reload of a
Settings address opens it over Home** (`(seeker)/settings/layout.tsx`
draws Home page under it), and closing goes to Home. A
full Settings page came first; the user asked for the modal on every way
in. Escape, the close button and a click outside all close. **The modal opens
before its sections have read** (KAN-368): Personal Details and Job
Preferences stream in their own `<Suspense>` over section-shaped skeletons,
so it no longer waits for the slowest of the profile, photo, preferences and
role option reads. There is no `loading.tsx` for the modal: one drew a second
modal and backdrop over the first.

**Every section is drawn when the modal opens and stays mounted**
(`settings/sections.tsx`), hidden when not shown, so switching is instant
and an unsaved edit in one section survives a visit to another. The nav
(`settings-nav.tsx`) switches in place and moves the address with
`history.replaceState`, which Next's router follows (`usePathname`): no
navigation, and one history entry for the whole modal, so one Back leaves
it. Each item is still a real link, so a modified click opens the section
in a new tab. Each section's `page.tsx` draws nothing; it is the address
and the tab title only. A section's content is its `section.tsx`, and a
section that needs the query reads it in the browser, since a layout gets
none (`security/notice.tsx`). The title and the nav stay fixed and only the
section scrolls. The nav is a column beside the section from sm and a row
that scrolls sideways above it on a phone, scrolling the current section
into view: a segmented control's equal widths do not fit "Sign-In &
Security" and three other labels at 375px. The section area is its own
`@container/main`, so the sections' container queries (the name fields'
three columns) read the modal's width. Each section is cards in a column.

**Unsaved edits are guarded** (`settings/unsaved-changes.tsx`): a form with
unsaved changes (Personal Details' names and headline, Job Preferences)
reports them, and closing the modal asks "Discard Your Changes?" (Keep
Editing, Discard Changes); closing the tab or reloading gets the browser's
own warning. Switching sections needs no question, since nothing unmounts.
A history Back is not caught: the browser gives a page no way to hold it.
The question is a dialog nested in the modal, which Base UI does not dim.
**Save and Discard sit in a bar pinned to the foot of what scrolls**, so
Job Preferences' Save is in view however far down the student is; at the
end of seven fields it sat below the fold. The modal's scroller carries no
padding of its own for the same reason: a sticky bar stops at the
scroller's padding edge, and with 24px there the fields showed through
under it.

**A setting most visits leave alone is a row with a button, and its form
opens in a dialog** (the user's call, 2026-10-23): three empty password
fields on the page read as something to fill in.

- **Personal Details** (`/settings/personal`): the photo (Change Photo,
  Remove Photo; it saves on pick, shows the file at once and rolls back if
  the upload fails), First Name, Middle Name (optional; signup no longer
  asks it, KAN-372) and Last Name, and Headline, with Save and Discard. Save sends only
  what changed; the API joins the parts into the full name every other
  screen prints (`backend/app/models/CLAUDE.md`, Names). These are edited
  here only; My Profile shows them and links here. Saving
  refreshes the route so the bar's name and photo follow.
- **Sign-In & Security** (`/settings/security`), three cards of rows, then
  Delete Account:
  Sign-In (Email with Change, Password with Change Password or, for a
  Google- or LinkedIn-only account, Set Password; each opens a dialog),
  Sign-In Methods (Google and LinkedIn, each Connected with Disconnect, or
  Connect; no Disconnect on the last method), and Sign Out, which does what
  the menu's does (local drafts first, then the session, on every device).
  The methods come from Supabase's identity list (`getSignInProviders` in
  `lib/session.ts`), so one linked a moment ago shows at once. Change Email
  sends a confirm link and says where to look; the change and a link both
  come back through the auth callback with a notice at the top
  (`?notice=email`, `email-pending`, `linked`). The rules and the
  dashboard setting Connect needs are in `../../docs/auth.md`, Settings.
  **Delete Account** sits at the foot in a red-edged card of its own, where
  students look for it (it sat under Personal Details until KAN-364): a
  red button opens a dialog that stays locked until the student types
  their sign-in email (one click on a red button is too easy to make by
  mistake); on success the action signs out and opens the landing page, on
  failure the dialog stays open with the error.
- **Notifications** (`/settings/notifications`): the design only. A row
  per alert the bell promises (New Matches, Employer Replies), each with a
  switch, disabled and marked Coming Soon: nothing stores or sends
  notifications yet, and the notification work (KAN-298) wires each switch
  to what it saves. Disabled, not live, because a switch that saves nothing
  is what My Profile's Autofill switch was removed for. Keep the list in
  step with the bell's line in `(seeker)/layout.tsx`.
- **Integrations** (`/settings/integrations`, KAN-413,
  `../../docs/email_tracker.md`): the apps a student connects, after
  Claude's connectors list. One row per app (Gmail, Google Calendar),
  drawn by `settings/setting-row.tsx` as Sign-In & Security's sign-in
  methods are: the app's own logo (`GmailIcon`, `GoogleCalendarIcon`), its
  name, one line on what it does, and Connect. The design only, as
  Notifications is: each Connect disabled and marked Coming Soon until its
  Google sign-in is built. Keep the page to those rows: a first version
  (Email) also listed what WorkIt reads and never does and the pilot's
  unverified-app warning, and the user found it too much text and the
  Connect button bare without the app's logo. That detail belongs in the
  step Connect opens.
- **Job Preferences** (`/settings/preferences`): onboarding's own first
  step (`RoleStep` in `onboarding/applicant/role-step.tsx`, `dense`: 18px
  labels, tighter rows, h3 headings), on the saved preferences, with Save
  and Discard; Save needs the role, job type and workplace onboarding
  requires, and saves as onboarding does (PUT, a picked state narrowing its
  country). The pickers' options come from `role-options.ts`, which
  onboarding reads too, so the two offer the same roles, places and start
  dates. No other screen edits saved preferences.

The company side's `/company/settings` is still a placeholder.

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
