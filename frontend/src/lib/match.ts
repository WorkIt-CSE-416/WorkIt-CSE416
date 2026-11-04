/**
 * What a match score is called, and what colour says so at a glance.
 *
 * Lives here rather than in (seeker)/jobs/data.ts, where it started: the
 * applications board's match badge became its second caller, and the point of
 * one scale is that a score reads the same on both screens.
 *
 * Bands rather than a bare percentage because a number alone invites a reading
 * it has not earned — 76 and 74 are not two different things. The thresholds
 * are a placeholder: whoever owns the matching model sets the real ones, and
 * the labels are the only place the screen states them.
 *
 * Four bands in red, yellow and green, the `--color-match-*` tokens in
 * globals.css: red for Weak, yellow for Good, green for Strong and a deeper
 * green for Excellent, so a score says good or bad at a glance (KAN-518). They
 * were one magenta ramp until then, picked so a score shared no hue with a
 * stage, but a pink ring said nothing about the fit: the user wanted the
 * colours everyone reads without a legend. So an Offer card can draw two greens;
 * the ring's shape and number keep it apart from the stage's chip. The tokens'
 * note measures every step on white and on the rail's well. Weak drew in
 * neutral ink for a day (KAN-569), since with placeholder thresholds nearly
 * every job scores Weak; the bands came back on 2026-11-03, because a black
 * ring read as a fault rather than a score.
 *
 * The colour only ever paints a stroke, a bar or a glyph. The tier's
 * words are ink-muted wherever they are printed (see `MatchRail`), so no step
 * has to pass as text.
 *
 * Four bands, not five: Fair Match, the old 50-64 band, folds into Weak Match
 * instead of getting its own step, since below Good is all "don't count on
 * this one."
 */
const TIERS = [
  { min: 90, label: "Excellent Match", color: "var(--color-match-excellent)" },
  { min: 80, label: "Strong Match", color: "var(--color-match-strong)" },
  { min: 65, label: "Good Match", color: "var(--color-match-good)" },
  { min: 0, label: "Weak Match", color: "var(--color-match-weak)" },
] as const;

function tierFor(score: number) {
  return TIERS.find((tier) => score >= tier.min) ?? TIERS[TIERS.length - 1];
}

export function matchTier(score: number) {
  return tierFor(score).label;
}

/** The colour a match's ring, the match badge and the company Dashboard's
 *  match bar draw in, as a `var()` reference for an inline style or an SVG
 *  stroke. See the note on `TIERS`. */
export function matchColor(score: number) {
  return tierFor(score).color;
}
