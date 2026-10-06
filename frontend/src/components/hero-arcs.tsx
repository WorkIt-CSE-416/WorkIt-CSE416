/**
 * Concentric strokes in a violet hero's top-right corner, white at low
 * opacity, so the card reads as a designed object rather than a filled
 * rectangle. Decoration only.
 *
 * Shared by the two Dashboards' heroes: the seeker's Next Up card
 * ((seeker)/dashboard/next-up-hero.tsx) and the company's Most Urgent card
 * (company/attention.tsx). The parent must be `relative overflow-hidden`.
 */
export function HeroArcs() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 200 200"
      className="pointer-events-none absolute -top-10 -right-10 size-56"
      fill="none"
      strokeLinecap="round"
    >
      <circle cx="200" cy="0" r="150" stroke="white" strokeOpacity="0.08" strokeWidth="18" />
      <circle cx="200" cy="0" r="118" stroke="white" strokeOpacity="0.14" strokeWidth="14" />
      <circle
        cx="200"
        cy="0"
        r="90"
        stroke="var(--color-brand-pale)"
        strokeOpacity="0.35"
        strokeWidth="12"
      />
      <circle cx="200" cy="0" r="64" stroke="white" strokeOpacity="0.2" strokeWidth="10" />
    </svg>
  );
}
