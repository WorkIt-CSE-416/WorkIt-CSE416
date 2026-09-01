type IconProps = { className?: string };

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/* Result card ------------------------------------------------------------- */

/** The spark beside a match score. Solid, so it reads at 12px. */
export function BoltIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8.9 1.3 3.4 8.6a.5.5 0 0 0 .4.8h3l-1.2 5.3 5.9-7.5a.5.5 0 0 0-.4-.8h-3l.8-5.1Z" />
    </svg>
  );
}

/* Detail pane ------------------------------------------------------------- */

export function ExternalLinkIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="M9.5 2.5H13.5V6.5M13.5 2.5 8 8" />
      <path d="M12.4 9.8v3a1.2 1.2 0 0 1-1.2 1.2H3.4a1.2 1.2 0 0 1-1.2-1.2V5a1.2 1.2 0 0 1 1.2-1.2h3" />
    </svg>
  );
}

/* Company marks -----------------------------------------------------------
 * Stand-ins for employer logos — see the note on JOBS in ./data. The stat-tile
 * glyphs that used to sit here moved to @/components/icons when the
 * recommendations screen became their second caller.
 * ---------------------------------------------------------------------- */

export function GlobeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M2.4 8h11.2M8 2.2a10 10 0 0 1 0 11.6 10 10 0 0 1 0-11.6" />
    </svg>
  );
}

export function WaveIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="M1.8 10.4 4.6 6l2.6 3.4L9.8 3l2.3 5.4 2.1-2" />
    </svg>
  );
}
