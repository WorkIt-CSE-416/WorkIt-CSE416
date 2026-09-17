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
 * Four bands, blue through red, rather than one flat colour at every score.
 * Top band reuses `--color-brand` — the score that earns the app's own
 * primary colour is the one worth calling out — and the three below it step
 * through green, yellow and red so the bands read as a falling scale rather
 * than a set of unrelated badges. Green and red here are a warmer, more
 * saturated pair than `--color-positive`/`--color-negative`, chosen so a
 * match score doesn't borrow the applications board's vocabulary for "you
 * have an offer" / "rejected". That matters more now the board's cards carry a
 * match badge: an Offer card draws both greens at once, and they mean two
 * different things.
 *
 * One hue per band, not two bands sharing a hue family (the old green/lime
 * and amber/orange pairs read as the same colour at a glance). Fair match —
 * the old 50-64 band — folds into Weak match instead of getting its own
 * colour, since below Good is all "don't count on this one."
 */
const TIERS = [
  { min: 90, label: "Excellent match", color: "var(--color-brand)" },
  { min: 80, label: "Strong match", color: "#22c55e" },
  { min: 65, label: "Good match", color: "#eab308" },
  { min: 0, label: "Weak match", color: "#ef4444" },
] as const;

function tierFor(score: number) {
  return TIERS.find((tier) => score >= tier.min) ?? TIERS[TIERS.length - 1];
}

export function matchTier(score: number) {
  return tierFor(score).label;
}

/** The colour a match's ring and tier label draw in — see the note on `TIERS`. */
export function matchColor(score: number) {
  return tierFor(score).color;
}
