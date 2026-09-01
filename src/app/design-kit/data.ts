/**
 * What the design kit renders.
 *
 * Only names and prose live here. No hex values, no rem measurements: the page
 * resolves every token from the live stylesheet at runtime, so this file cannot
 * drift out of step with globals.css the way a mirrored table would. Adding a
 * token means adding one row here; changing its value means touching only
 * globals.css.
 */

export type ColorToken = { token: string; role: string };
export type ColorGroup = { title: string; note?: string; tokens: ColorToken[] };

export const COLOR_GROUPS: ColorGroup[] = [
  {
    title: "Surfaces",
    note: "Login and the app shell disagree about which hex is a page and which is a card, so both scales exist side by side until a designer reconciles them.",
    tokens: [
      { token: "--color-canvas", role: "Login page ground" },
      { token: "--color-surface", role: "Login card" },
      { token: "--color-surface-tint", role: "Logo tile, subtle fills" },
      { token: "--color-app", role: "Signed-in page ground" },
      { token: "--color-panel", role: "Top bar and cards" },
      { token: "--color-well", role: "Recessed area — the resume dropzone" },
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
      { token: "--color-brand-tint", role: "Skill pills, hovered rows" },
      { token: "--color-brand-pale", role: "Accent on a saved card" },
      { token: "--color-brand-ring", role: "Derived — focus ring" },
    ],
  },
  {
    title: "Status",
    note: "The board's only non-brand control: accepting an offer.",
    tokens: [
      { token: "--color-positive", role: "Offer accent and its green button" },
      { token: "--color-positive-tint", role: "The offer card's company tile" },
      { token: "--color-positive-hover", role: "Derived — 33% lightness" },
      { token: "--color-positive-active", role: "Derived — 27% lightness" },
      { token: "--color-positive-ring", role: "Derived — focus ring" },
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
    note: "Aliases, not new colours. Every one points at a token above, which is why a stock shadcn component renders in WorkIt's palette with no editing. --destructive and the chart ramp are the exceptions: nothing designed them yet.",
    tokens: [
      { token: "--primary", role: "→ --color-brand" },
      { token: "--secondary", role: "→ --color-surface" },
      { token: "--background", role: "→ --color-app" },
      { token: "--foreground", role: "→ --color-ink" },
      { token: "--card", role: "→ --color-panel" },
      { token: "--popover", role: "→ --color-panel" },
      { token: "--muted", role: "→ --color-well" },
      { token: "--muted-foreground", role: "→ --color-ink-meta" },
      { token: "--accent", role: "→ --color-brand-tint" },
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
