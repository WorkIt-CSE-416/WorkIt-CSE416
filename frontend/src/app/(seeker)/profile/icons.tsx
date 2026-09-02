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

export function UploadIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 24" {...strokeProps} className={className}>
      <path d="M11.6 1.4H4.4A2.2 2.2 0 0 0 2.2 3.6v16.8a2.2 2.2 0 0 0 2.2 2.2h11.2a2.2 2.2 0 0 0 2.2-2.2V7.4Z" />
      <path d="M11.6 1.4v6h6" />
      <path d="M10 18.4v-6M7.4 15l2.6-2.6 2.6 2.6" />
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
