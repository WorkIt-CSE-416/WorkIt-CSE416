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
 * Four bands on one magenta ramp, the `--color-match-*` tokens in globals.css,
 * lightest for Weak and deepest for Excellent. A better match is a deeper
 * colour, so the bands read as one rising scale, and the ring's colour agrees
 * with its length. The ramp is its own hue on purpose. The bands used to be the
 * brand violet and a green, a yellow and a red, which are the Applied, Offer
 * and Interviewing stages' colours and the danger red: a 95% card in the
 * Interviewing column wore an Applied ring, and an Offer card drew two greens
 * that meant different things. Stages own violet, blue, amber, green and grey;
 * a score owns magenta. The tokens' note says why that hue, and measures every
 * step on white and on the rail's well.
 *
 * The colour only ever paints a stroke, a dot, a bar or a glyph. The tier's
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

/** The colour a match's ring, the dot before its tier label, the match badge
 *  and the company Dashboard's match bar draw in, as a `var()` reference for
 *  an inline style or an SVG stroke. See the note on `TIERS`. */
export function matchColor(score: number) {
  return tierFor(score).color;
}
