type IconProps = { className?: string };

/**
 * The two glyphs that mark this screen's card headings.
 *
 * Same 16-unit grid and 1.4 stroke as src/components/icons.tsx, for the reason
 * given in ../icons.tsx: lucide-react is installed but draws on a 24-unit grid
 * with a 2 stroke, so a lucide glyph beside a house one reads heavier.
 *
 * The company's own mark is not here — the hero reuses BuildingIcon from
 * ../icons.tsx, which is the company shell's shared set and already draws it
 * for the nav row that points at this page.
 */
const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** About Us — a circled i. */
export function InfoIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 7.4v3.4" />
      <path d="M8 5.2h.01" />
    </svg>
  );
}

/**
 * Overview — three columns on a baseline.
 *
 * The same drawing the company sidebar carried for its Analytics row, which is
 * gone; it lives here now because a panel of figures is what it labels.
 */
export function ChartIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="M2.4 13.4h11.2" />
      <path d="M4.8 13.4V9.2" />
      <path d="M8 13.4V5.6" />
      <path d="M11.2 13.4v-6" />
    </svg>
  );
}
