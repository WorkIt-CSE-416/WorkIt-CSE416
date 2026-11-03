# Design system

What the two shells look like, how a page sizes itself, which colour means
what, and how the shared components are meant to be used. Read before changing
a shell, a page layout, a colour token or a `ui/` component.

## The two shells

The two shells are separate layouts on purpose, and they no longer look
alike. The seeker shell is flat: the section panel flush with the window's
left edge and running the full height with the logo in its header, the top
bar along the top beside it, and the page under the bar, ruled apart by
`--color-border-subtle` hairlines. The panel and the bar are white and the
page is `--color-app` grey (2026-11-02, after Simplify and Jobright), since
white cards blended into a white page. The panel's header
and the bar are both 64px with their bottom rule, so the two rules run as
one line. It floated until 2026-10-27, each part a white `rounded-shell`
panel 12px apart on the lavender `--color-frame`; the user found that
frame wasted room and read as three separate containers, so keep it flat:
no gaps, no rounded or shadowed shell panels. Scout's
panel docks at the right the same way, with a left rule. The panel is the
rail (below). The company shell is still docked: a full-width bar with the
lavender corner cell (`components/sidebar-brand.tsx`, company only now) over
a full-bleed panel. `app-sidebar.tsx` draws both, as `variant="rail"` or
the default `docked`. Their other shared parts (the bell, the account menu,
the search field) are in `src/components`. The company bar's search is a GET
`next/form` to `/company/applicants`. **The seeker bar has no search: it holds
the page's title** (`(seeker)/bar-title.tsx`, 2026-11-02). Job search showed on
every page there, so it moved to the Jobs page and /search
(`(seeker)/search/job-search.tsx`), and each page's heading and description went:
the title moved up, and the description is gone, to give every page about 60px.
Pages add no heading or description of their own under the bar. The field is
`(seeker)/search/query-field.tsx`, a client component that shows `?q` while on
/search, because the split frame is drawn by a layout, which never receives
searchParams.

Seeker pages break on the width they actually get, not the window's: the
shell renders them inside `@container/main`. A layout that splits into
columns uses `@3xl/main:` and friends, and a card that rearranges itself
(the job card) is its own `@container`. Scout's panel takes room beside the
page when open, and the page fits itself to what is left. **The panel never
changes the page's width**: it is a fixed rail. Until 2026-10-27 it
collapsed and opened, and a `--panel-gain` length (with its readers on
Applications, Tailor and the job rail) kept each page at its open-panel
width through the move; that went with the collapse. Applications has no
width cap (KAN-256): its list is a table that scrolls sideways, so more
width only shows more columns. **Every other seeker page stops at
`max-w-dashboard` (1440px)**, Home's cap, so all of them start at the same
left edge beside the rail (2026-10-27): at the old 1024px `max-w-app` they
sat centred between wide empty margins once the rail freed the room, which
the user found flawed. A block of prose keeps its own measure (About the
Role's 68ch), since text past about 80 characters a line is hard to follow. On Applications and
the Calendar the segmented control sits at the top right of the header
wherever it fits beside the title, the title wrapping first; Home's range
switch sits at the top right of the page, beside the greeting, and wraps
under it where the page is narrow.
Pages render a
`<div>`, not a `<main>` — shadcn's `SidebarInset` already is the `<main>`.

The seeker bar shows the signed-in account's real photo, with the full name
and email beside it from lg, at 40px like the bar's bare ink bell
(`(seeker)/bar.ts`); it reads `getCurrentAccount()` in
`lib/session.ts`, cached per render. The whole block is the trigger of
`components/account-menu.tsx`, passed in as its `children`, and opens
Settings, Help and Sign Out (with the account header only below lg, where the
block shows just the photo). A "N New Roles Since Yesterday" pill used to sit
beside it from xl; it was removed as a distraction, along with the
`/jobs?limit=500` fetch it made on every page.
The greeting is Home's heading, and the resume nudge is the profile
strength card at the panel's foot (`(seeker)/profile-strength.tsx`), which
counts only steps the API can see. Only messages backed by real data belong in
the bar — deadlines go first once the tracker has a backend, and not before.
The seeker panel holds only the search (Home, Jobs, Auto Apply,
Applications Tracker, Resumes & Experiences, Inbox, Calendar, My Profile:
the tools for applying, then what comes back, KAN-426; the Inbox is
archived for now, KAN-428), with no caption over it. Settings, Help and Sign Out, once its General
group, live in the bar's account menu and nowhere else. The
seeker layout redirects to /login when `getSessionUser()` finds no session,
so the shell never draws a signed-out state and the bar's account block is
always filled (from the session's email if /auth/me is down). The company panel keeps
Settings alone in its footer, and its account menu holds only the account
header and Sign Out. The company bar's Sign Out
is real, but its name is still hard-coded in `company/layout.tsx`.


**The seeker panel is a rail that is always open** (2026-10-27): 88px,
each section an icon over its name, after Jobright's and LinkedIn's
navigation, so it never covers the page and never moves it. A name too long
for the 72px tile takes the item's `short` (Tracker, Resumes, Profile),
with the full name kept as the accessible name; the rail's icons draw a
lighter line than the app's other icons (about 1.7px against 2px), which
read heavy at 24px. The logo is the mark alone, in a 64px header. The
profile strength card is a ring tile named Setup there. Below md it is
shadcn's sheet, with an icon beside each full name. `RailSidebarProvider`
(`app-sidebar.tsx`) holds shadcn's provider open, so the bar's toggle shows
below md only and opens the sheet. It replaced a 256px panel that pinned or
opened over the page on hover (KAN-300), which the user found a flaw.

**The company panel is pinned or opens on hover (KAN-300).**
Pinned, it stays open and the page makes room. Unpinned, it is the icon
rail; pointing at it opens it over the page after 150ms, and it closes
300ms after the pointer leaves, so a pointer crossing the rail neither
flashes it open nor snaps it shut. Tabbing into it opens it at once, and
focus leaving it or Escape closes it. The bar's toggle pins and unpins
(`aria-pressed`, a "Pin sidebar" / "Unpin sidebar" tooltip), as does Ctrl or
Cmd+B, and the pin is the `company_sidebar_pinned` cookie, not shadcn's
`sidebar_state`, which a Ctrl or Cmd+B on the seeker rail still writes. Below md the panel is
shadcn's sheet. `components/hover-sidebar.tsx` wraps shadcn's provider
rather than editing the vendored one: it opens the provider when pinned or
hovering. **Size anything by the pinned width with `useSidebarPin`, never
shadcn's `state`**; in CSS, key on the `data-pinned="true"|"false"` that
`HoverSidebarProvider` writes on the wrapper, for the same reason (KAN-368):
a hover sets that to "expanded", and the company bar's corner cell, sized
by it, widened and pushed the bar on every hover.

Shared shell parts in `src/components`: `app-sidebar.tsx` (the left panel both
shells use: shadcn's Sidebar with WorkIt's row spacing and current-item
marking; each shell passes its own groups and its bar's height as the offset),
`sidebar-brand.tsx` (the bar's corner cell: the panel toggle and the logo),
`hover-sidebar.tsx` (the company panel's pinned and hover states, above),
`notifications-menu.tsx` (the bell, a popover holding an empty state) and
`account-menu.tsx` (a name and email header, the shell's rows, then Sign Out;
Sign In without `onSignOut`).

`components/stat-tile.tsx` is shared by both dashboards, and both use its
`plain` variant; its card form has no caller today; the seeker Home
draws its own numbers (`home/headline.tsx`).

**One card on seeker pages** (KAN-558): every white block on a seeker page
is `ui/card.tsx`, 16px from the next, titled with `SectionHeading` (16px at
600, the weight that names a block). Home, My Profile and Settings drew
three kinds until then (two corners, two edges, two shadows, three title
styles, 16 or 20px apart). `tone="tile"` is Home's tile, which keeps
KAN-173's look: no outline, `--shadow-tile`, the 20px corner; a headline
tile adds its tint as a `bg-*` token. `href` makes the whole card a link
(an outline that darkens under the pointer, a focus ring, `group/card` for
the arrow): My Profile's link cards and Auto Apply's Application Info row.
A pill in a card is `<Badge variant="tag" pill>`. A seeker page draws no
card from raw classes.

The company Dashboard still uses open sections, the seeker Home's old
surfaces (it moved to tiles in KAN-173). On
/company: open KPI tiles beside one violet Most Urgent hero, open sections for
the chart, Highlights and Needs Your Attention, a grey Hiring Pipeline band
with no cards inside it, and one white card, the Recent Applicants table.
The company hero draws
`components/hero-arcs.tsx`. A section's one way onward, open or carded, sits
at the top right of its heading: `ui/section-link.tsx` for a link, `<Button
variant="section">` for an action. Whether the company Dashboard should move
to cards as well is still open. Each page's docblock says what goes where.

The auth screens (/login, /signup, /signup/choose-account-type) sit outside
both shells. Each is its card alone over a skyline (`components/skyline.tsx`):
a white sky thinning to lavender, a low sun on the left, and four rows of flat
violet towers along the window's floor, each row paler and hazier than the one
before it, the near ones shaded on their right faces. It is fixed, so the card
scrolls over it. The card hangs from
the top (12vh down from lg) so it holds still when the Company fields open. A
violet pitch filled the left of the window from lg until KAN-259: no mockup
drew it, and it pulled the eye off the form.

## Brand and icons

`components/logo.tsx` draws the WorkIt logo as SVG (a w-shaped figure with its
arms up beside "workit" in outlined Figtree Bold); `<Logo>` picks the lockup or
a half per size, `<LogoLockup>` is the seeker shell's pair. The figure is
violet and the word ink everywhere, the shells included (2026-10-20, KAN-300;
the shells drew it all in ink before). Other companies' marks (Google,
LinkedIn, Gmail, Google Calendar, and Chrome and Claude for Auto Apply's
setup, KAN-424) are drawn in `components/icons.tsx` in their own colours;
Claude's spark is never WorkIt's AI mark. There are no logo
image files; `public/workit-icon.svg` is the favicon's source (`npm run
favicon`). Every glyph is **Phosphor's** (`@phosphor-icons/react`, KAN-350), at
its regular weight. It replaced Lucide, which reads as the default set of
every shadcn app and AI builder; the user reviewed each swap side by side
before the change. `components/icons.tsx` holds glyphs used by more than one
route, as thin wrappers over Phosphor (the brand marks stay drawn); every
per-route `icons.tsx` is the same kind of wrapper.

- **Import from `@phosphor-icons/react/ssr`**, never the main entry, whose
  icons read a React context that a server component cannot; the lint
  refuses it. Types (`Icon`) may come from the main entry. Use the `*Icon`
  names (`CheckIcon`); the bare names are deprecated.
- **Every glyph is a touch heavier than Phosphor draws it** (KAN-365). Its
  regular line is 1px at `size-4`, and after Lucide's 2px every icon read
  thin, so one rule in `globals.css` (`svg[viewBox="0 0 256 256"]`, in
  base) outlines each glyph's shape by 5 units: about a 2px line, with
  Phosphor's shapes kept. Phosphor has no weight between regular and bold,
  and bold read chunkier than Lucide had. `custom-icons.tsx` strokes its
  glyphs to match (`STROKE`, 2 at regular); change the two together.
- **Sizes stay classes** (`size-4`): Phosphor's own default is 1em. Inside a
  Button, Chip or shadcn menu an icon with no size class takes the parent's.
- **Weight carries state.** Regular everywhere; `weight="fill"` for a
  selected or filled state (a saved bookmark, the starred resume) and
  `weight="bold"` where Lucide's stroke was raised for a small check or
  cross. Never a `fill` prop or a `fill-*` or `stroke-*` class: a Phosphor
  glyph is filled shapes, so either one paints all of it. A white pointer
  with a dark edge (the landing tour) is two glyphs stacked.
- **Pass `aria-hidden`** on a decorative icon: Phosphor does not add it, as
  Lucide did.
- Draw no new glyph by hand while Phosphor has one. A glyph it lacks is drawn
  in `components/custom-icons.tsx` on a 24-unit grid with Phosphor's props
  and all its weights, never as a bare `<svg>`: Auto Apply's rounded bolt
  (`LightningRoundedIcon`), the Role filter's person in a suit and tie
  (`UserTieIcon`, KAN-252), a checked clipboard and file, a chat with a plus,
  a scan with a magnifier and a folder with a branch.
- Meanings stay apart: the Offer stage is `Medal` and Veteran
  `MedalMilitary`; Company is `Building` and On-Site `BuildingOffice`;
  `CalendarBlank`, not `Calendar`, which prints a date.

`components/hero-arcs.tsx` is the corner arcs on the company Dashboard's
violet hero.

**Scout and every AI action share one mark** (KAN-257): `SparkleIcon`,
Phosphor's sparkle, on the top bar's launcher, Ask Scout, Fill With Scout,
Tailor's own run and Read It Again with AI, and inside Scout's
mark (`components/scout/chat.tsx`), the gradient tile beside every
assistant line and in Scout's panel header. The bar and the panel drew a
filled sparkle by hand while the chat and the AI buttons drew Lucide's, so
the assistant wore two marks. An ESLint rule refuses Phosphor's
`SparkleIcon` imported anywhere but `icons.tsx`.

**Tailor My Resume is the one exception** (KAN-518): the button on a job's
card and page draws `TailorIcon`, a page being rewritten. It only opens
Tailor, and beside Ask Scout a second sparkle read as a second assistant
and did not say what the button does. Scissors stay Fit to One Page's.

## Colour

**Small brand text is `text-brand-ink`, and a brand glyph `text-brand`**: on
`--color-brand-tint`, `brand-ink` reads 6.80:1 (`globals.css`). The Experiences
page's group labels and marks use the pair (KAN-440). Keep a reading's own
words in ink, and siblings drawn alike: every card's heading wears the same
mark.

Each stage has one colour and one icon, `(seeker)/stage-colors.ts`, read by
Home's Up Next, the Applications list, grid, Status filter and
application page (and the archived board), and the Calendar alike. A stage
in the Status filter (its dropdown and All Filters, KAN-282; chips until
then) leads with its stage's glyph in the stage's text colour, not a
coloured dot, so the stage reads by shape too (KAN-256); on the board the stage tints the
column panel, never the cards inside it. A dated entry wears one stage by its kind (`KIND_STAGE` there): an
interview is Interviewing's amber, an offer Offer's green, a deadline Saved's
grey, the applied date and a follow-up Applied's violet. The three views also
say the same thing about an application (the grid and list, and the board
when it returns): its role, company, date and match
score (KAN-256). There is no progress bar; it only restated the stage.

A match score is red, yellow or green (KAN-518): Weak red, Good yellow,
Strong green and Excellent a deeper green, so it says good or bad with no
legend. The four `--color-match-*` tokens in `globals.css` are read only
through `matchColor()` in `lib/match.ts`: the Applications match badge, the
job page's match rail, Tailor's ring and the company Dashboard's match bar.
They paint strokes and bars, never text; the tier words stay ink-muted, with
no dot before them, since the ring beside them already carries the colour. A
magenta ramp held these tokens until KAN-518, so a score would share no hue
with a stage. A pink ring said nothing about the fit, so the score now shares
green and red with the Offer and Rejected stages, and its shape, a ring or a
bar with a number, keeps it apart from a stage's chip. A new score display
takes `matchColor()` and a new stage display takes its stage map, never the
other's. The marketing pages' pink, which borrowed that ramp, is
`--color-updates`.

Intake's step chips say what became of each section with a corner badge
in two of those (KAN-257): a check on `--color-step-done` green, a dash on
`--color-ink-faint` grey for a skip, on a white chip with a
`--color-step-outline` edge (dashed when skipped). The brand marks where
the walk is, as a filled, ringed chip, and never stands for a state. The
chips sit on the stage card's lavender, `--color-stage-card`, in Scout's
panel, so their colours are measured there: the app's pale greys vanish on
that lavender and `--color-positive` is 2.38:1 on it. The ready dot takes
the done green;
the draft's "Ready to save" is words, so it takes `--color-positive-ink`,
and "Still needed" takes `--color-warning`, as the bank's own warnings do.
`globals.css` has the numbers.

## Type sizes

**Reading text is 12px or more** (KAN-554). A sentence, a value, a hint, an
error, a status and a group name take `text-note` (12px) or larger. `text-meta`
(11px) is for dates, counts, file facts, units and captions only, and for the
initials in a logo tile or avatar. 11px had spread to some 80 hints, errors and
statuses (Settings rows, Application Info, the bell, the company forms), and
the design audit found Settings hard to read. The status badge
(`ui/badge.tsx`) is `text-note` too, so a stage pill is 24px tall, and the
match rail's reasons are 12px. A lint rule (`eslint.config.mjs`, META_CLASS)
fails `text-meta` on a `<p>`, and on any element with an `id` (an
`aria-describedby` target needs one) or `role="alert"` or `"status"`. It reads
string classes, inside `cn()` too, never template strings or variables. Meta
on its own line is a `div` or a `span`. The marketing pages keep their own
sizes (`frontend/CLAUDE.md`, the landing page).

## Type weights

Four weights, each with one job, shown on `/design-kit/type` (Weights):
450 to read (body copy, helper text, typed values), 500 for anything a
student clicks or picks (buttons, chips, segmented controls, menu rows,
select and filter options, field labels), 600 to name a block (card and
dialog titles, a job's title, captions), 700 to name a page. A token that
carries a weight already sets it; a size with none of its own (body, note)
takes the weight of its job. shadcn's menu, select and combobox rows set no
weight and drew at 400, so the account menu read thinner than the Jobs
page's filters; `globals.css` sets them to 500 by `data-slot`, in base so a
row that asks for another weight still gets it (KAN-365). The filters' own
option rows (`filter-controls.tsx`) set theirs and are left alone: a nested
option is regular under its medium parent. Regular is 450, not 400
(`--font-weight-normal`, KAN-365): Plus Jakarta Sans loads as a variable
font, and its 400 read thin in small grey text such as a job card's facts
and dates. `font-normal`, the body's default and `--text-hero` all read it,
so never write a literal 400.

## Components

**Borders and small text were darkened on 2026-11-02**, in the tokens, so every
screen moved together: `--color-border` and `--color-border-subtle` to about the
same mid grey, and `--color-ink-meta` to #465266 (about 7.8:1 on white). The user
found them faint beside Simplify's. Tune the tokens, never one screen.

**A control's edge is `--color-border-control`; a card's edge is decoration
only** (KAN-556). Any edge, ring or dash that marks a control or a state (a
field, the search pill, the segmented track, an empty checkbox or radio, a
table cell's button, the timeline's step still ahead, an empty slot, the
upload dropzone) takes `border-control`: 3.37:1 on white, 3.09:1 on the grey
ground and 3.15:1 on `well`, so it meets WCAG 1.4.11's 3:1 on both grounds.
`--color-border`, `--color-border-subtle` and `--color-border-strong` are
1.2:1 to 1.5:1, so they draw only what nothing depends on: a card's outline,
a rule, a score ring's empty track. The search pill and the segmented track
had no outline, a 5% ink wash chosen for a white page, and fell to 1.1:1 once
the seeker pages stood on grey. shadcn's `--input` maps to `border-control`
too, so its checkboxes, fields and the switch's off track follow.

**An icon's colour says its job** (2026-11-02), never which component drew it:
black (`ink`) if it can be clicked, purple (`brand`) if it is on or selected, grey
(`ink-meta`) if it only gives information (a job's facts, a field's magnifier, a
dropdown's arrow), `ink-subtle` if it cannot be used now, and the status colour
for a status. `IconButton` is black at rest and its `quiet` variant turns purple
on hover, and an icon beside a label takes the label's colour. Each component
chose for itself until then, so All Filters was grey beside a black Auto Apply. One
exception: a segmented control's unpicked option stays grey, since black against
grey is what says which option is on. A dialog's or sheet's close X is black too,
set by its `data-slot` in `globals.css`: shadcn's `ghost` Button drew it purple.

**A target is 24px or more, and 44px on a touch screen** (KAN-557, WCAG 2.5.8).
The `ui/` parts set it, never a call site: Button, IconButton, Chip, SectionLink,
RemovableChip's cross and SegmentedControl take the `hit-area` utility in
`globals.css`, an invisible `::after` centred on the control that is 24px or the
control's size with a mouse and 44px under `pointer: coarse`. So the look from
KAN-251 (sm 36px, the chips, the 36px segmented track) does not move a pixel;
only the area that takes a press grows. `quiet` IconButtons reach 8px past their
box as well, and the `inline` and `section` Buttons and SectionLink 6px. Rows that touch each
other cannot share a wider area, so on touch they grow instead: menu, select and
combobox rows (by `data-slot` in `globals.css`), the check rows and the
sidebar's sheet rows are 44px. The vendored checkbox and switch get 44px by
`data-slot` too. Two controls closer than 44px have overlapping hit areas on
touch, and the later one takes the overlap.

**Contrast holds on white and on the grey ground** (KAN-555): a word 4.5:1, a
live glyph or a chart mark 3:1, measured on `--color-app` as well as on white.
So words and live arrows (a sort chevron, a dropdown's arrow, "Optional") are
`ink-meta` or darker; `ink-faint` (2.85:1 on grey) and `ink-subtle` (2.95:1 on
white) are for disabled or decorative glyphs only. `--color-positive` (2.80:1)
never sits under a word or a white glyph: the green button, done discs and the
match rail's tick take `positive-ink`. Glyphs on the bright amber
(`warning-fill`) are `ink`; a white glyph needs `warning-strong` (3.19:1) or
deeper. The
chart slots clear 3:1 on both grounds; `globals.css` has the numbers.

**A form's buttons sit by what kind of form it is** (2026-11-03). Two rules,
each with its own reason, and every form follows one of them:

- **A page or Settings form: left, the primary first** (Save, then Discard).
  The eye runs down a single-column form's left edge, so a button there is
  found first (Luke Wroblewski's form studies; the GOV.UK Design System).
  Settings' sections pin this row to the foot of what scrolls.
- **A dialog, or a card edited in place: right, the primary last** (Cancel,
  then Save). The last button is where the task goes on, as on macOS and in
  Material, and shadcn's `DialogFooter` already sets it. My Profile's Contact
  & Links, Application Info's cards and the Experiences entry editor are
  this kind.

Nielsen Norman Group's finding is that either order works and mixing them on
like screens costs the user, so a new form takes its kind's rule. **A
disabled Save is grey** (`ui/button.tsx`, DISABLED_FILL): a faded brand fill
read as lavender, a picked state. **A lesser action beside a button is muted
ink** (`variant="section"`), never brand text: Settings' Remove Photo was
brand-coloured beside Change Photo and drew the eye from Save.

**One scrollbar** (`globals.css`): a 4px thumb on no track, shown while the
pointer is over what it scrolls. Style it there, never per element.

`components/save-button.tsx` is the one Save control on every job surface.

**Every short "this happened" message is a toast** (`components/ui/toast.tsx`):
`useToast().show({ message, action? })` from any page, since one
`<ToastProvider>` sits in the root layout beside the tooltips'. A toast is a
white card (`bg-panel`, the subtle border, `--shadow-lift`, the card radius)
in the window's bottom right corner, body text, an optional action as a
secondary button (Undo), and a cross. It stays 5 seconds, paused while the
pointer or focus is on it, so an Undo is never lost mid-reach; at most three
show, newest nearest the corner. The provider holds them, so a toast
outlives the part that raised it (a row that a refresh removes). Use one for
a result the page does not show by itself, never for an error a form can
show beside its field.
`lib/format-count.ts` prints a headline figure ("1,234", "12.3K") in en-US so
the server and the browser print the same.

**Every choice of one among a few is `ui/segmented-control.tsx`**: the
Calendar's Month, Week and Agenda, Home's range, the Applications
layouts, the sign-in card's Applicant or Company, the company chart's
range, and Resumes & Experiences' two views. A pill-shaped track (a 5% ink wash, so it reads on the white page and
the off-white auth card alike, edged in `--color-border-control` as an inset
ring, since with no outline it was 1.1:1 on the seeker pages' grey ground,
KAN-556) with a white thumb that slides
to the chosen option on the 300ms glide (`docs/motion.md`), and jumps under
reduced motion. The options are equal width, so the thumb is placed with CSS
alone and the server renders it in place. `SegmentedLinks` is for a choice
kept in the URL: the thumb moves on the click, before anything else answers.
Every caller but one passes `shallow`, which moves the query in place
(`components/shallow-routing.tsx`) for content the page already holds, so
the content redraws with the thumb; without it, the page goes back to the
server and the content follows a round trip later. The one is Resumes &
Experiences' switcher (`(seeker)/resumes/header.tsx`): its options are two
routes, and each reads its own data on the server. `SegmentedToggle` is for component state, on Base UI's
ToggleGroup for its arrow keys and single tab stop; a null value hides the
thumb. An icon option is a rendered element, not a component, since a server
page passes the options. Build a new segmented choice from it rather than
styling a ToggleGroup by hand.

**No field opens the browser's own picker** (KAN-429). A native
`<input type="date">` or `type="time"` opens the OS's chrome (a blue grid of
hours, a system calendar) in none of WorkIt's type or colours. A date is
`components/date-field.tsx`, WorkIt's Calendar in a Popover, with Clear in
the popover for an optional one; a time is a `<SelectField>` of quarter
hours, as Google Calendar offers (Create Event's Start and End, the End
list naming each choice's length); a month is `components/month-field.tsx`,
the DateField pattern with a year and its twelve months (KAN-559: the
Experiences editor's `type="month"` opened Chrome's own picker); a
multi-line box is `components/text-area-field.tsx`. **A pick that has a glyph wears it**: a
`<SelectField>` option takes the filter dropdowns' `Icon` and
`iconClassName`, and draws them
with `OptionLabel` in the list and on the closed field, so a stage or an
event kind looks the same in a form as in the Tracker's Status filter and
the Calendar's Type filter. A list with glyphs stays its field's width and
cuts a long name with an ellipsis. Create Event shipped first with native
date and time inputs and plain text lists for Type and Application, which
broke both rules. My Profile's Start Window and onboarding's Availability
step moved to `DateField` with it; no native date or time input is left in
`src`, so a search for `type="date"`, `type="time"` or `type="month"`
finds a regression.

**Every field, radio and answer tile comes from `ui/`** (KAN-559), never a
screen's own `<input>`, `<textarea>` or `FIELD_CONTROL` string:

- A text field is `<TextField>`: `size="lg"` (16px type, 44px, a 14px
  label) on onboarding's one-question screens, `labelIcon` for a glyph before
  the label (onboarding's links). A field a section heading names (My
  Profile's Contact & Links, onboarding's Location) is the bare box,
  `<TextInput>`, under its heading.
- A multi-line box is `<TextAreaField>`, with `grow` for one that grows with
  its text (a written answer, coursework). A box a question names (Written
  Answers' fact box) is the bare `<TextArea>`.
- A one-pick list is `ui/radio-row.tsx`: `<RadioRow>` for a bordered answer
  row (the uninstall survey, Written Answers), `OPTION_ROW` for the same row
  holding a checkbox, and `<Radio>` inside a richer card (the resume
  pickers). It is still the native radio in the brand accent: drawing a 20px
  one is open.
- One answer on a one-question screen is `ui/choice-tile.tsx`
  (onboarding's steps); a pill in a row is the Chip.
- A filter over a table is `SearchField` and `FieldFacet` (above), the
  company tables' toolbar included.

**Named exceptions**, each a control drawn for its place, not a form field:
the resume editor's in-place lines, title rename, size stepper, phone sheet
and skill input (`(seeker)/resumes/[resumeId]/`), which wear the page's own
type; Scout's chat composer; the Experiences editor's bullet boxes with their
drawn mark and the dashed Add Bullet Point (`FIELD_CONTROL` with a left
inset); the filters' searchable combobox and pay box
(`components/filter-controls.tsx`), parts of the pickers themselves; the
company composer's compact location search and screening question rows; the
Pricing page's Monthly / 3 months switch, two native radios so the page
ships no script (the marketing pages do not use `ui/`); and the admin pages,
an internal tool.

**An application or a resume is never picked from a dropdown** (KAN-429).
An application is picked in Choose Application
(`(seeker)/applications/pick-application.tsx`): the Tracker's rows (logo,
role and company, the stage's pill, the day it went in) in a modal with a
search, opened from a Choose Application button and shown once picked as
its logo, role, company and Change. The Inbox opens it.

**Never a dialog over a dialog** (KAN-429). Where a pick belongs to a
dialog already open, that dialog shows the pick as a step of its own: its
body swaps to the picker, its title and line say what the step asks, a
Back arrow beside the title returns once there is something to return
to, and a pick returns by itself. Create Event does this with
`ApplicationTable`, Choose Application's body; from the Calendar it opens
on that step, since every event is on an application. The form stays
mounted, hidden, under the step, so what was typed survives it. Choose
Application opened as a second dialog over Create Event at first, which
read as a page laid over a page with only its own close as a way back. A
resume is picked in the grouped list every resume dialog shares
(`ResumeLists`, `(seeker)/jobs/resume-picker.tsx`). A dropdown of "Company
· Role" lines hid where each application stood and cut long titles short;
Create Event's first version had one.

`src/components/ui` and `src/components/shadcn` are not interchangeable. The
first is hand-written from the mockups and is what screens should import. The
second is vendored by `npx shadcn@latest add` for the interactive primitives we
have not built — dialogs, selects, popovers — and is regenerated in place, so
hand edits there are a fork. shadcn's colour roles are aliased onto WorkIt's
tokens at the bottom of `globals.css`, which is why a generated component needs
no restyling — fix the mapping there rather than the component.

Its stock text sizes are bound the same way: `text-xs` is `--text-note` and
`text-sm` is `--text-body`, so a menu row or a select option is body type by
construction and moves when the scale does. WorkIt's own code still writes the
token names, never `text-sm`. Where a vendored piece draws something the scale
has no token for, the call site sets the token, since the file is not ours to
edit: a `DialogTitle` or `SheetTitle` takes `text-subtitle font-semibold`
(stock is 16px medium, a pairing nothing else uses), and a `Calendar` takes
`[&_.rdp-weekday]:text-note` for its 12.8px weekday row. `text-base` stays
unbound on purpose: it is the 16px that keeps iOS from zooming into the text
and search fields below sm. `/design-kit/type` shows what each stock size
resolves to.

There is exactly one Button, `ui/button.tsx`. It answers to shadcn's variant and
size names (`default`, `secondary`, `outline`, `ghost`, plus WorkIt's own
`positive` and `decline`, the quiet red beside a green action) while painting the mockups' styling, so a component pasted from
the shadcn docs composes without edits and still looks like WorkIt.
Every variant at a size is one box (sm 36px, default 42px, lg 48px), a
text-only one included, and the Button sizes its glyphs to keep it so: an
icon with no `size-*` class is 16px (14px at `inline`, `xs` and
`section`). Lucide's own 24px once stretched about 30 sm buttons to 38px, so the
bank's My Resumes button stood taller than Fill With Scout beside it
(KAN-249); give an icon a size only when it must differ. `shadcn/button.tsx` is a re-export pointing back at it, and an
ESLint rule keeps app code on the canonical path, as it does for `badge`
and `card`, which are not re-exports. **A secondary button never sits on
`--color-surface`**, its own fill: there it shows only as an outline. The
resume editor's bar and the phone editor's sheets were surface-coloured,
and Download, Done and Hide all but vanished into them (KAN-258); put
secondary buttons on white (a card, a sheet, the editor's slim bar on
`--color-panel`) or on a tint (the phone editor's bars take
`--color-brand-tint`).

**A filter over a page's items is a dropdown** (`components/field-facet.tsx`,
`FieldFacet`): a small secondary button with the field's glyph and name,
tinted while it holds a pick, over checkbox rows, each option in its own
glyph and colour where it has one, and a cross beside the row to clear it.
None picked shows everything. The Applications Tracker's filter row, the
Inbox's Status, Live Activity's Status and the Calendar's Type all draw it,
so filtering looks and works the same on every page. Never a row of chips
for this: the Calendar drew one for a draft (KAN-429) and the Inbox before
it (KAN-413), and each broke the pattern the rest of the app had set, and
grew a line with every option. Chips stay for a choice made in place on a
screen built around it (onboarding's steps, the Jobs page's search chips).

**A panel from the right floats, and nothing behind it blurs** (KAN-429,
the forked `components/shadcn/sheet.tsx`): inset 12px from the window's
edges, with `rounded-shell` corners, a full border and `shadow-lift`, over
a light dim of the page that stays sharp. It was a full-height square slab
against the window's edge over a blurred page, which read as a different
app from the rounded cards around it, and the blur hid what the panel was
about. The application detail panel (the Calendar's) is the one today.

**A button is a rounded rectangle; a pill is a chip** (KAN-251). A button
acts (saves, opens, sends, goes somewhere); a chip is a choice made in
place: a filter, a toggle, or an answer offered. A badge is a pill too, but
a label, and a segmented control's track is a pill because it is a choice as
well. Two pills act on purpose: the Calendar's Today, drawn to match its
round arrows, and Next Up's date, a badge inside a link to that day on the
Calendar. **Pick a button's size by where it sits**: `sm` (36px)
for an action in a card, a row, a page's header or a panel; `default`
(42px, a text field's height, so a form's buttons line up with its fields)
in a form or a dialog; `lg` (48px) for the one main action of a page or the
sign-in card. The three were 32, 36 and 42px until KAN-251 and read as
thin; the chip, the small segmented control and the icon buttons beside sm
buttons (Save, Not Interested, Report, the Calendar's arrows) went to 36px
with them.
There is exactly one Chip, `ui/chip.tsx`, at two sizes: `default` (36px, an
sm button's height, so they line up in a row) and `lg` (42px, a default
button's and a text field's height, 16px type) for a row of short picks on a
screen built around them (onboarding's Salary presets). A fixed answer on
onboarding's steps is a `ChoiceTile` (`ui/choice-tile.tsx`), a full-width
tile with a box or a dot, not a chip. Its roles: `choice` with `pressed` for filters and
toggles, `suggestion` for an offered answer, `primary` for the one most
people take, and `ChipLink` for a filter kept in the URL. **A call site
never changes a button's or chip's box**: a `no-restricted-syntax` rule in
`eslint.config.mjs` (BOX_CLASS) refuses a height, padding, radius, type
size, line height or border width in its `className` (as a plain string;
it cannot read `cn()` or a template string), which may only place it or
colour a state. That is
what ended Home's pill buttons, a 52px Start Auto Apply, the
welcome page's stretched buttons (now choice cards) and five hand-drawn
pills at three heights. `/design-kit/buttons` shows every size and chip with
its role.

Tailwind v4 is configured entirely in `src/app/globals.css` via `@theme static`
— there is no `tailwind.config.js`. Add design tokens there. The file also
records two open questions for whoever owns the mockups: the login and app
screens disagree about which hex is a page and which is a card, and the board's
grey "Applied" chip may or may not be a second chip token.
