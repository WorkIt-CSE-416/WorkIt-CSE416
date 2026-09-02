type IconProps = { className?: string };

/**
 * Glyphs the company shell needs and no other route does.
 *
 * Drawn on the same 16-unit grid and the same 1.4 stroke as
 * src/components/icons.tsx, because they sit in a nav beside BriefcaseIcon and
 * UserIcon from that file. lucide-react is installed — the shadcn components
 * pull it — but its glyphs are 24-unit with a 2 stroke, so a lucide icon in
 * this nav reads heavier than the two beside it. Matching the house grid costs
 * a few paths and keeps one row of icons looking like one set.
 *
 * They move to src/components/icons.tsx the moment a second route wants them.
 */
const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** Overview — four panes, the conventional dashboard mark. */
export function GridIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <rect x="2.2" y="2.2" width="5" height="5" rx="1.2" />
      <rect x="8.8" y="2.2" width="5" height="5" rx="1.2" />
      <rect x="2.2" y="8.8" width="5" height="5" rx="1.2" />
      <rect x="8.8" y="8.8" width="5" height="5" rx="1.2" />
    </svg>
  );
}

/** Company Profile — an office block, so the row is not a second UserIcon.
 *  Applicants already owns that glyph, and two identical marks in a four-row
 *  nav is the one thing a nav cannot afford. */
export function BuildingIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="M2.8 13.6V3.4a1 1 0 0 1 1-1h5.4a1 1 0 0 1 1 1v10.2" />
      <path d="M10.2 6.8h2a1 1 0 0 1 1 1v5.8" />
      <path d="M1.6 13.6h12.8" />
      <path d="M5.1 5.4h2.6" />
      <path d="M5.1 8h2.6" />
      <path d="M5.9 13.6v-2.7h2v2.7" />
    </svg>
  );
}

/** Delta direction on a stat tile. Rotated for a fall, so one path serves both
 *  and the two arrows are guaranteed to mirror each other exactly. */
export function TrendIcon({ className, down = false }: IconProps & { down?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      {...strokeProps}
      className={className}
      style={down ? { transform: "rotate(180deg)" } : undefined}
    >
      <path d="M8 12.8V3.6" />
      <path d="m4.4 7.2 3.6-3.6 3.6 3.6" />
    </svg>
  );
}

/**
 * Sort state on a column heading.
 *
 * Three states, one glyph. Unsorted shows both arrowheads, so a column that
 * can be sorted looks different from one that cannot even before anyone clicks
 * it; sorted shows only the direction in force. Colour changes too — the
 * caller tints it brand once active — but the shape carries the state on its
 * own, which is what keeps it readable where colour is not.
 */
export function SortIcon({ className, direction }: IconProps & { direction?: "asc" | "desc" }) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      {direction !== "desc" && <path d="m4.6 6.8 3.4-3.4 3.4 3.4" />}
      {direction !== "asc" && <path d="m4.6 9.2 3.4 3.4 3.4-3.4" />}
    </svg>
  );
}
