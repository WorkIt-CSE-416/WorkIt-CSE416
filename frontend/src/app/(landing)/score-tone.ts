/**
 * A match score's chip colour on the landing page: green, amber or red,
 * from the app's positive, warning and danger tokens, so the cards show a
 * spread of fits rather than one violet. The app's own match bands stay
 * one magenta scale (globals.css); this marketing page asks only for good,
 * fair and poor. Used by the hero's job cards, the tour's Resumes and
 * Matching stops and Auto Apply's far windows.
 */
export function scoreTone(score: number) {
  if (score >= 85) return "bg-positive-tint/85 text-positive-ink ring-positive/35";
  if (score >= 70) return "bg-warning-tint/85 text-warning ring-warning-fill/45";
  return "bg-danger-tint/85 text-danger ring-danger/30";
}
