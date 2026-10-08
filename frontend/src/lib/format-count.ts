/**
 * A headline count as the Dashboards print it: in full below 10,000
 * ("1,234"), then in thousands ("12.3K", "214K").
 *
 * The explicit `en-US` keeps the server and the browser agreeing: the figure
 * renders on both (ui/animated-number.tsx is a client component), and an
 * unqualified toLocaleString picks up the runtime's locale, which React then
 * reports as a hydration mismatch (lib/format-date.ts has the same note).
 *
 * Its own module rather than inside stat-tile.tsx, because the animated
 * figure needs it too, and a function exported from a client module cannot
 * be called from a Server Component.
 */
export function formatCount(value: number) {
  const abs = Math.abs(value);
  if (abs < 10_000) return value.toLocaleString("en-US");

  return `${(value / 1000).toFixed(abs < 100_000 ? 1 : 0)}K`;
}
