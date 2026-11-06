# Design system

What the two shells look like, how a page sizes itself, which colour means
what, and how the shared components are meant to be used. Read before changing
a shell, a page layout, a colour token or a `ui/` component.

## Design principles

The rules that every screen is checked against. Each rule gives its reason,
its source and the WorkIt token or component that applies it, and a reviewer
can check each one on a screen. The sections after this one hold the details
and the history; where a rule here points to one of them, that section is the
rule. Where the app breaks a rule today, the break is in **Still open** at the
end of this section. Fix the screen, not the rule. These rules are for app
screens; the marketing pages follow `frontend/CLAUDE.md`'s landing rules,
and only the rules that name them (Accessibility, Copy). The design audit of
2026-11-03 (Epic KAN-553) added the concrete rules here and settled four
open choices (Settled choices, near the end).

### Legibility

- **Each kind of text has one size.** The same kind of text then looks the
  same on every page (Refactoring UI, "Establish a type scale"). Write the
  token, never a stock size (`text-sm`) or a px value. Each token carries its
  own line height and, where it has one, its weight and tracking.

  | Token | Size | Use it for |
  | --- | --- | --- |
  | `text-caption` | 11px, 600, capitals | A rule label ("OR CONTINUE WITH"). Never a sentence. |
  | `text-meta` | 11px | Meta: a date, a count, a file size, a caption. |
  | `text-note` | 12px | One secondary line: an employer, a pill, a status badge, a group name, a hint or an error under a field. |
  | `text-label` | 13px, 500 | Field labels, buttons, links, menu rows. |
  | `text-body` | 14px | Body copy, typed values, table cells, messages. |
  | `text-subtitle` | 16px, 600 | A block's name: a dialog title, a job's title, an empty state's title. |
  | `text-title` | 20px, 700 | A card's or a section's heading (`SectionHeading`); the top bar title below md. |
  | `text-heading` | 26px, 700 | A page's name: the top bar title from md, a sub-page's h1. |

  `text-display`, `text-figure` and `text-hero` are for numbers and
  onboarding's question only, never for a heading.
- **Reading text is 12px or larger, and body copy is 14px.** Small text is
  slow to read, and many students read on a laptop at arm's length
  (Butterick, "Point size"). Any sentence, value, hint, error, status or
  group name is `text-note` or larger. 11px (`text-meta`, `text-caption`)
  holds a date, a count or a caption only. A reviewer checks every `p` and
  every `aria-describedby` target in `text-meta`.
- **Reading text holds 4.5:1, and large text, borders that mark a control,
  and icons hold 3:1.** Below these, text is hard to read for low vision
  (WCAG 2.2 SC 1.4.3 and 1.4.11). Large text is 24px, or 18.66px at 700:
  in WorkIt, `text-heading` and `text-title`. Pick the ink by its measured
  ratio:

  | Token | On `panel` (#fff) | On `well` (#f5f5f5) | Allowed for |
  | --- | --- | --- | --- |
  | `ink` #121a28 | 17.44:1 | 16.00:1 | Any text: headings, values. |
  | `ink-muted` #3b3e46 | 10.70:1 | 9.81:1 | Any text: body copy, labels. |
  | `ink-meta` #465266 | 7.90:1 | 7.24:1 | Any text: secondary lines, placeholders; icons that inform. |
  | `ink-faint` #8893a4 | 3.11:1 | 2.85:1 | No text. Marks on white only (a dash, a dot, a resting chevron). |
  | `ink-subtle` #94969d | 2.95:1 | 2.71:1 | No text. A glyph that cannot be used now (WCAG exempts inactive controls). |

  `brand` (6.26:1 on white, 5.75:1 on `app`) and `brand-ink` (7.99:1) may
  carry text. So words use `ink`, `ink-muted`, `ink-meta`, `brand` or
  `brand-ink`, never `ink-faint` or `ink-subtle`, which are for a disabled
  or decorative glyph only. A filled button's text holds 4.5:1 on its fill:
  white goes on `positive-ink`, never on `positive` (2.80:1), and words and
  glyphs on the Scout amber are `ink`, never white (3.19:1).
- **Rings, control borders and chart marks hold 3:1 on white and on grey.**
  A ring, a dash or an edge that marks a control or a state (a field, a
  segmented track, a choice tile, a table pill, the timeline's upcoming
  ring, an empty slot, an outlined button or chip) uses `border-control`,
  and a chart's series colours reach 3:1 on `panel` and on `app` (WCAG 2.2
  SC 1.4.11). `border-control` is 3.37:1 on white, 3.29:1 on `app` and
  3.09:1 on `well`, so a control keeps its white fill on the ground. A
  card's outer edge takes `border-control` too (2026-11-03), so cards and
  controls match; a rule inside a card (`border`, `border-subtle`) is about
  1.2:1, decoration only, never what marks a control.
- **A prose block stops at about 68 characters a line.** Past about 75, the
  eye loses the next line (Butterick, "Line length": 45 to 90; Baymard: 50
  to 75). The measure is one token, `--measure-prose` (68ch, Settled
  choices), and a single-column form stops at `--measure-form` (48rem), so
  a one-line field never runs a card's full width. A `ch` cap goes on the
  element whose font size is the text's, or on the text itself: on a 16px
  wrapper over 14px text, 68ch let About the Role run about 107 characters
  a line. Check a new cap by counting characters a line. A table or a list
  of short rows has no measure.
- **Line height comes from the token.** The tokens set 1.2 to 1.45 times
  the size, tighter as the size grows (Butterick: 120 to 145%), so a call
  site sets no
  `leading-*` on token text. A prose block of three or more lines may open
  to `leading-5` on `text-note` or `leading-6` on `text-body`.
- **Four weights, one job each** (450, 500, 600, 700): Type weights, below.

### Hierarchy

- **One h1 per view.** A screen reader lists the page by its headings
  (WCAG 2.2 SC 1.3.1 and 2.4.6; GOV.UK, "Headings"). On a section's page the
  h1 is the top bar title (`(seeker)/bar-title.tsx`); on a page under a
  section (a job, a resume, an application) the page draws its own h1 and the
  bar shows a plain line. A job or a resume drawn beside its list (the Jobs
  page's Split view) is an h2 under the list's h1. A modal never changes the
  bar title: the bar names the page behind it, and the dialog's title names
  the dialog, as its h2, with its cards' titles as h3. An h1 never
  truncates to nothing: a phone takes a shorter form of it (Home's
  greeting), with the full text as its title.
- **Heading levels go in order.** h2 follows h1 and h3 follows h2, with no
  level skipped, so the outline is true. Pick the level by the outline and
  the size by the role: `SectionHeading`'s `as` changes the level, never the
  size.
- **One primary action per view.** Two filled buttons make the student
  choose which one matters (Material 3, "Buttons": one high-emphasis
  action; Refactoring UI, "Not every button needs a background"). A view (a
  page's header, a card, a dialog) has at most one `default` Button; the
  others are `secondary` or text-only. `lg` is for the one main action of a
  page.
- **Rank with size and weight before colour.** Colour alone is a weak and
  noisy signal, and in WorkIt a colour means something (Refactoring UI,
  "Hierarchy is everything"). Make the important text larger or heavier
  first, then step it down through `ink`, `ink-muted` and `ink-meta`. Brand
  violet means "acts" or "is on", never "is important".

### Components

- **Pick a component by its role, never by its look.** A look picked by eye
  drifts from screen to screen (GOV.UK Design System; Material 3). The roles
  are:
  - Button variants (`ui/button.tsx`): `default` for the one primary action,
    `secondary` for the others beside it, `outline` for an action inside a
    recessed area, `ghost` for an inline text action, `section` for a
    section heading's action, `positive` and `decline` for an accept and
    decline pair, `destructive` for a permanent delete. A link in running
    text is `TextLink`. Sizes: "Pick a button's size by where it sits",
    below.
  - A button acts and a chip is a choice made in place: "A button is a
    rounded rectangle; a pill is a chip", below. A filter over a page's
    items is a `FieldFacet` dropdown. A choice of one among a few is a
    segmented control.
  - **One card per surface.** On a seeker page a surface is `ui/card.tsx`:
    white (`bg-panel`), `rounded-card`, the subtle border and
    `shadow-panel`, with one title style (600). A tinted block (Home's stat
    tile) is the same card with a tone, and a link that looks like a card
    is the card's link form, never a hand-built one. A card on a white
    panel takes `elevated={false}`. Inside a card, group with space or a
    hairline, not a second card (Refactoring UI, "Use fewer borders"). A
    marketing page's card is `.gloss-card` or `.glass-card`
    (`frontend/CLAUDE.md`), and an auth page's is the one `AuthCard`.
  - An icon's colour says its job: clickable is `ink`, informing is
    `ink-meta`, `brand` only when on or selected ("An icon's colour says
    its job", below). The rule has no exception for brand marks beside
    labels (Settled choices).
  - A form's buttons follow the form button placement rule, and a disabled
    control takes the grey disabled fill (KAN-550, Components, below).
- **Controls come from `ui/`.** A field, a radio, a checkbox, a pill and a
  tile come from their `ui/` part, at the part's sizes: `TextField`,
  `TextAreaField`, `SelectField`, `DateField`, CheckRow and the radio row,
  `Chip`, `Badge`. No screen builds one by hand from raw classes, and no
  field opens the browser's own picker, months included ("No field opens
  the browser's own picker", below). One toolbar uses one height (`sm` and
  `icon-sm`, 36px), and a button label never wraps. An exception is named
  here, or it is a break.
- **Every control has all its states.** A missing state reads as broken
  (Material 3, "States"; NN/g, "Visibility of system status"). A reviewer
  checks each one:
  - Hover: a fill or colour change (`hover:bg-hover`, or ink to brand).
  - Focus-visible: the solid `--color-brand-ring` ring (Accessibility, next).
  - Active: the press in `docs/motion.md` (98% for a button).
  - Disabled: the grey disabled fill; where it can, a line or a tooltip
    says why (Scout's Send stays `aria-disabled` so its tooltip shows).
  - Loading: the control keeps its width, shows that it is busy and takes no
    second click.
  - Empty: `ui/empty-state.tsx`, a title that names what will fill the space
    and an action where there is one.
  - Error: a failed load is `EmptyState`; a field error is `danger` text
    under the field, with `aria-invalid` and `aria-describedby`. A toast
    never carries an error that a form can show beside its field.
- **Every route group has `loading.tsx`, `error.tsx` and `not-found.tsx`.**
  A route with none shows nothing while it reads, and a failure falls to
  the root's page, out of its shell. A child page whose shape differs from
  its parent's gets its own `loading.tsx`, since a parent's covers its
  children. A card that reads its own data draws skeleton lines under its
  heading until it lands, so nothing pops in and moves the page. Settings'
  modal is the named exception (`frontend/CLAUDE.md`: a `loading.tsx` under
  `@modal` drew a second modal).
- **A skeleton shows no real text.** One finished line among the bars reads
  as the only thing done: "A skeleton shows no heading or line of text the
  page replaces" (`frontend/CLAUDE.md`). Skeletons are `bg-ink/6` at the
  height of what replaces them, and copy the real layout: a list loads as
  skeleton rows, never as a "Loading…" line.
- **A write that cannot be taken back asks first or offers Undo.** A
  student who slips must be able to recover (NN/g, "Preventing user
  errors"; GOV.UK, "Warning text"). A delete of the student's own content
  asks first (`DeleteResumeConfirm`), or acts at once with Undo in its
  toast (`useToast().show({ action })`, as Up Next's Remove does). A
  result the page does not show by itself is a toast, with Retry where it
  failed. A field error sits under its field, and the submit moves focus
  to the first bad field.
- **No inert or orphan UI.** A control that does nothing reads as broken.
  A control that cannot act now is disabled and says why, in a visible
  line or a tooltip (never `title` alone, which touch and keyboard never
  see); a control with no feature behind it yet is hidden. Every route has
  a link in from at least one screen before it merges, and `screens.md`
  names it. A control that shows on hover also shows at rest where touch
  can reach it.

### Design kit and tokens

- **No raw value where a token exists.** A hand-typed value cannot move
  when the token moves (Material 3, "Design tokens"). Colours are
  `--color-*`, type is the `text-*` tokens, radii are `rounded-control`,
  `rounded-card` and `rounded-shell`, shadows are `shadow-panel`,
  `shadow-lift` and `shadow-tile`, and spacing is Tailwind's 4px steps. No
  hex, no px and no arbitrary Tailwind value (`text-[13px]`, `p-[18px]`) in a
  screen. Other companies' brand marks (`components/icons.tsx`) and data that
  is itself a colour (a resume's print colours) are not tokens.
- **A shadcn piece with a WorkIt wrapper goes through the wrapper.** The
  wrapper holds WorkIt's sizes and labels: `Button`, `Badge`, `Card`,
  `TextField` and `SearchField` (not `Input`), `SelectField` (not `Select`),
  `text-area-field.tsx` (not `Textarea`), `SegmentedToggle` (not
  `ToggleGroup`), `DateField` (not `Calendar`). Import from
  `components/shadcn` only a primitive WorkIt has not wrapped: a dialog, a
  menu, a popover, a tooltip, a sheet, a table, a checkbox, a switch, a
  skeleton.
- **A new pattern gets its design kit page in the same change.** A pattern
  that only lives in one screen gets copied by eye. A new token or shared
  component gets its row on `/design-kit` (`design-kit/data.ts`); a new kind
  of pattern gets a section there (`SECTIONS`). A kit page shows every
  state of its part (rest, hover, focus-visible, disabled, loading), and its
  words say what this document says.
- **The layout values are tokens too.** A page is `max-w-dashboard` with
  one top padding (`py-6`), never `max-w-app`. Prose is `--measure-prose`
  and a form `--measure-form`, never `max-w-[68ch]` or another arbitrary
  width. A list or table in a dialog or a tile is `--spacing-scroll-box`.
  The second arbitrary value of one kind is a new token.

### Layout and spacing

- **Space is on a 4px grid.** Even steps make the rhythm read as one system
  (Material 3, "Layout": 4dp grid). Use Tailwind's whole steps: `1` (4px),
  `2`, `3`, `4`, `5`, `6`, `8`, `10`, `12`. A half step (`0.5`, `1.5`,
  `2.5`, `3.5`) only centres content inside a control.
- **Near-white ground, white cards, dark edges.** The page is `bg-app`
  (#fcfcfc), as Simplify's is, and every surface on it is `bg-panel` with a
  `border-control` edge, the edge its buttons and fields have: "The seeker
  pages stand on a near-white ground" (`frontend/CLAUDE.md`). A field on the
  ground is white with a `border-control` edge, a panel at a card's edge (the
  match rail) is white with an #e8e8e8 rule, and a grey fill (`bg-well`,
  `bg-ink/5`, never `bg-app`) sits only inside a white surface, away from
  its edge. A search bar filled with 5% ink and a `bg-well` match rail each
  blended into the old grey ground (2026-11-03). A sticky bar on the ground is `bg-app`.
- **Every seeker page has one frame.** Pages then start at the same left
  edge beside the rail. The frame is `SEEKER_GUTTER` (16px, 24px from sm,
  32px from lg), `max-w-dashboard` (1440px; the Applications Tracker has no
  cap) and 24px under the bar (`py-6`). A page breaks on its own width
  (`@container/main`, `@3xl/main:`), never the window's (`md:`).
- **Space shows what belongs together.** More space between groups than
  inside them (Gestalt proximity; Refactoring UI, "Start with too much white
  space"). Cards in a group sit 16px apart (`gap-4`, Settled choices) on
  every seeker page; groups of cards and sections sit 24px apart (`gap-6`);
  items inside a card sit 8 to 12px apart.
- **Everything starts on a shared left edge.** A ragged left edge reads as
  a mistake (Refactoring UI). Cards, the filter row and the page's content
  start at the gutter; content in a card starts at the card's padding. An
  indent shows nesting and nothing else.
- **A page's header row has a fixed order.** The student then finds the
  same control in the same place on every page. The title is in the top bar.
  Under it: the search on its own row where the page has one, then the
  filters at the left, and the view switcher (a segmented control) and the
  page's actions at the right. Narrow, the row wraps, filters first. The
  Applications Tracker and the Resumes page are the model.
- **Check each screen at 375, 768, 1024 and 1440px, with no sideways
  scroll.** Students use phones, tablets and laptops, and WCAG 2.2 SC 1.4.10
  asks for no two-way scroll down to 320px. Only a wide table scrolls
  sideways, inside its own box (the Applications Tracker).
- **Narrow widths keep what the student needs.** 375 and 1024 are the
  widths that fail most, so check those two first. At a narrow width:
  - a filter pick stays visible: a facet folded into All Filters puts its
    count on that button and in its name;
  - a table that scrolls sideways keeps its action column in view (sticky
    at the right, with an edge shadow), and its low-priority columns fold
    into the first cell below `@3xl/main`;
  - a row's name keeps at least half the row: a badge moves to the date
    line, and more than two icon actions go into a More menu below `@sm`;
  - the phone keeps the desktop's one primary action (Finish, Download,
    Apply Now) and the bar's bell;
  - a `fixed` layer (a phone bar, a sheet, a toast) renders in a portal to
    `body`, since `@container/main` is its containing block.

### Accessibility

- **Focus is always visible.** A keyboard user must see where they are
  (WCAG 2.2 SC 2.4.7 and 2.4.11). Every control draws the solid
  `--color-brand-ring` ring on `focus-visible` (6.26:1 on white, 5.75:1 on
  `app`); `outline-none` never comes without a ring. A sticky bar never
  covers a focused control (`scroll-mt-*`).
- **Every control has a name.** A screen reader reads the name, and a
  placeholder goes away while the student types (WCAG 2.2 SC 1.3.1, 2.5.3
  and 4.1.2; Luke Wroblewski, "Web Form Design"; NN/g, "Placeholders in form
  fields are harmful"). A field has a visible label (`TextField` and
  `SelectField` require one; `hideLabel` only where a visible heading names
  it), and an icon-only button is `IconButton`, whose `label` is required.
- **Targets are 24px or more, and 44px on touch.** Small targets cause
  missed taps (WCAG 2.2 SC 2.5.8: 24 by 24px; Apple HIG: 44pt; Material 3:
  48dp). The `ui/` part sets the hit area, never the call site: a small
  glyph widens its target with an `::after`, as `IconButton` and the
  `inline` Button do, never by a larger box, so the desktop look stays.
  Under `pointer: coarse`, each target is 44px; a link alone on its row is
  a target, and only a link inside a sentence may be shorter.
- **Keyboard order follows reading order.** Tab must go where the eye goes
  (WCAG 2.2 SC 2.1.1 and 2.4.3). No positive `tabindex`. A group of options
  is one tab stop with arrow keys (`SegmentedToggle`, menus). Esc closes a
  dialog or a menu, and focus goes back to what opened it.
- **Colour is never the only signal.** About 1 in 12 men see some colours
  as alike (WCAG 2.2 SC 1.4.1). A stage carries its glyph as well as its
  colour; a match score carries its number; a link in running text is
  underlined.
- **Marketing pages have a skip link and a pause control.** A "Skip to
  Content" link is the first stop, and the looping animations can be
  paused (WCAG 2.2 SC 2.4.1 and 2.2.2, level A). They ship no placeholder
  art: a visual column with no art yet is dropped.

### Dialogs

- **Never a dialog over a dialog.** A second layer reads as a page laid
  over a page (KAN-429). A pick or a form that opens from a dialog is a
  step of that dialog, with a Back arrow beside its title ("Never a dialog
  over a dialog", below). Only a one-line confirm may open over a dialog.
- **A dialog keeps a 16px margin at every width**, and its scrolling part
  keeps `scrollbar-gutter: stable`, so its width never jumps when a
  scrollbar shows.
- **A dialog's backdrop dims and blurs 4px; a panel from the right only
  dims** ("A panel from the right floats", below). A dialog that leads the
  student through steps over a busy page (Tailor's Your Resume Is Ready)
  sets `data-backdrop="strong"` on its `DialogContent` for a 55% ink dim
  (`globals.css`), so the page behind stops competing with the steps.
- **A dialog of steps makes the next step its primary**, and moves the
  primary and focus on as each step is done (Your Resume Is Ready's
  Download PDF, then Open the Application).
- **A dialog's buttons sit right, the primary last**, and its close
  button is `ink`, with a 44px target on touch. Its field errors follow
  the form rule: under the field, with focus on the first bad one.

### Copy

- **Title Case for names, sentence case for sentences**: Conventions in
  `frontend/CLAUDE.md`, which lists what takes which.
- **Plain words.** Students scan; they do not read every word (NN/g, "How
  users read on the web"; GOV.UK, "Writing for user interfaces"). A button
  names its action with a verb ("Save Entry", never "OK" or "Submit"). An
  error says what went wrong and what to do next. Put the key word first.
  Use the job terms from the root `CLAUDE.md` (a hiring system, never an
  ATS) and one name for one thing on every screen.
- **One meaning per label.** Two fields on one flow never share a title, a
  label says "Optional" once per step when every field is optional, and an
  exit names what it does ("Skip" moves one step; "Skip Setup" leaves).
  On the Jobs screens a posting is a "job" or "job posting", never a
  "role", tooltips and counts included. Labels are Title Case, tooltips
  too, in US spelling. A public page that looks like the app (a marketing
  card, a coming-soon page) follows the same copy rules.

### Settled choices

Four choices the audits left open, settled on 2026-11-03 (KAN-565). Other
rules here follow them; change one only with the user.

- **Cards in a group are 16px apart** (`gap-4`), not 20px: the existing
  spacing rule, Home's gap, and a step of the 4px grid that matches the
  `gap-6` between groups. My Profile's and Auto Apply's `gap-5` moves to it.
- **The prose measure is 68ch**, as `--measure-prose`, with
  `--measure-form` at 48rem (`max-w-3xl`'s width) for a single-column form.
  68ch is About the Role's measure today and sits inside Baymard's 50 to 75.
- **A wizard footer is a third kind of form** (Components, "A form's
  buttons sit by what kind of form it is"): Back on the left, the one
  forward button on the right.
- **The icon colour rule has no Experiences exception.** A glyph beside a
  label only informs, so it is `ink-meta`; `brand` stays for on or
  selected. The Experiences page's group marks (Colour, below) move to
  `ink-meta` with the rest.

### Still open

Breaks found on 2026-11-02, while these rules were written. The design
audits (`design-audit/`, one report per area) add to this list.

- `ink-faint` carries words: onboarding's Role step prints "Optional" in it
  (3.11:1), and the Calendar's Month prints the days outside the month in it
  (`calendar/month.tsx`). Both need `ink-meta`.
- `ink-subtle` (2.95:1, under 3:1) on glyphs that inform: the stat tile's
  icon (`components/stat-tile.tsx`) and the company range picker's chevron.
  The icon rule makes them `ink-meta`.
- Text under 11px: the score in onboarding's showcase ring is `text-[10px]`
  (`onboarding/applicant/showcase.tsx`).
- `text-area-field.tsx` prints its hint, which can be a sentence, at
  `text-meta` (11px); it moves to `text-note`. `--text-meta`'s comment in
  `globals.css` still names helper copy.
- An arbitrary size where a token exists: the phone editor's sheet sets
  `text-[16px]` (`resumes/[resumeId]/phone.tsx`), which is `text-base`.
- Disabled controls on `main` still fade to `opacity-50` (Button, Chip,
  IconButton, the fields) until KAN-550's grey disabled fill reaches them.
- Touch targets under 44px below md: an `sm` Button and a Chip are 36px, a
  `quiet` IconButton's target is 32px, and the Calendar's day buttons are
  24px.
- A wrapper skipped: the company table imports shadcn's `Input`.
- Off the grid: `Card`'s `md` padding is 18px (`p-4.5`), as measured from
  the mockup.
- No token for the measures yet: `--measure-prose` (68ch) and
  `--measure-form` (48rem) are settled but not in `globals.css`. About the
  Role, the company tab and Written Answers each write `max-w-[68ch]`, and
  About the Role's sits on a 16px wrapper over 14px text.

Found by the design audit of 2026-11-03. Its tickets sit under Epic
KAN-553 (KAN-554 to KAN-582), and each one removes its line here when it
lands. These have no ticket of their own yet:

- The Experiences page's group marks are `text-brand`
  (`experiences/bank-screen.tsx`), against the icon rule's settled choice.
- Up Next's Resume cell is a hand-built bordered pill that acts, and the
  row's status is a hand-built text button (`auto-apply/queue-table.tsx`).
  The Resume cell becomes a `Button` (`outline`, `sm`) and the status the
  `section` variant: no pill that acts is added to the exceptions.
- The Experiences entry editor's Start and End are native month inputs
  (`experiences/entry-editor.tsx`), waiting on KAN-559's `MonthField`.
- My Profile's Contact & Links draws a 20px `brand` glyph and a 700 label
  beside each field; the icon rule makes the glyph `ink-meta` and the
  label 600 (KAN-571).
- A card's title is 600 (Type weights), but `text-title`, the
  `SectionHeading` size, carries 700; KAN-558 sets the one card title.
- `ChoiceTile` still lives in the onboarding route, with off-grid values
  (`rounded-[5px]`, `size-4.5`); it moves to `components/ui/` (KAN-559).
- The design kit still says what these rules replace, until KAN-564 and
  KAN-555 correct it: `--text-meta` is "Dates, file meta, helper copy"
  and `--color-ink-subtle` is "stat tiles, a picker's chevron"
  (`design-kit/data.ts`), `Chip size="lg"` is "onboarding's answers"
  (`design-kit/buttons/page.tsx`), and the Home tiles have "no outline".

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
lavender corner cell (`components/sidebar-brand.tsx`, company only now; the
mark alone below md) over a full-bleed panel. `app-sidebar.tsx` draws both, as `variant="rail"` or
the default `docked`. Their other shared parts (the bell, the account menu,
the search field) are in `src/components`. The company bar's search is a GET
`next/form` to `/company/applicants`. **The seeker bar has no search: it holds
the page's title** (`(seeker)/bar-title.tsx`, 2026-11-02). Job search showed on
every page there, so it moved to the Jobs page and /search
(`(seeker)/search/job-search.tsx`), and each page's heading and description went:
the title moved up, and the description is gone, to give every page about 60px.
Pages add no heading or description of their own under the bar. The bar
title is the view's one h1; a job beside the list (the split view) is an h2
under it, and a modal never changes it (KAN-560). The field is
`(seeker)/search/query-field.tsx`, a client component that shows `?q` while on
/search, because the split frame is drawn by a layout, which never receives
searchParams.

**The company shell follows the seeker's page decisions** (2026-11-03,
KAN-582): the 2026-10-27 width and the 2026-11-02 title and grey ground.
Its pages stop at `max-w-dashboard` inside the seeker's gutter
(`company/frame.ts`, `COMPANY_PAGE`, which reads `SEEKER_GUTTER`), so they
start at the page's left edge beside the panel; at the centred 1024px
`max-w-app` they left 80px of empty margin each side at 1440 with the panel
pinned, the layout the user ruled flawed for the seeker. The bar holds the
page's title (`company/bar-title.tsx`, the seeker's `BAR_TITLE`), on the
left, with the applicant search after it, and no company page draws a heading
or description of its own; a page under a section (a job, the editor, an
applicant) keeps its own h1, as on the seeker side. The page stands on the
grey ground, its sections in white cards. What still differs, until the user
decides: the company panel docks, pins and opens on hover where the seeker's
is a fixed rail, and the bar keeps its lavender corner cell and its applicant
search.

Seeker pages break on the width they actually get, not the window's: the
shell renders them inside `@container/main`. A layout that splits into
columns uses `@3xl/main:` and friends, and a card that rearranges itself
(the job card) is its own `@container`. A container is a containing block,
so a `fixed` layer inside a page is fixed to the page area, not the window:
a layer that covers the window renders in a portal to `<body>` (the phone
editor sat 64px low, its bottom bar off screen, until KAN-574). Scout's panel takes room beside the
page when open, and the page fits itself to what is left. **The panel never
changes the page's width**: it is a fixed rail. One exception: below xl
the resume editor's panel (Format Options, Sections, Experiences, Cut From
Resume, its assistant) floats over the page instead (`ScoutTakeover`'s
`float`, KAN-576), as Tailor's review's column does below `@6xl/main`,
since there the page is the work: docked at 1024, the resume drew 414px
wide with about 4px text. Until 2026-10-27 it
collapsed and opened, and a `--panel-gain` length (with its readers on
Applications, Tailor and the job rail) kept each page at its open-panel
width through the move; that went with the collapse. Applications has no
width cap (KAN-256): its list is a table that scrolls sideways, so more
width only shows more columns. **Every other seeker page stops at
`max-w-dashboard` (1440px)**, Home's cap, so all of them start at the same
left edge beside the rail (2026-10-27): at the old 1024px `max-w-app` they
sat centred between wide empty margins once the rail freed the room, which
the user found flawed. A block of prose keeps its own measure (About the
Role's 46ch), since text past about 75 characters a line is hard to follow.
**A `ch` cap goes on the element that has the text's own size** (KAN-569):
`ch` is read from that element's font, and About the Role's 68ch sat on a
16px wrapper over 14px text, so its lines ran about 107 characters. Plus
Jakarta Sans draws "0", which `ch` measures, at 0.73em, wider than its
average letter: at 14px, 46ch prints 64 to 71 characters a line and 60ch
about 90. Measure a new cap in characters a line (45 to 75). On Applications and
the Calendar the segmented control sits at the top right of the header
wherever it fits beside the title, the title wrapping first (below
`@3xl/main` the Calendar puts it at the start of its second row, KAN-578); Home's range
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
navigation, so it never covers the page and never moves it. Each section has
one name, short enough for the 72px tile (Tracker, Resumes, Profile), and
the phone's sheet shows the same one: until 2026-11-05 the sheet showed
longer names ("Applications Tracker"), two sets for one app. Page titles,
the bar's title and Back links use the same names. The rail's icons draw a
lighter line than the app's other icons (about 1.7px against 2px), which
read heavy at 24px. The logo is the mark alone, in a 64px header. The
profile strength card is a ring tile named Setup there. Below md it is
shadcn's sheet, with an icon beside each full name. `RailSidebarProvider`
(`app-sidebar.tsx`) holds shadcn's provider open, so the bar's toggle shows
below md only and opens the sheet. **The phone bar holds the toggle, the
title, the bell and the photo** (KAN-570): the logo is in the sheet's
header only, since with the mark in the bar there was no room for the bell,
and the bell was hidden below sm. The sheet is named "Menu", its toggle
"Open Menu" and the sheet's own toggle "Close Menu", over shadcn's
"Sidebar" and "Toggle Sidebar" (`docs/shadcn.md`). It replaced a 256px panel that pinned or
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
`notifications-menu.tsx` (the bell, a popover of its notifications, each a
`Link` with IconButton's focus ring and its time, or an empty state) and
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
The company Dashboard moved to cards in KAN-582: on /company each section is
a white card on the grey ground (the KPI tiles with the date picker, the
chart, Highlights, the Hiring Pipeline, Needs Your Attention, Time in Stage)
beside one violet Most Urgent hero, and the Recent Applicants table keeps its
heading on the ground over its own card, as the company's other tables do.
Until then it used open sections on white and a grey Hiring Pipeline band,
the reverse of the seeker's grey ground and white cards. The company hero
draws `components/hero-arcs.tsx`. A section's one way onward sits
at the top right of its heading: `ui/section-link.tsx` for a link, `<Button
variant="section">` for an action. A page's own action with no heading to sit
beside (Post a Job, Edit Profile) sits at the top right of the page. Each
page's docblock says what goes where.

The auth screens (/login, /signup, the two reset pages under /login,
/signup/check-email and /signup/choose-account-type) sit outside both shells.
Each is one card, `components/auth-card.tsx` (KAN-573): the logo, the h1, a
subtitle, the page's body and a line of links under it, 360px wide
(`max-w-auth`) on every screen, and each page exports its own `metadata`. A
new auth page imports it and never copies its strings: six copies drifted
until KAN-573, /signup 576px wide and /login 360px. The card sits alone over
a skyline (`components/skyline.tsx`):
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
page's group labels and marks use the pair (KAN-440); a mark there only
informs, so the icon colour rule makes it `ink-meta` (Settled choices; Still
open until it moves). Keep a reading's own
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
`--color-updates`. **Every band keeps its colour, Weak included**
(2026-11-03). KAN-569 drew Weak in neutral ink while the cut-offs in
`lib/match.ts` are placeholders, since every card on the Jobs page scored
under 65 and all 50 drew a red ring. The user brought red back: a black ring
read as a fault rather than a score.

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

**Then the ground went near white and the card edges went light**
(2026-11-03). The user still found the signed-in app muted beside Simplify.
Measured on simplify.jobs, its page is #fcfcfc and its card and button
edges #e8e8e8: lighter than WorkIt's #d6dbe4, not darker. What made
WorkIt's cards look muted was the #f5f5f5 ground under them. So `app` and
`canvas` are #fcfcfc, `border` and `border-subtle` are #e8e8e8 (neutral,
not blue-grey), and `well` took the old ground's #f5f5f5 for the grey
fills inside white surfaces that had used `bg-app`.

**Then cards took the control edge** (2026-11-03, the same day). With
buttons dark-edged and cards in #e8e8e8, the user found the Jobs page's
cards and sections did not match its buttons. So `Card`'s outline (every
seeker card, KAN-558) and each hand-drawn page-level surface (the calendar
frame, the company table, the auth card, the onboarding step cards) take
`border-control`. Only the outer edge: the rules inside a card and a box
nested in one (the match rail's divider, Key Requirements, a dialog's list)
keep `border-subtle`. Setting `--color-border-subtle` itself to the dark
grey was tried first and rejected, because the rules went dark too and
every card read as a heavy box. Home's tiles (`tone="tile"`) keep their
shadow and no outline (KAN-173). A link card's hover darkens its edge to
`ink-meta`.

**A control's edge is `--color-border-control`; a rule is decoration only**
(KAN-556). Any edge, ring or dash that marks a control or a state (a
field, the search pill, the segmented track, an empty checkbox or radio, a
table cell's button, the timeline's step still ahead, an empty slot, the
upload dropzone) takes `border-control`: 3.37:1 on white, 3.29:1 on the
ground and 3.09:1 on `well`, so it meets WCAG 1.4.11's 3:1 on each.
`--color-border`, `--color-border-subtle` and `--color-border-strong` are
1.2:1 to 1.5:1, so they draw only what nothing depends on: a rule inside a
card, a box nested in one, a score ring's empty track. A card's outline is
`border-control` for the look, not for contrast (below). The search pill and the segmented track
had no outline, a 5% ink wash chosen for a white page, and fell to 1.1:1 once
the seeker pages stood on grey (#f5f5f5, until 2026-11-03). shadcn's `--input` maps to `border-control`
too, so its checkboxes, fields and the switch's off track follow.

**Every outlined control takes the same edge, buttons included**
(2026-11-03). A `secondary` Button, an `outline` IconButton, an unpressed
choice Chip and the signup tiles are drawn in `border-control`, as the
search pill and the fields are. A labelled button does not need a 3:1 edge
under WCAG 1.4.11, since its words say what it is; it takes one so that a
toolbar reads as one set. The Jobs page's search pill sat in a dark edge
over a row of filter buttons in `border-subtle`, and the user saw the two
as a mismatch. Cards then took the same edge (above), so an outer edge on
the page is dark and a rule or a nested box is light. A choice Chip's hover darkens
its edge to `ink-meta`, as the search pill's does; a Button's hover keeps
its `hover` fill.

**The seeker shell is ruled in the control edge too** (2026-11-03): the top
bar's rule and the rail's edge are `border-control`, tried and kept, so the
frame matches the cards, the split panel and the buttons on it. The company
shell keeps its lavender `rail-border`, since its docked panel is lavender;
the phone's menu sheet keeps its light rule.

**A separator dot is round** (2026-11-03). Plus Jakarta Sans draws "·"
(U+00B7) as a square, the same as its full stop, and the user found the
square dots between a job's facts odd. `--font-sans` starts with "Round
Dot", an `@font-face` in `globals.css` that takes U+00B7 alone from Georgia
(or Helvetica Neue): round, and centred at Jakarta's height. Keep writing
"·" in text; never draw a dot with markup or swap in "•", which is about
three times the size.

**The match score pill takes the control edge** (2026-11-03): it is to open a
modal that explains the score, so `MatchBadge` is edged in `border-control`,
as a button is.

**Rules meet in a T, never a "+"** (2026-11-03). Where a column's edge meets a
row's rule, one of them stops at the other. The rail's logo header has no
rule, so the rail's edge runs the window's height and the top bar's rule stops
at it; the company bar rules only its second cell from md, so the panel's edge
runs up through the lavender corner; the split view's list heading has no
rule, so the job's action bar rule stops at the list's edge. Each had a rule
lined up with its neighbour's "as one line across", and each crossed a column's
edge in a "+" that the user found busy. A table's grid (the calendar's week)
is the exception.

**A purple edge is solid brand, and only on what is on or selected**
(2026-11-03). A selected card, a pressed chip or tile, a filter in use, a
`Button` `outline` and a suggestion Chip are edged in `border-brand`, and an
on state fills with `bg-brand-tint`, as the open job in the split view and a
pressed Chip are. A filter in use was edged in `brand/50` over `brand/10`
beside the open job's solid brand edge, and the user saw the light purple as
the weaker of two looks for one meaning. A hover is never purple: a card or a
dropzone that answers the pointer darkens its edge to `ink-meta`, as a link
`Card` and a Chip do. It was `brand/40`, a pale purple that, over the dark
control edge, made the edge lighter on hover. Tints that are not a state (a
stage's panel, the phone editor's bars, a dashed note) keep their pale edge.

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

**Contrast holds on white and on `well`** (KAN-555): a word 4.5:1, a
live glyph or a chart mark 3:1, measured on `--color-well` (#f5f5f5, the
darkest surface words sit on, and the page ground until 2026-11-03) as well
as on white.
So words and live arrows (a sort chevron, a dropdown's arrow, "Optional") are
`ink-meta` or darker; `ink-faint` (2.85:1 on grey) and `ink-subtle` (2.95:1 on
white) are for disabled or decorative glyphs only. `--color-positive` (2.80:1)
never sits under a word or a white glyph: the green button, done discs and the
match rail's tick take `positive-ink`. Glyphs on the bright amber
(`warning-fill`) are `ink`; a white glyph needs `warning-strong` (3.19:1) or
deeper. The
chart slots clear 3:1 on both grounds; `globals.css` has the numbers.
grey is what says which option is on. There is no other exception: a brand
mark beside a label only informs, so it is `ink-meta` (Settled choices).

**A form's buttons sit by what kind of form it is** (2026-11-03). Three
rules, each with its own reason, and every form follows one of them:

- **A page or Settings form: left, the primary first** (Save, then Discard).
  The eye runs down a single-column form's left edge, so a button there is
  found first (Luke Wroblewski's form studies; the GOV.UK Design System).
  Settings' sections pin this row to the foot of what scrolls. A multi-step
  form is a page form too: the company job composer leads with its step's
  primary (Continue, Publish or Update Job), then Save Draft, Back and
  Cancel (KAN-582; it was right-aligned with the primary last).
- **A dialog, or a card edited in place: right, the primary last** (Cancel,
  then Save). The last button is where the task goes on, as on macOS and in
  Material, and shadcn's `DialogFooter` already sets it. My Profile's Contact
  & Links, Application Info's cards and the Experiences entry editor are
  this kind.
- **A wizard: Back on the left, the one forward button on the right**,
  pinned to the foot (KAN-565). Each step moves on, so the forward button
  sits where the next step comes from, and Back stays apart from it.
  Onboarding's footer is this kind. A skip is `variant="section"` beside
  the forward button. The footer holds buttons only: an error, a hint or
  why Next is off goes above it, full width, as the sign-in pages' error
  banner.

Nielsen Norman Group's finding is that either order works and mixing them on
like screens costs the user, so a new form takes its kind's rule. **A
disabled Save is grey** (`ui/button.tsx`, DISABLED_FILL): a faded brand fill
read as lavender, a picked state. **A lesser action beside a button is muted
ink** (`variant="section"`), never brand text: Settings' Remove Photo was
brand-coloured beside Change Photo and drew the eye from Save.

**A control that is not built yet says so** (KAN-569): `soon` on
`ui/icon-button.tsx` fades it to `ink-subtle`, drops its hover and press, and
ignores its click, while it still takes the pointer and focus, so its tooltip
and its name say "Coming Soon". A disabled button shows no tooltip, so a
faded Ask Scout said nothing about why, and Not Interested, which stores
nothing, kept live hover and press states. **A link inside text is
underlined** (KAN-569): brand against ink is about 2.8:1, so colour alone
is no cue (the Company tab's Source links, About the Role's full-posting
link).

**One scrollbar** (`globals.css`): a 4px thumb on no track, shown while the
pointer is over what it scrolls. Style it there, never per element.

`components/save-button.tsx` is the one Save control on every job surface.

**Every short "this happened" message is a toast** (`components/ui/toast.tsx`):
`useToast().show({ message, action? })` from any page, or `actions` for two
side by side (Save's View and Undo), since one
`<ToastProvider>` sits in the root layout beside the tooltips'. A toast is the
inverted surface (`bg-inverse`, `text-on-inverse`, `--shadow-lift`, the card
radius, KAN-217) in the window's bottom right corner: dark on the light app,
so it stands out from every white card. It was a white card until the user
missed one. Body text, its actions as `inverse` buttons (light, with a
light edge), and an `inverse` cross. Read the two tokens, never ink and
panel, so a dark theme turns it light by setting them. It stays 5 seconds,
8 with an action (`TOAST_ACTION_DURATION`: at 5 the user missed Save's
Undo), paused while the pointer or focus is on it, so an Undo is never lost
mid-reach; at most three show, newest nearest the corner. An action that
goes somewhere (View) is a button beside the others, never a link in the
message: a link beside a button read as two kinds of thing. The provider holds them, so a toast
outlives the part that raised it (a row that a refresh removes). Use one for
a result the page does not show by itself, never for an error a form can
show beside its field. **A write the student can't take back offers Undo in
its toast, or asks first** (KAN-562). Where Undo can write the old value
back, the write goes at once (a writing sample is added again). Where it
can't (a deleted file), the write waits for the toast's `onClose`, which
runs once it is gone without its action, so Undo is the write never sent.
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
`src`, so a search for `type="date"` or `type="time"` finds a regression.
The rule holds for months too: the Experiences entry editor's Start and End
are still `type="month"` (Still open), and a `MonthField` on the `DateField`
pattern replaces them.

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

**A form opened from a dialog is a step of it too** (KAN-563). In the
Settings modal a row's form (Change Email, Change Password, Delete
Account) takes the section's place as a card with Back beside its title
(`(seeker)/settings/settings-step.tsx`); Back, Cancel, Escape or the nav
return to the section, with its scroll and focus as they were, and the
section stays mounted under the step. The form's buttons follow a
Settings form's rule (left, the primary first). **The one thing that may
sit inside a dialog is a one-line confirm, and it is a bar, not a
dialog**: Settings' "Discard Your Changes?" runs across the modal's foot
with Keep Editing (which takes the focus) and Discard Changes, and Escape
or a click outside answers Keep Editing. All four opened as dialogs over
the modal until then; Base UI does not dim a nested dialog, so each sat
over the card behind it with no edge of its own.

**A dialog keeps 16px from the window at every width, and what scrolls in
it keeps its scrollbar's room.** Both are `data-slot` rules in
`globals.css`, so the vendored dialog stays as generated: the width
carries the margin (a call site's `sm:max-w-*` had replaced the vendored
one, and the Settings modal stood flush with both edges at 768), and a
`data-slot="dialog-scroller"` box takes `scrollbar-gutter: stable` (the
Settings cards were 608px wide on one section and 600px on the next).

**A field's error sits under its field and takes the focus** (KAN-563):
the error names itself to the field through `aria-describedby`, an input
is outlined red (`aria-invalid`), and the focus moves to the first field
that needs a fix, in the form's order (Create Event's Application and
Date, Change Email, Change Password's three fields). An error about the
whole form (the API's answer) stays at the form's foot as an alert.
`DateField` takes `error` for this. Create Event's errors were one line
at the dialog's foot, tied to no field, and the focus stayed on the
button.

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
**No overlay blurs, a dialog's included** (KAN-563): every overlay is the
same light dim over a sharp page. The vendored dialog's `backdrop-blur-xs`
is turned off by a `data-slot` rule in `globals.css`; it hid what a dialog
is about too, as All Filters' list under it.
about. The application detail panel (the Calendar's) is the modal one; the
resume editor's panels float the same way below xl with no dim, since the
page under them still works (KAN-576).

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
with them. **A button's label never wraps** (KAN-572): the base is
`whitespace-nowrap`, as a chip's is, so a button keeps its size's height;
where a row cannot hold its buttons, the row wraps.
There is exactly one Chip, `ui/chip.tsx`, at two sizes: `default` (36px, an
sm button's height, so they line up in a row) and `lg` (42px, a default
button's and a text field's height, 16px type) for a row of short picks on a
screen built around them (onboarding's Salary presets). A fixed answer on
onboarding's steps is a `ChoiceTile` (`ui/choice-tile.tsx`), a full-width
tile with a box or a dot, not a chip. Its roles: `choice` with `pressed` for filters and
button's and a text field's height, 16px type) for a screen where the chips
are the question itself: onboarding's Salary presets. Every other answer on
onboarding's one-question steps is a `ChoiceTile`
(`app/onboarding/applicant/choice-tile.tsx`, a box for any-of, a dot for
one-of), a tile, not a chip. Its roles: `choice` with `pressed` for filters and
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
its role, and every state of each button, chip and icon button.

**Every control's kit row shows its states** (KAN-564): rest, hover,
focus-visible, disabled and, for a button, busy (disabled, its label saying
what is happening, "Saving…", with no spinner); a field shows empty, filled,
focus, invalid and disabled instead, since it has no hover look. A change
that adds or alters a state edits the kit row in the same change.

Tailwind v4 is configured entirely in `src/app/globals.css` via `@theme static`
— there is no `tailwind.config.js`. Add design tokens there. The file also
records two open questions for whoever owns the mockups: the login and app
screens disagree about which hex is a page and which is a card, and the board's
grey "Applied" chip may or may not be a second chip token.
