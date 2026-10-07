/**
 * What the design kit renders.
 *
 * Only names and prose live here. No hex values, no rem measurements: the page
 * resolves every token from the live stylesheet at runtime, so this file cannot
 * drift out of step with globals.css the way a mirrored table would. Adding a
 * token means adding one row here; changing its value means touching only
 * globals.css.
 */

/**
 * The kit's sections, in the order the nav lists them.
 *
 * Title and note live here rather than in each page so the nav and the page
 * heading cannot say different things about the same section. A page spreads
 * its own entry into <KitPage>.
 */
export const SECTIONS = {
  colour: {
    slug: "colour",
    title: "Colour",
    note: "Swatches paint var(--token) directly and the value beside each is read back from the live stylesheet, so neither can drift from globals.css.",
  },
  type: {
    slug: "type",
    title: "Type",
    note: "One typeface, Geist, with Geist Mono for code. Weight and letter-spacing are baked into each token, so a caption cannot be used without its tracking. Two sizes are both 11px: caption carries uppercase tracking and weight 600, meta carries neither. shadcn's stock sizes resolve to this scale too.",
  },
  shape: {
    slug: "shape",
    title: "Shape and Elevation",
    note: "Three radii, three shadows and two content widths. WorkIt's own; stock Tailwind's rounded-sm/md/lg keep their default values, which is what existing call sites were measured against.",
  },
  motion: {
    slug: "motion",
    title: "Motion",
    note: "Three curves, the animations built on them, and the view transitions pages and views change through. Every specimen replays on demand. Under reduced motion all of it completes at once, so the replays land instantly.",
  },
  buttons: {
    slug: "buttons",
    title: "Buttons",
    note: "One component, shadcn's variant and size names, WorkIt's measured styling. Each variant has a natural size, so most call sites pass only a variant.",
  },
  forms: {
    slug: "forms",
    title: "Form Controls",
    note: "Every control that takes input, at the width it is used rather than full-bleed.",
  },
  display: {
    slug: "display",
    title: "Display",
    note: "Everything that shows a value without accepting one. The status rows render from the same maps the company tables read, so they cannot drift from what the app paints.",
  },
  shell: {
    slug: "shell",
    title: "Shell",
    note: "The pieces both bars are built from: the logo, the bell and the account menu. The left panel itself (AppSidebar, SidebarBrand) needs a shell's SidebarProvider, so the shells are its specimen, and the auth screens are the specimen for their own parts.",
  },
  vendored: {
    slug: "vendored",
    title: "Vendored",
    note: "Pulled in with `npx shadcn add` and not restyled. They look like WorkIt because globals.css maps shadcn's colour roles and stock text sizes onto WorkIt's tokens, and because they compose against the same Button as everything above.",
  },
} as const;

export const SECTION_ORDER = [
  SECTIONS.colour,
  SECTIONS.type,
  SECTIONS.shape,
  SECTIONS.motion,
  SECTIONS.buttons,
  SECTIONS.forms,
  SECTIONS.display,
  SECTIONS.shell,
  SECTIONS.vendored,
];

export type ColorToken = { token: string; role: string };
export type ColorGroup = { title: string; note?: string; tokens: ColorToken[] };

export const COLOR_GROUPS: ColorGroup[] = [
  {
    title: "Surfaces",
    note: "Login and the app shell disagree about which hex is a page and which is a card, so both scales exist side by side until a designer reconciles them. Every one is a pure grey: the blue casts they were sampled with are gone.",
    tokens: [
      { token: "--color-canvas", role: "Login page ground" },
      { token: "--color-surface", role: "Login card, and every field fill" },
      { token: "--color-surface-tint", role: "Logo tile, subtle fills" },
      { token: "--color-app", role: "Home and design kit ground; uploaded-file row" },
      { token: "--color-panel", role: "Top bar and cards" },
      { token: "--color-well", role: "Recessed area — the resume dropzone" },
      { token: "--color-frame", role: "Seeker shell ground, under its floating panels" },
    ],
  },
  {
    title: "Interaction",
    note: "What a control is painted while you are on it. Grey, not brand: being hovered does not mean anything, and the shell keeps colour for things that do.",
    tokens: [
      { token: "--color-hover", role: "Row or control under the pointer" },
      { token: "--color-selected", role: "Current nav item, chosen option" },
    ],
  },
  {
    title: "Rail",
    note: "The left panel's lavender. The company shell paints its docked panel and the bar's corner cell in it, so the two read as one frame around the white page. The seeker's floating panel is white and keeps only the border. Hover and current rows are lavender too, where the grey Interaction pair would read as smudges on a coloured panel.",
    tokens: [
      { token: "--color-rail", role: "Company panel and its corner cell" },
      { token: "--color-rail-hover", role: "Row under the pointer on the rail" },
      { token: "--color-rail-selected", role: "Current nav row in both shells" },
      { token: "--color-rail-border", role: "Rail edge, and the seeker panel's outline" },
    ],
  },
  {
    title: "Ink",
    tokens: [
      { token: "--color-ink", role: "Headings" },
      { token: "--color-ink-muted", role: "Body copy, field labels" },
      { token: "--color-ink-meta", role: "Nav links, subtitles, dates, glyphs, placeholders" },
      { token: "--color-ink-subtle", role: "De-emphasised glyphs: stat tiles, a picker's chevron" },
      { token: "--color-ink-faint", role: "Separator dots, bullets, resting sort chevrons" },
    ],
  },
  {
    title: "Brand",
    tokens: [
      { token: "--color-brand", role: "Primary fill and links" },
      { token: "--color-on-brand", role: "Label on a brand fill" },
      { token: "--color-brand-hover", role: "Derived — 43% lightness" },
      { token: "--color-brand-active", role: "Derived — 36% lightness" },
      { token: "--color-brand-tint", role: "Skill pills, badges, avatars, tiles" },
      { token: "--color-brand-ink", role: "Brand as text on a grey fill — AA safe" },
      { token: "--color-brand-pale", role: "Accent on a saved card" },
      { token: "--color-brand-ring", role: "Focus ring: the brand itself, 6.26:1 on white" },
    ],
  },
  {
    title: "Status",
    note: "The board's only non-brand control is accepting an offer. The chip tones below it say what KIND of state something is in — in flight, finished well, halted, finished badly, over — so two states never share a colour unless they are the same kind of thing.",
    tokens: [
      { token: "--color-positive", role: "Offer accent and its green button" },
      { token: "--color-positive-tint", role: "The offer card's company tile" },
      { token: "--color-positive-hover", role: "Derived — 33% lightness" },
      { token: "--color-positive-active", role: "Derived — 27% lightness" },
      {
        token: "--color-positive-ring",
        role: "Focus ring on a positive fill: positive-ink, 5.35:1",
      },
      { token: "--color-positive-ink", role: "Positive as text on its tint — AA safe" },
      { token: "--color-inert-tint", role: "Measured — a status that is over or not begun" },
      { token: "--color-warning", role: "UNMEASURED — halted, waiting on a decision" },
      { token: "--color-warning-tint", role: "UNMEASURED" },
      {
        token: "--color-warning-fill",
        role: "Amber as a bar or dot, never text or a glyph's ground",
      },
      { token: "--color-warning-strong", role: "Interviewing's fill, white glyph at 3.19:1" },
      { token: "--color-danger", role: "UNMEASURED — ended badly" },
      { token: "--color-danger-tint", role: "UNMEASURED" },
      { token: "--color-advanced", role: "UNMEASURED — in flight, late (Interview)" },
      { token: "--color-advanced-tint", role: "UNMEASURED" },
    ],
  },
  {
    title: "Charts",
    note: "Not a separate palette — the status tones above, in a fixed order, so a stage is one colour whether it is drawn as a pill or as a bar. The order never changes and is not a rank: a filter that drops a series must not repaint the survivors. Four identities is the ceiling, because --color-warning against --color-danger measures 4.8 under deuteranopia and the two are one colour to a red-green colourblind reader. Slot 5 is the de-emphasis grey rather than a fifth hue.",
    tokens: [
      { token: "--chart-1", role: "→ --color-brand · in flight, early (Screening)" },
      { token: "--chart-2", role: "→ --color-advanced · in flight, late (Interview)" },
      { token: "--chart-3", role: "→ --color-positive · ended well (Offer)" },
      { token: "--chart-4", role: "→ --color-danger · ended badly (Rejected)" },
      { token: "--chart-5", role: "→ --color-ink-subtle · inert, Other, de-emphasis" },
    ],
  },
  {
    title: "Match",
    note: "The bands a match score is read in, from @/lib/match: the ring on a board card's badge, the arc and dot on a job's match rail, and the bar on the company Dashboard's Recent Applicants. One magenta ramp, deeper for a better match, in a hue no stage, status or brand colour uses, so a score never reads as where an application stands. Strokes, dots and bars only, never text: the tier's words stay ink-muted. Every step clears 3:1 on white and on --color-well.",
    tokens: [
      {
        token: "--color-match-excellent",
        role: "Excellent Match, the deepest step · 9.73:1 on white",
      },
      { token: "--color-match-strong", role: "Strong Match · 6.98:1 on white" },
      { token: "--color-match-good", role: "Good Match · 4.95:1 on white" },
      { token: "--color-match-weak", role: "Weak Match, the lightest step · 3.45:1 on white" },
    ],
  },
  {
    title: "Borders",
    tokens: [
      { token: "--color-border", role: "Card outline" },
      { token: "--color-border-subtle", role: "Secondary buttons, rules" },
      {
        token: "--color-border-control",
        role: "Form field outline: 3.05:1 on surface, 3.24:1 on panel (the search pill has none)",
      },
      { token: "--color-border-strong", role: "Dashed dropzone, spent timeline dot" },
    ],
  },
  {
    title: "shadcn Roles",
    note: "Aliases, not new colours. Every one points at a token above, which is why a stock shadcn component renders in WorkIt's palette with no editing. --destructive was the exception, shadcn's stock red, until it was pointed at --color-danger so a destructive action and a Rejected pill are one red. The chart ramp used to be a second exception and is now its own group above.",
    tokens: [
      { token: "--primary", role: "→ --color-brand" },
      { token: "--primary-foreground", role: "→ --color-on-brand" },
      { token: "--secondary", role: "→ --color-surface" },
      { token: "--secondary-foreground", role: "→ --color-ink" },
      { token: "--background", role: "→ --color-panel · signed-in page ground" },
      { token: "--foreground", role: "→ --color-ink" },
      { token: "--card", role: "→ --color-panel" },
      { token: "--card-foreground", role: "→ --color-ink" },
      { token: "--popover", role: "→ --color-panel" },
      { token: "--popover-foreground", role: "→ --color-ink" },
      { token: "--muted", role: "→ --color-well" },
      { token: "--muted-foreground", role: "→ --color-ink-meta" },
      { token: "--accent", role: "→ --color-hover" },
      { token: "--accent-foreground", role: "→ --color-ink" },
      { token: "--border", role: "→ --color-border" },
      { token: "--input", role: "→ --color-border-subtle" },
      { token: "--ring", role: "→ --color-brand" },
      { token: "--destructive", role: "→ --color-danger · unmeasured" },
    ],
  },
  {
    title: "shadcn Sidebar Roles",
    note: "The same aliasing for shadcn's Sidebar, which draws both shells' left panel. The panel's fill is the rail, its rows hover in rail lavender, and its focus ring is the brand.",
    tokens: [
      { token: "--sidebar", role: "→ --color-rail" },
      { token: "--sidebar-foreground", role: "→ --color-ink" },
      { token: "--sidebar-primary", role: "→ --color-brand" },
      { token: "--sidebar-primary-foreground", role: "→ --color-on-brand" },
      { token: "--sidebar-accent", role: "→ --color-rail-hover" },
      { token: "--sidebar-accent-foreground", role: "→ --color-ink" },
      { token: "--sidebar-border", role: "→ --color-rail-border" },
      { token: "--sidebar-ring", role: "→ --color-brand" },
    ],
  },
];

/**
 * Ordered smallest to largest. `cls` is written out rather than built from the
 * token because Tailwind scans source for complete class names — an
 * interpolated `text-${name}` is a class that never reaches the stylesheet.
 */
export const TYPE_SCALE: { token: string; cls: string; role: string }[] = [
  { token: "--text-caption", cls: "text-caption", role: "Uppercase rule label — OR CONTINUE WITH" },
  { token: "--text-meta", cls: "text-meta", role: "Dates, file meta, helper copy" },
  { token: "--text-note", cls: "text-note", role: "Employer, skill pills" },
  { token: "--text-label", cls: "text-label", role: "Field labels, links, buttons" },
  { token: "--text-body", cls: "text-body", role: "Body copy, inputs" },
  { token: "--text-subtitle", cls: "text-subtitle", role: "Work-history job titles" },
  { token: "--text-title", cls: "text-title", role: "Card and column headings" },
  { token: "--text-heading", cls: "text-heading", role: "Page name — My Applications" },
  { token: "--text-display", cls: "text-display", role: "Dashboard headline figures" },
];

/** The faces themselves come from next/font in app/layout.tsx. */
export const TYPEFACES: { token: string; cls: string; role: string }[] = [
  { token: "--font-sans", cls: "font-sans", role: "Geist · every word in the app" },
  {
    token: "--font-mono",
    cls: "font-mono",
    role: "Geist Mono · the audit log's action names, a chart tooltip's figures, token names here",
  },
  {
    token: "--font-heading",
    cls: "font-heading",
    role: "→ --font-sans · shadcn's title face, so a dialog title is Geist too",
  },
];

/**
 * The stock Tailwind sizes shadcn's components are written in, and what each
 * resolves to here. globals.css binds the first two to WorkIt's tokens, so a
 * vendored menu row is --text-body by construction rather than by luck.
 */
export const SHADCN_SIZES: { token: string; cls: string; role: string }[] = [
  {
    token: "text-xs → --text-note",
    cls: "text-xs",
    role: "Tooltips, a menu's group label, a chart tooltip",
  },
  {
    token: "text-sm → --text-body",
    cls: "text-sm",
    role: "Menu rows, select options, dialog and popover body, table cells, sidebar rows",
  },
  {
    token: "text-base · stock 16px, unbound",
    cls: "text-base",
    role: "Inputs below sm, where less makes iOS zoom on focus. A dialog or sheet title takes text-subtitle font-semibold instead",
  },
];

export const RADII: { token: string; cls: string; role: string }[] = [
  { token: "--radius-control", cls: "rounded-control", role: "Inputs, buttons" },
  { token: "--radius-card", cls: "rounded-card", role: "Cards" },
  {
    token: "--radius-shell",
    cls: "rounded-shell",
    role: "Seeker shell panels, both Dashboard heroes",
  },
  { token: "--radius", cls: "rounded-(--radius)", role: "→ --radius-card · shadcn's base radius" },
];

export const WIDTHS: { token: string; cls: string; role: string }[] = [
  { token: "--container-auth", cls: "max-w-auth", role: "The sign-in and sign-up card" },
  { token: "--container-app", cls: "max-w-app", role: "Every page's content column" },
];

export const SHADOWS: { token: string; cls: string; role: string }[] = [
  { token: "--shadow-card", cls: "shadow-card", role: "Login card — 20px falloff" },
  { token: "--shadow-panel", cls: "shadow-panel", role: "App cards — a 1px halo" },
  {
    token: "--shadow-lift",
    cls: "shadow-lift",
    role: "A whole-card target under the pointer, lifted 2px",
  },
];

export const EASINGS: { token: string; cls: string; role: string }[] = [
  {
    token: "--ease-glide",
    cls: "ease-glide",
    role: "What travels and settles: a thumb, a highlight, a page arriving",
  },
  {
    token: "--ease-spring",
    cls: "ease-spring",
    role: "What pops into place: a chip's cross, a badge. Never anything that travels far",
  },
  {
    token: "--ease-exit",
    cls: "ease-exit",
    role: "What leaves: it speeds away and does not linger",
  },
];

/** `demo` picks the specimen motion/demos.tsx draws for the animation. */
export const ANIMATIONS: {
  token: string;
  cls: string;
  demo: "card" | "cross" | "row" | "rail" | "bar" | "ring" | "bell";
  role: string;
}[] = [
  {
    token: "--animate-rise",
    cls: "animate-rise",
    demo: "card",
    role: "Content arriving: cards, rows, timeline steps, staggered and capped",
  },
  {
    token: "--animate-pop",
    cls: "animate-pop",
    demo: "cross",
    role: "Something appearing where it stands: a chip's cross, the Next badge, a sort glyph",
  },
  {
    token: "--animate-fade",
    cls: "animate-fade",
    demo: "row",
    role: "A fade alone, for what cannot move: a table row, a stat's comparison line",
  },
  {
    token: "--animate-draw-y",
    cls: "animate-draw-y",
    demo: "rail",
    role: "A line drawing down from its origin: the detail panel's timeline rail",
  },
  {
    token: "--animate-draw-x",
    cls: "animate-draw-x",
    demo: "bar",
    role: "A bar drawing across: Waiting to Hear Back, Profile Strength",
  },
  {
    token: "--animate-ring-fill",
    cls: "animate-ring-fill",
    demo: "ring",
    role: "A ring's arc measuring out to its value: the match score",
  },
  {
    token: "--animate-swing",
    cls: "animate-swing",
    demo: "bell",
    role: "The bar's bell, once, as the pointer reaches it",
  },
];

/** The classes globals.css gives React's <ViewTransition>, by what changed. */
export const VIEW_TRANSITIONS: { name: string; role: string }[] = [
  {
    name: "page-enter · page-exit",
    role: "Between sections, from each shell's template.tsx: out in 120ms, in rising 8px",
  },
  {
    name: "swap-enter · swap-exit",
    role: "The same place with new content: an Applications view, the board's columns, a Calendar view",
  },
  {
    name: "step-forward · step-back",
    role: "The Calendar moving through time, by its arrows and Today: the span slides the way time went",
  },
  {
    name: "reflow",
    role: "An item gliding to its new place when a list is sorted or filtered",
  },
];

/** Every Button variant, in the order the page shows them. */
export const BUTTON_VARIANTS = [
  { variant: "default", note: "Primary action" },
  { variant: "secondary", note: "Alternative beside a primary" },
  { variant: "outline", note: "Action inside a recessed area" },
  { variant: "ghost", note: "Brand text action, no chrome" },
  { variant: "section", note: "Section action, muted, beside a heading" },
  { variant: "positive", note: "Accepting an offer — WorkIt-only" },
  { variant: "destructive", note: "UNMEASURED" },
  { variant: "link", note: "UNMEASURED" },
] as const;

export const BUTTON_SIZES = ["inline", "xs", "sm", "default", "lg"] as const;
export const BUTTON_ICON_SIZES = ["icon-xs", "icon-sm", "icon", "icon-lg"] as const;
