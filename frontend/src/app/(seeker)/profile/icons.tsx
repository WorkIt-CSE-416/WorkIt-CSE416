type IconProps = { className?: string };

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function PhoneIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 14 14" {...strokeProps} className={className}>
      <path d="M12.6 10.1v1.7a1.1 1.1 0 0 1-1.24 1.13 11.2 11.2 0 0 1-4.88-1.74A11 11 0 0 1 3.1 7.82 11.2 11.2 0 0 1 1.36 2.9 1.1 1.1 0 0 1 2.48 1.66h1.7a1.13 1.13 0 0 1 1.13.97c.07.55.2 1.08.39 1.6a1.13 1.13 0 0 1-.25 1.19l-.72.72a9 9 0 0 0 3.38 3.38l.72-.72a1.13 1.13 0 0 1 1.19-.25c.52.19 1.05.32 1.6.39a1.13 1.13 0 0 1 .98 1.16Z" />
    </svg>
  );
}

export function EyeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...strokeProps} className={className}>
      <path d="M1.3 8S3.7 3.4 8 3.4 14.7 8 14.7 8 12.3 12.6 8 12.6 1.3 8 1.3 8Z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}
