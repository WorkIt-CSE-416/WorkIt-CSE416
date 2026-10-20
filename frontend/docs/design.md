# Design system

What the two shells look like, how a page sizes itself, which colour means
what, and how the shared components are meant to be used. Read before changing
a shell, a page layout, a colour token or a `ui/` component.

## The two shells

The two shells are separate layouts on purpose, and they no longer look
alike. The seeker shell floats: the section panel runs the full height with
the logo in its header, beside a top bar and the page, each a white
`rounded-shell` panel on the lavender `--color-frame`, 12px apart and 12px
from the window. The company shell is still docked: a full-width bar with the
lavender corner cell (`components/sidebar-brand.tsx`, company only now) over
a full-bleed panel. `app-sidebar.tsx` draws both, as `variant="floating"` or
the default `docked`. Their other shared parts (the bell, the account menu,
the search field) are in `src/components`, and what is left is each bar's
search target and copy. Each bar's search is a GET `next/form`
to its own results page: `/search` for a seeker, `/company/applicants` for a
company. The seeker field is `(seeker)/search/query-field.tsx`, a client
component that shows `?q` while on /search and empties elsewhere, because a
layout never receives searchParams. Lift a `<TopBar>` out only if they are
still near-identical once both sides are real screens.

Seeker pages break on the width they actually get, not the window's: the
shell renders them inside `@container/main`, because an open panel takes
280px with its insets. **That width is the one they have with the panel
open, in both states**: collapsing the panel re-centres the page in the room
it frees and never rearranges it (`(seeker)/layout.tsx`, "A PAGE KEEPS THE
WIDTH"). Keyed to the `<main>` itself, collapsing between about 800 and
1300px moved the Dashboard from one column to two and its range switch from
the page's right edge to its middle, wrapped the Calendar's view switch, and
turned the Week into seven columns. The container is `--panel-gain`
narrower than the `<main>`, a registered length that eases over the panel's
own 200ms linear, so the page holds its width through the animation; keep
the two durations equal. A layout that splits into columns uses
`@3xl/main:` and friends, a card that rearranges itself (the job card) is
its own `@container`, and both see the same width whether the panel is open
or not. **One page takes the freed room back: Applications** (KAN-256). Its
list is a table that scrolls sideways, so more width only shows more
columns. The page has no width cap and a negative margin of half
`--panel-gain` on each side, which widens it with the panel's own easing
while its `@…/main` queries still see the open width, so nothing on it
reflows. A page whose layout splits or wraps by width keeps the rule;
reading pages keep `--container-app`, since text past about 80 characters a
line is hard to follow. On Applications and the Calendar the segmented control sits at the
top right of the header wherever it fits beside the title, the title
wrapping first; the Dashboard's range switch sits at the top right of the page, beside the
greeting, and wraps under it where the page is narrow.
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
The greeting is the Dashboard's heading, and the resume nudge is the profile
strength card at the panel's foot (`(seeker)/profile-strength.tsx`), which
counts only steps the API can see. Only messages backed by real data belong in
the bar — deadlines go first once the tracker has a backend, and not before.
The seeker panel holds only the search (Dashboard, Jobs, Auto Apply,
Applications, Calendar, Resumes & Experiences, My Profile), with no
caption over it. Settings, Help and Sign Out, once its General
group, live in the bar's account menu and nowhere else. The
seeker layout redirects to /login when `getSessionUser()` finds no session,
so the shell never draws a signed-out state and the bar's account block is
always filled (from the session's email if /auth/me is down). The company panel keeps
Settings alone in its footer, and its account menu holds only the account
header and Sign Out. The company bar's Sign Out
is real, but its name is still hard-coded in `company/layout.tsx`.


**The panel is pinned or opens on hover (KAN-300), in both shells.**
Pinned, it stays open and the page makes room, as it always did. Unpinned,
it is the icon rail; pointing at it opens it over the page after 150ms, and
it closes 300ms after the pointer leaves, so a pointer crossing the rail
neither flashes it open nor snaps it shut. Tabbing into it opens it at once,
and focus leaving it or Escape closes it. The page underneath never moves or
reflows during a hover: the gap beside the panel keeps the rail's width,
and the seeker page keeps its collapsed `--panel-gain`. The bar's toggle
pins and unpins (`aria-pressed`, a "Pin sidebar" / "Unpin sidebar"
tooltip), as does Ctrl or Cmd+B, and the pin is the `sidebar_state` cookie.
Below md the panel is shadcn's sheet, which has no hover, and works as
before. `components/hover-sidebar.tsx` wraps shadcn's provider rather than
editing the vendored one: it opens the provider when pinned or hovering.
**Size anything by the pinned width with `useSidebarPin`, never shadcn's
`state`**: a hover sets that to "expanded", and the company bar's corner
cell, sized by it, widened and pushed the bar on every hover. On the seeker
shell a hovering panel covers the bar's toggle, so pinning from a hover is
Ctrl or Cmd+B, or the toggle once the panel closes.

Shared shell parts in `src/components`: `app-sidebar.tsx` (the left panel both
shells use: shadcn's Sidebar with WorkIt's row spacing and current-item
marking; each shell passes its own groups and its bar's height as the offset),
`sidebar-brand.tsx` (the bar's corner cell: the panel toggle and the logo),
`hover-sidebar.tsx` (the panel's pinned and hover states, below),
`notifications-menu.tsx` (the bell, a popover holding an empty state) and
`account-menu.tsx` (a name and email header, the shell's rows, then Sign Out;
Sign In without `onSignOut`).

`components/stat-tile.tsx` is shared by both dashboards, and both use its
`plain` variant; its card form has no caller today; the seeker Dashboard
draws its own numbers (`dashboard/headline.tsx`).

The company Dashboard and the seeker Profile still use open sections, the
seeker Dashboard's old surfaces (it moved to tiles in KAN-173). On
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
favicon`). `components/icons.tsx` holds glyphs used by more than one route, as
thin wrappers over Lucide at its default stroke (the brand marks stay drawn);
every per-route `icons.tsx` is the same kind of wrapper. Draw no new glyph by
hand while Lucide has one. A glyph it lacks (RoleIcon's person in a suit,
KAN-252) is drawn on Lucide's 24-unit grid with `createLucideIcon`, never as
a bare `<svg>`, so it takes the same stroke and sizing. `components/hero-arcs.tsx`
is the corner arcs on the company Dashboard's violet hero.

**Scout and every AI action share one mark** (KAN-257): `SparkleIcon`,
Lucide's Sparkles, on the top bar's launcher, Ask Scout, Fill With Scout,
Tailor My Resume and Read It Again with AI, and inside Scout's
mark (`components/scout/chat.tsx`), the gradient tile beside every
assistant line and in Scout's panel header. The bar and the panel drew a
filled sparkle by hand while the chat and the AI buttons drew Lucide's, so
the assistant wore two marks. An ESLint rule refuses `Sparkles` imported
from lucide-react anywhere but `icons.tsx`.

## Colour

Each stage has one colour and one icon, `(seeker)/stage-colors.ts`, read by
the Dashboard's Up Next, the Applications list, grid, Status filter and
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
Calendar's Month, Week and Agenda, the Dashboard's range, the Applications
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
`positive`) while painting the mockups' styling, so a component pasted from
the shadcn docs composes without edits and still looks like WorkIt.
Every variant at a size is one box (sm 36px, default 42px, lg 48px), a
text-only one included, and the Button sizes its glyphs to keep it so: an
icon with no `size-*` class is 16px (14px at `inline`, `xs` and
`section`). Lucide's own 24px stretched about 30 sm buttons to 38px, so the
bank's My Resumes button stood taller than Fill With Scout beside it
(KAN-249); give an icon a size only when it must differ. `shadcn/button.tsx` is a re-export pointing back at it, and an
ESLint rule keeps app code on the canonical path, as it does for `badge`
and `card`, which are not re-exports. **A secondary button never sits on
`--color-surface`**, its own fill: there it shows only as an outline. The
resume editor's bar and the phone editor's sheets were surface-coloured,
and Download, Done and Hide all but vanished into them (KAN-258); put
secondary buttons on white (a card, a sheet) or on a tint (the editor's
bars take `--color-brand-tint`).

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
what ended the Dashboard's pill buttons, a 52px Start Auto Apply, the
welcome page's stretched buttons (now choice cards) and five hand-drawn
pills at three heights. `/design-kit/buttons` shows every size and chip with
its role.

Tailwind v4 is configured entirely in `src/app/globals.css` via `@theme static`
— there is no `tailwind.config.js`. Add design tokens there. The file also
records two open questions for whoever owns the mockups: the login and app
screens disagree about which hex is a page and which is a card, and the board's
grey "Applied" chip may or may not be a second chip token.
