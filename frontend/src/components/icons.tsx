type IconProps = { className?: string };

/**
 * Icons used by more than one route.
 *
 * Per-route icon sets stay beside their route; a glyph moves here the moment a
 * second route needs it. The search screen brought the first batch. The
 * Jobs screen brought the rest: the chevron and cross a filter chip
 * toggles between (now owned by ui/filter-chip), the four fact glyphs its
 * result rows share with the search detail pane, and the ellipsis it shares
 * with the applications board.
 *
 * Each keeps the geometry it was drawn with — PinIcon is on a 14-unit grid and
 * the rest on 16 — because redrawing them to match would change how they sit on
 * screens that are already signed off.
 *
 * MailIcon arrived differently: login and profile had each drawn their own, on
 * a 16- and a 14-unit grid. They were the same glyph to the eye, so the 16-unit
 * one won for matching the grid most of this file already uses. Profile's mail
 * glyph therefore renders a hair lighter than it did — 1.23px of stroke at 14px
 * rather than 1.4px — which is the cost of having one definition instead of two.
 */
const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/* Chrome ------------------------------------------------------------------ */

export function SearchIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <circle cx="7.2" cy="7.2" r="4.6" />
      <path d="m10.6 10.6 3 3" />
    </svg>
  );
}

export function FilterIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />
    </svg>
  );
}

/** A filter chip's trailing glyph while it is still a dropdown. */
export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="m4 6.5 4 4 4-4" />
    </svg>
  );
}

/** The same chip's trailing glyph once it has something to remove. */
export function CloseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
    </svg>
  );
}

/** Opens the overflow menu on a card or a column. */
export function EllipsisIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <circle cx="3.5" cy="8" r="1.35" />
      <circle cx="8" cy="8" r="1.35" />
      <circle cx="12.5" cy="8" r="1.35" />
    </svg>
  );
}

/** Filled is the saved state; the outline is the affordance to save. */
export function BookmarkIcon({ className, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      {...strokeProps}
      fill={filled ? "currentColor" : "none"}
      className={className}
    >
      <path d="M4 2.6h8a.6.6 0 0 1 .6.6v10.2L8 10.9l-4.6 2.5V3.2a.6.6 0 0 1 .6-.6Z" />
    </svg>
  );
}

/**
 * Edit. Promoted from (seeker)/profile the day the company profile grew its own
 * edit affordance — the second consumer, which is what moves a glyph here.
 *
 * It keeps its 12-unit grid rather than being redrawn to 16, for the reason at
 * the top of this file: the seeker profile is signed off against how this sits
 * today, and a regrid would move it.
 */
export function PencilIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 12 12" {...strokeProps} className={className}>
      <path d="M8.4 1.6a1.4 1.4 0 0 1 2 2L4 10 1.4 10.6 2 8Z" />
    </svg>
  );
}

/* App shell ---------------------------------------------------------------- */

/**
 * The three glyphs the top bar and its account menu are built from. They moved
 * here from the seeker shell's own icons.tsx when the company shell became a
 * second consumer of the same bar.
 *
 * They are drawn on an 18-unit grid rather than this file's usual 16, and keep
 * it for the same reason PinIcon keeps its 14: redrawing a glyph that is
 * already signed off changes how it sits on screen for no gain.
 */
export function BellIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 18 18" {...strokeProps} className={className}>
      <path d="M4.5 7.5a4.5 4.5 0 0 1 9 0c0 3 .9 4.35 1.35 4.8H3.15C3.6 11.85 4.5 10.5 4.5 7.5Z" />
      <path d="M7.35 14.4a1.8 1.8 0 0 0 3.3 0" />
    </svg>
  );
}

/** The account menu's Profile item. */
export function UserIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 18 18" {...strokeProps} className={className}>
      <circle cx="9" cy="6" r="2.9" />
      <path d="M3.5 15.1c0-2.65 2.46-4.3 5.5-4.3s5.5 1.65 5.5 4.3" />
    </svg>
  );
}

export function GearIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 18 18" {...strokeProps} className={className}>
      <circle cx="9" cy="9" r="2.4" />
      <path d="M14.3 11.1a1.2 1.2 0 0 0 .24 1.32l.05.04a1.44 1.44 0 1 1-2.04 2.04l-.04-.05a1.2 1.2 0 0 0-1.32-.24 1.2 1.2 0 0 0-.72 1.1v.13a1.44 1.44 0 1 1-2.88 0v-.07a1.2 1.2 0 0 0-.78-1.1 1.2 1.2 0 0 0-1.32.24l-.04.05a1.44 1.44 0 1 1-2.04-2.04l.05-.04a1.2 1.2 0 0 0 .24-1.32 1.2 1.2 0 0 0-1.1-.72h-.13a1.44 1.44 0 1 1 0-2.88h.07a1.2 1.2 0 0 0 1.1-.78 1.2 1.2 0 0 0-.24-1.32l-.05-.04a1.44 1.44 0 1 1 2.04-2.04l.04.05a1.2 1.2 0 0 0 1.32.24h.06a1.2 1.2 0 0 0 .72-1.1v-.13a1.44 1.44 0 1 1 2.88 0v.07a1.2 1.2 0 0 0 .72 1.1 1.2 1.2 0 0 0 1.32-.24l.04-.05a1.44 1.44 0 1 1 2.04 2.04l-.05.04a1.2 1.2 0 0 0-.24 1.32v.06a1.2 1.2 0 0 0 1.1.72h.13a1.44 1.44 0 1 1 0 2.88h-.07a1.2 1.2 0 0 0-1.1.72Z" />
    </svg>
  );
}

/* Facts about a job ------------------------------------------------------- */

export function CoinIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 4.6v6.8M9.9 6.1a1.7 1.7 0 0 0-1.6-1h-.6a1.55 1.55 0 0 0-.3 3.07l1.4.28a1.6 1.6 0 0 1-.2 3.17h-.5a1.75 1.75 0 0 1-1.65-1.1" />
    </svg>
  );
}

export function PinIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 14 14" {...strokeProps} className={className}>
      <path d="M12 6.1c0 3.5-5 8.2-5 8.2S2 9.6 2 6.1a5 5 0 0 1 10 0Z" />
      <circle cx="7" cy="6.1" r="1.7" />
    </svg>
  );
}

export function BriefcaseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <rect x="1.8" y="4.8" width="12.4" height="8.4" rx="1.4" />
      <path d="M5.6 4.8V3.4a1.2 1.2 0 0 1 1.2-1.2h2.4a1.2 1.2 0 0 1 1.2 1.2v1.4" />
    </svg>
  );
}

export function MonitorIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <rect x="1.8" y="2.8" width="12.4" height="8.4" rx="1.4" />
      <path d="M5.5 13.8h5" />
    </svg>
  );
}

export function AwardIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <circle cx="8" cy="6.3" r="4.1" />
      <path d="m5.6 9.9-1 4.2L8 12.5l3.4 1.6-1-4.2" />
    </svg>
  );
}

export function CalendarIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <rect x="2.2" y="3.4" width="11.6" height="10.4" rx="1.4" />
      <path d="M2.2 6.6h11.6M5.6 2.2v2.2M10.4 2.2v2.2" />
    </svg>
  );
}

export function MailIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <rect x="1.75" y="3.75" width="12.5" height="8.5" rx="1.5" />
      <path d="M2.25 4.5 8 8.75 13.75 4.5" />
    </svg>
  );
}
