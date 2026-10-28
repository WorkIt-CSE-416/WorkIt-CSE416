# Design system

What the two shells look like, how a page sizes itself, which colour means
what, and how the shared components are meant to be used. Read before changing
a shell, a page layout, a colour token or a `ui/` component.

## The two shells

The two shells are separate layouts on purpose, and they no longer look
alike. The seeker shell is flat: one white surface, the section panel
flush with the window's left edge and running the full height with the logo
in its header, the top bar along the top beside it, and the page under the
bar, ruled apart by `--color-border-subtle` hairlines. The panel's header
and the bar are both 64px with their bottom rule, so the two rules run as
one line. It floated until 2026-10-27, each part a white `rounded-shell`
panel 12px apart on the lavender `--color-frame`; the user found that
frame wasted room and read as three separate containers, so keep it flat:
no ground colour, no gaps, no rounded or shadowed shell panels. Scout's
panel docks at the right the same way, with a left rule. The panel is the
rail (below). The company shell is still docked: a full-width bar with the
lavender corner cell (`components/sidebar-brand.tsx`, company only now) over
a full-bleed panel. `app-sidebar.tsx` draws both, as `variant="rail"` or
the default `docked`. Their other shared parts (the bell, the account menu,
the search field) are in `src/components`, and what is left is each bar's
search target and copy. Each bar's search is a GET `next/form`
to its own results page: `/search` for a seeker, `/company/applicants` for a
company. The seeker field is `(seeker)/search/query-field.tsx`, a client
component that shows `?q` while on /search and empties elsewhere, because a
layout never receives searchParams. Lift a `<TopBar>` out only if they are
still near-identical once both sides are real screens.

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
and email beside it from lg, at 40px like the bar's grey-filled round
bell and search controls (`(seeker)/bar.ts`); it reads `getCurrentAccount()` in
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
Applications Tracker, Inbox, Calendar, Resumes & Experiences, My Profile),
with no caption over it. Settings, Help and Sign Out, once its General
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

The company Dashboard and the seeker Profile still use open sections, the
seeker Home's old surfaces (it moved to tiles in KAN-173). On
/company: open KPI tiles beside one violet Most Urgent hero, open sections for
the chart, Highlights and Needs Your Attention, a grey Hiring Pipeline band
with no cards inside it, and one white card, the Recent Applicants table. On
/profile: an open identity band, Resume as the only card, and an open
Experiences section. The company hero draws
`components/hero-arcs.tsx`. A section's one way onward, open or carded, sits
at the top right of its heading: `ui/section-link.tsx` for a link, `<Button
variant="section">` for an action. Whether those two pages should move to
cards as well is still open. Each page's docblock says what goes where.

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
the shells drew it all in ink before). There are no logo
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
Tailor My Resume and Read It Again with AI, and inside Scout's
mark (`components/scout/chat.tsx`), the gradient tile beside every
assistant line and in Scout's panel header. The bar and the panel drew a
filled sparkle by hand while the chat and the AI buttons drew Lucide's, so
the assistant wore two marks. An ESLint rule refuses Phosphor's
`SparkleIcon` imported anywhere but `icons.tsx`.

## Colour

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

A match score has its own colour and never borrows a stage's. The four
`--color-match-*` tokens in `globals.css` are one magenta ramp, deeper for a
better match, read only through `matchColor()` in `lib/match.ts`: the
Applications match badge, the job page's match rail and the company Dashboard's match bar.
They paint strokes, dots and bars, never text; the tier words stay ink-muted.
Stages and statuses own violet, blue, amber, green, grey and red, so a new
score display takes `matchColor()` and a new stage display takes its stage
map, never the other's.

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
the off-white auth card alike, and no outline) with a white thumb that slides
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
`positive` and `decline`, the quiet red beside a green Accept) while painting the mockups' styling, so a component pasted from
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
button's and a text field's height, 16px type) for a screen where the chips
are the question itself, onboarding's filter steps. Its roles: `choice` with `pressed` for filters and
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
