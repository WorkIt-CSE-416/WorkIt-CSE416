type IconProps = { className?: string };

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/* Board chrome ------------------------------------------------------------
 * The ellipsis and the calendar that used to sit here moved to
 * @/components/icons when the Jobs screen became their second
 * caller; this file keeps the glyphs only the board draws.
 * ---------------------------------------------------------------------- */

export function PlusIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

/* Card meta -------------------------------------------------------------- */

export function ClockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 4.8V8l2.2 1.6" />
    </svg>
  );
}

/* Company marks ----------------------------------------------------------
 * Stand-ins, the same bargain the Avatar strikes: KAN-43 ships no company
 * logos, and a tinted tile with a glyph holds the right size and weight until
 * real artwork exists. Each one is the shape the mockup draws for that company.
 * -------------------------------------------------------------------- */

export function BuildingIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="M2.6 13.4V3.4a.8.8 0 0 1 .8-.8h6a.8.8 0 0 1 .8.8v10" />
      <path d="M10.2 6.6h2.4a.8.8 0 0 1 .8.8v6M5 5.4h2.8M5 8h2.8M5 10.6h2.8M1.6 13.4h12.8" />
    </svg>
  );
}

export function CubeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="M8 1.8l5.4 3v6.4L8 14.2 2.6 11.2V4.8L8 1.8Z" />
      <path d="M2.6 4.8 8 7.8l5.4-3M8 7.8v6.4" />
    </svg>
  );
}

export function NodesIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <circle cx="8" cy="3.2" r="1.6" />
      <circle cx="3.4" cy="11.6" r="1.6" />
      <circle cx="12.6" cy="11.6" r="1.6" />
      <path d="M6.8 4.6 4.6 10.2M9.2 4.6l2.2 5.6M5 11.6h6" />
    </svg>
  );
}

export function StorefrontIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="M2.2 6.4h11.6v6.6a.8.8 0 0 1-.8.8H3a.8.8 0 0 1-.8-.8V6.4Z" />
      <path d="M1.6 6.4 3.2 2.8h9.6l1.6 3.6M6.2 13.8V9.8h3.6v4" />
    </svg>
  );
}

export function CloudIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="M4.6 12.4a3 3 0 0 1-.3-5.98 4 4 0 0 1 7.72-.42 2.78 2.78 0 0 1-.42 5.5.6.6 0 0 1-.1.01H4.6Z" />
    </svg>
  );
}

/* View switcher ----------------------------------------------------------
 * Each glyph draws the shape of its layout: columns, cells, rows.
 * ---------------------------------------------------------------------- */

export function BoardIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <rect x="2" y="2.5" width="3.4" height="11" rx="1" />
      <rect x="6.3" y="2.5" width="3.4" height="7.5" rx="1" />
      <rect x="10.6" y="2.5" width="3.4" height="9.5" rx="1" />
    </svg>
  );
}

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

export function ListIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="M6 3.6h8M6 8h8M6 12.4h8" />
      <path d="M2.6 3.6h.01M2.6 8h.01M2.6 12.4h.01" />
    </svg>
  );
}

/* Card footer counts ----------------------------------------------------- */

export function PaperclipIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="M13.4 7.3 8.1 12.6a3.2 3.2 0 0 1-4.5-4.5l5.6-5.6a2.1 2.1 0 0 1 3 3l-5.6 5.6a1.1 1.1 0 0 1-1.5-1.5l5-5" />
    </svg>
  );
}

export function CommentIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="M13.8 10.2a1.2 1.2 0 0 1-1.2 1.2H4.9L2.2 14V3.4a1.2 1.2 0 0 1 1.2-1.2h9.2a1.2 1.2 0 0 1 1.2 1.2Z" />
    </svg>
  );
}
