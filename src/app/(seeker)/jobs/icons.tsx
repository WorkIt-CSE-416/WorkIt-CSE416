type IconProps = { className?: string };

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/* Card actions ------------------------------------------------------------ */

/** Asking the assistant about a job. Filled, so it holds up beside a label. */
export function SparkleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M6.6 1.8c.6 3 1.9 4.4 4.9 5-3 .6-4.3 2-4.9 5-.6-3-1.9-4.4-4.9-5 3-.6 4.3-2 4.9-5Z" />
      <path d="M12.6 9.4c.25 1.2.75 1.7 1.9 1.95-1.15.25-1.65.75-1.9 1.95-.25-1.2-.75-1.7-1.9-1.95 1.15-.25 1.65-.75 1.9-1.95Z" />
    </svg>
  );
}

/** Dismissing a recommendation, so it stops being recommended. */
export function CircleSlashIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <circle cx="8" cy="8" r="5.8" />
      <path d="m3.9 12.1 8.2-8.2" />
    </svg>
  );
}

/* Match rail -------------------------------------------------------------- */

/** Marks a reason the job fits. A caveat gets a dot instead — see match-rail. */
export function CheckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} strokeWidth={1.8} className={className}>
      <path d="m3.4 8.4 3.1 3.1 6.1-7" />
    </svg>
  );
}

/* Company marks -----------------------------------------------------------
 * Stand-ins for employer logos, the same bargain the other two job screens
 * strike: no artwork exists, and a glyph on a tinted tile holds the right size
 * and weight until it does. Each one is drawn for the company it stands for.
 * ---------------------------------------------------------------------- */

export function CompassIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M10.6 5.4 9.2 9.2 5.4 10.6 6.8 6.8l3.8-1.4Z" />
    </svg>
  );
}

export function SunIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.4v1.6M8 13v1.6M1.4 8h1.6M13 8h1.6M3.3 3.3l1.15 1.15M11.55 11.55l1.15 1.15M12.7 3.3l-1.15 1.15M4.45 11.55 3.3 12.7" />
    </svg>
  );
}

export function LayersIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="M8 2.2 14 5.4 8 8.6 2 5.4 8 2.2Z" />
      <path d="m2 9 6 3.2L14 9" />
    </svg>
  );
}

export function LeafIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="M13.4 2.6c0 6.8-3 10.6-7.2 10.6a3.4 3.4 0 0 1-.4-6.78c3-.35 5.4-1.32 7.6-3.82Z" />
      <path d="M3 13.8 7.6 9" />
    </svg>
  );
}
