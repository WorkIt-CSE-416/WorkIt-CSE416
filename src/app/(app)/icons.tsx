type IconProps = { className?: string };

export function BellIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M4.5 7.5a4.5 4.5 0 0 1 9 0c0 3 .9 4.35 1.35 4.8H3.15C3.6 11.85 4.5 10.5 4.5 7.5Z" />
      <path d="M7.35 14.4a1.8 1.8 0 0 0 3.3 0" />
    </svg>
  );
}

export function GearIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="9" cy="9" r="2.4" />
      <path d="M14.3 11.1a1.2 1.2 0 0 0 .24 1.32l.05.04a1.44 1.44 0 1 1-2.04 2.04l-.04-.05a1.2 1.2 0 0 0-1.32-.24 1.2 1.2 0 0 0-.72 1.1v.13a1.44 1.44 0 1 1-2.88 0v-.07a1.2 1.2 0 0 0-.78-1.1 1.2 1.2 0 0 0-1.32.24l-.04.05a1.44 1.44 0 1 1-2.04-2.04l.05-.04a1.2 1.2 0 0 0 .24-1.32 1.2 1.2 0 0 0-1.1-.72h-.13a1.44 1.44 0 1 1 0-2.88h.07a1.2 1.2 0 0 0 1.1-.78 1.2 1.2 0 0 0-.24-1.32l-.05-.04a1.44 1.44 0 1 1 2.04-2.04l.04.05a1.2 1.2 0 0 0 1.32.24h.06a1.2 1.2 0 0 0 .72-1.1v-.13a1.44 1.44 0 1 1 2.88 0v.07a1.2 1.2 0 0 0 .72 1.1 1.2 1.2 0 0 0 1.32-.24l.04-.05a1.44 1.44 0 1 1 2.04 2.04l-.05.04a1.2 1.2 0 0 0-.24 1.32v.06a1.2 1.2 0 0 0 1.1.72h.13a1.44 1.44 0 1 1 0 2.88h-.07a1.2 1.2 0 0 0-1.1.72Z" />
    </svg>
  );
}
