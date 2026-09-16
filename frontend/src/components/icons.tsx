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

/**
 * A back link's arrow. Promoted from (seeker)/jobs the day the company job
 * detail page grew its own "Back to Jobs" — the second consumer.
 */
export function ArrowLeftIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="M13.25 8h-10.5M6.75 4l-4 4 4 4" />
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

/* Auth ----------------------------------------------------------------------
 * Promoted from login/icons.tsx the day signup became a second consumer. */

export function LockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <rect x="3.25" y="7" width="9.5" height="6.75" rx="1.5" />
      <path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" />
    </svg>
  );
}

export function ArrowRightIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="M2.75 8h10.5M9.25 4l4 4-4 4" />
    </svg>
  );
}

/**
 * The two OAuth providers' own logos, in their own colours. Unlike every other
 * icon in this file these do not take `currentColor` — a brand mark recoloured
 * to the surrounding text is no longer the brand mark, and both companies'
 * guidelines require the official colours on a light background, which is what
 * an auth card gives them. So the fills are literal hex rather than tokens:
 * they must not follow a palette change.
 *
 * Both are drawn to fill their viewBox, so a single `size-*` at the call site
 * makes them optically equal.
 */

/** Google's four-colour "G". */
export function GoogleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.55 10.78l7.98-6.19Z"
      />
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.55 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"
      />
    </svg>
  );
}

/**
 * LinkedIn's boxed "in".
 *
 * The box is its own rect and the letters are painted white over it, rather
 * than the one-path version in circulation that knocks them out by winding
 * rule — that path renders solid the moment anything applies `fill-rule:
 * evenodd`, and this cannot.
 */
export function LinkedInIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <rect width="24" height="24" rx="2.2" fill="#0A66C2" />
      <path
        fill="#fff"
        d="M7.12 20.45H3.56V9h3.56v11.45ZM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13Zm15.11 13.02h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29Z"
      />
    </svg>
  );
}

/* Resume upload ------------------------------------------------------------
 * Promoted from (seeker)/profile the day the applicant onboarding screen
 * became a second consumer. Geometry is unchanged from profile's original
 * icons.tsx so neither screen moves a pixel. */

export function UploadIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 24" {...strokeProps} className={className}>
      <path d="M11.6 1.4H4.4A2.2 2.2 0 0 0 2.2 3.6v16.8a2.2 2.2 0 0 0 2.2 2.2h11.2a2.2 2.2 0 0 0 2.2-2.2V7.4Z" />
      <path d="M11.6 1.4v6h6" />
      <path d="M10 18.4v-6M7.4 15l2.6-2.6 2.6 2.6" />
    </svg>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="M2.4 4h11.2M6 4V2.9a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V4" />
      <path d="M12.5 4v8.6a1.2 1.2 0 0 1-1.2 1.2H4.7a1.2 1.2 0 0 1-1.2-1.2V4" />
      <path d="M6.6 7v3.8M9.4 7v3.8" />
    </svg>
  );
}

/** The one icon the mockup renders in colour rather than the surrounding ink. */
export function PdfIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="#b21919"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M11.4 1.7H5.2a1.9 1.9 0 0 0-1.9 1.9v12.8a1.9 1.9 0 0 0 1.9 1.9h9.6a1.9 1.9 0 0 0 1.9-1.9V7.1Z" />
      <path d="M11.4 1.7v5.4h5.4" />
      <path d="M6.6 11.9v3.4M6.6 11.9h1a1 1 0 0 1 0 2h-1M13.4 11.9h-1.8v3.4M11.6 13.6h1.5" />
      <path d="M8.9 15.3v-3.4h.8a1.7 1.7 0 0 1 0 3.4Z" />
    </svg>
  );
}
