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
    note: "Weight and letter-spacing are baked into each token, so a caption cannot be used without its tracking. Two sizes are both 11px — caption carries uppercase tracking and weight 600, meta carries neither.",
  },
  shape: {
    slug: "shape",
    title: "Shape and elevation",
    note: "Two radii and two shadows. WorkIt's own; stock Tailwind's rounded-sm/md/lg keep their default values, which is what existing call sites were measured against.",
  },
  buttons: {
    slug: "buttons",
    title: "Buttons",
    note: "One component, shadcn's variant and size names, WorkIt's measured styling. Each variant has a natural size, so most call sites pass only a variant.",
  },
  forms: {
    slug: "forms",
    title: "Form controls",
    note: "Every control that takes input, at the width it is used rather than full-bleed.",
  },
  display: {
    slug: "display",
    title: "Display",
    note: "Everything that shows a value without accepting one. The status rows render from the same maps the company tables read, so they cannot drift from what the app paints.",
  },
  vendored: {
    slug: "vendored",
    title: "Vendored",
    note: "Pulled in with `npx shadcn add` and not restyled. They look like WorkIt because globals.css maps shadcn's role names onto WorkIt's tokens, and because they compose against the same Button as everything above.",
  },
} as const;

export const SECTION_ORDER = [
  SECTIONS.colour,
  SECTIONS.type,
  SECTIONS.shape,
  SECTIONS.buttons,
  SECTIONS.forms,
  SECTIONS.display,
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
      { token: "--color-app", role: "Signed-in page ground" },
      { token: "--color-panel", role: "Top bar and cards" },
      { token: "--color-well", role: "Recessed area — the resume dropzone" },
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
    title: "Ink",
    tokens: [
      { token: "--color-ink", role: "Headings" },
      { token: "--color-ink-muted", role: "Body copy, field labels" },
      { token: "--color-ink-meta", role: "Nav links, subtitles, dates, glyphs" },
      { token: "--color-ink-subtle", role: "Placeholders, input icons" },
      { token: "--color-ink-faint", role: "A result card's timestamp" },
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
      { token: "--color-brand-ring", role: "Derived — focus ring" },
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
      { token: "--color-positive-ring", role: "Derived — focus ring" },
      { token: "--color-positive-ink", role: "Positive as text on its tint — AA safe" },
      { token: "--color-inert-tint", role: "Measured — a status that is over or not begun" },
      { token: "--color-warning", role: "UNMEASURED — halted, waiting on a decision" },
      { token: "--color-warning-tint", role: "UNMEASURED" },
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
    title: "Borders",
    tokens: [
      { token: "--color-border", role: "Card outline" },
      { token: "--color-border-subtle", role: "Inputs, secondary buttons, rules" },
      { token: "--color-border-strong", role: "Dashed dropzone, spent timeline dot" },
    ],
  },
  {
    title: "shadcn roles",
    note: "Aliases, not new colours. Every one points at a token above, which is why a stock shadcn component renders in WorkIt's palette with no editing. --destructive is the one exception: nothing has designed a red action yet. The chart ramp used to be a second exception and is now its own group above.",
    tokens: [
      { token: "--primary", role: "→ --color-brand" },
      { token: "--secondary", role: "→ --color-surface" },
      {
        token: "--background",
        role: "→ --color-app (company shell retargets it to --color-panel)",
      },
      { token: "--foreground", role: "→ --color-ink" },
      { token: "--card", role: "→ --color-panel" },
      { token: "--popover", role: "→ --color-panel" },
      { token: "--muted", role: "→ --color-well" },
      { token: "--muted-foreground", role: "→ --color-ink-meta" },
      { token: "--accent", role: "→ --color-hover" },
      { token: "--border", role: "→ --color-border" },
      { token: "--input", role: "→ --color-border-subtle" },
      { token: "--ring", role: "→ --color-brand" },
      { token: "--destructive", role: "UNDESIGNED — shadcn's stock red" },
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
  { token: "--text-note", cls: "text-note", role: "Employer, skill pills, section actions" },
  { token: "--text-label", cls: "text-label", role: "Field labels, links, buttons" },
  { token: "--text-body", cls: "text-body", role: "Body copy, inputs" },
  { token: "--text-subtitle", cls: "text-subtitle", role: "Work-history job titles" },
  { token: "--text-title", cls: "text-title", role: "Card and column headings" },
  { token: "--text-heading", cls: "text-heading", role: "Page name — My Applications" },
  { token: "--text-display", cls: "text-display", role: "Job title on the detail pane" },
];

export const RADII: { token: string; cls: string; role: string }[] = [
  { token: "--radius-control", cls: "rounded-control", role: "Inputs, buttons" },
  { token: "--radius-card", cls: "rounded-card", role: "Cards" },
];

export const SHADOWS: { token: string; cls: string; role: string }[] = [
  { token: "--shadow-card", cls: "shadow-card", role: "Login card — 20px falloff" },
  { token: "--shadow-panel", cls: "shadow-panel", role: "App cards — a 1px halo" },
];

/** Every Button variant, in the order the page shows them. */
export const BUTTON_VARIANTS = [
  { variant: "default", note: "Primary action" },
  { variant: "secondary", note: "Alternative beside a primary" },
  { variant: "outline", note: "Action inside a recessed area" },
  { variant: "ghost", note: "Section action, no chrome" },
  { variant: "positive", note: "Accepting an offer — WorkIt-only" },
  { variant: "destructive", note: "UNMEASURED" },
  { variant: "link", note: "UNMEASURED" },
] as const;

export const BUTTON_SIZES = ["inline", "xs", "sm", "default", "lg"] as const;
export const BUTTON_ICON_SIZES = ["icon-xs", "icon-sm", "icon", "icon-lg"] as const;
