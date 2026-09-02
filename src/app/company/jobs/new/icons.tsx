type IconProps = { className?: string };

/**
 * Glyphs the job composer needs and no other route does.
 *
 * Same 16-unit grid and 1.4 stroke as src/components/icons.tsx, for the reason
 * given in ../../icons.tsx: lucide-react is installed but draws on a 24-unit
 * grid with a 2 stroke, so a lucide glyph beside a house one reads heavier.
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

/** Live preview — an open eye. */
export function EyeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="M1.6 8s2.4-4.2 6.4-4.2S14.4 8 14.4 8s-2.4 4.2-6.4 4.2S1.6 8 1.6 8Z" />
      <circle cx="8" cy="8" r="1.9" />
    </svg>
  );
}

/** Add a screening question. */
export function PlusIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="M8 3.4v9.2" />
      <path d="M3.4 8h9.2" />
    </svg>
  );
}

/** Remove a screening question. */
export function TrashIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="M2.6 4.2h10.8" />
      <path d="M6.4 4.2V2.9a.7.7 0 0 1 .7-.7h1.8a.7.7 0 0 1 .7.7v1.3" />
      <path d="M12.2 4.2v8.2a1.4 1.4 0 0 1-1.4 1.4H5.2a1.4 1.4 0 0 1-1.4-1.4V4.2" />
      <path d="M6.7 7v4" />
      <path d="M9.3 7v4" />
    </svg>
  );
}

/**
 * The reorder handle — six dots, the conventional drag mark.
 *
 * Filled rather than stroked: a 1.4 stroke on a 0.8-radius circle is mostly
 * stroke, and the six of them turn to mush. The rest of the set is stroked, but
 * a dot has no inside to leave empty.
 */
export function GripIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      {[5, 8, 11].map((y) => (
        <g key={y}>
          <circle cx="6" cy={y} r="1" />
          <circle cx="10" cy={y} r="1" />
        </g>
      ))}
    </svg>
  );
}
