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

/* Match rail ---------------------------------------------------------------
 * WorkIt's own matching layer — computed and analyzed separately from the job
 * posting itself, not part of `job_postings`. See match-rail.tsx.
 * ---------------------------------------------------------------------- */

/** Marks a reason the job fits. A caveat gets a dot instead — see match-rail. */
export function CheckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} strokeWidth={1.8} className={className}>
      <path d="m3.4 8.4 3.1 3.1 6.1-7" />
    </svg>
  );
}
