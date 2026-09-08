import { cn } from "@/lib/cn";

import { STATUS_BY_ROLE, ROLE_STAGES, STAGE_PAINT, type RoleStatus } from "./data";

/**
 * Which stage each posting's applicants are sitting in, one stacked bar a role.
 *
 * WHY THIS IS ON THE SCREEN AT ALL: the ring beside it is an aggregate, and an
 * aggregate always looks healthy. 271 down to 68 reads as a normal screen rate
 * right up until it turns out one posting is carrying the whole drop. This is
 * the same set cut by posting, so a role that is stalling is a shape rather
 * than a number nobody computed.
 *
 * ---------------------------------------------------------------------------
 * HTML AND NOT A CHART LIBRARY — the reasoning the other HTML bars in this
 * directory point back at.
 *
 * Five rows of proportional segments on a shared baseline need no axis system,
 * no scale and no resize observer, which is most of what a chart library is
 * for. Drawing them as divs also means role names truncate natively: an SVG
 * text node does not ellipsize, and "Site Reliability Engineer" is 25
 * characters in a column that is sometimes 300px wide. ./trend.tsx is where the
 * library earns its weight, because a time axis genuinely is an axis system;
 * ./status-ring.tsx earns it because a wedge is not a rectangle. A row of
 * rectangles does not.
 *
 * WHAT THE MARKS FOLLOW, here and in ./stage-age.tsx:
 *
 *   - Bars are capped well under the row height, so the band's leftover stays
 *     air rather than ink.
 *   - A bar a reader measures TO is rounded at the data end and square at the
 *     baseline, so the end that carries the value is the end that is shaped.
 *   - There is no track behind a bar unless the bar is a ratio against a
 *     limit. A track turns a bar into a meter, and counts measured against
 *     each other have no limit to be a share of. The one place a track is
 *     right is the match score in ./applicants-preview.tsx, where a percentage
 *     genuinely does have 100 behind it.
 *   - Values are printed, not hovered. A tooltip puts a number behind a mouse:
 *     unreachable by keyboard, invisible in a screenshot, gone on touch. It is
 *     also what the palette's contrast WARN obligates — see globals.css.
 *
 * WHY THE SEGMENTS ARE NOT INDIVIDUALLY LABELLED, and what stands in for it.
 * Twenty-five numbers inside twenty-five segments is unreadable, and several
 * segments are one or two applicants wide with no interior to put a digit in.
 * The relief the palette's contrast WARN requires — see globals.css — is met
 * three ways instead: the legend carries each stage's column total, so every
 * aggregate the chart encodes is printed on the page; each row is
 * direct-labelled with its own total; and the per-role breakdown is spoken in
 * full for a screen reader, which is also the honest way to expose numbers
 * that a sighted reader gets from segment length. Per-applicant detail is one
 * click away in the table this card links to.
 *
 * NO SORTING. Rows are in STATUS_BY_ROLE's order, widest first, and stay
 * there. A chart that re-sorts itself when the data moves makes a reader
 * re-find every row before they can compare anything.
 */

/** Row total, and the denominator its segments are measured against. */
function rowTotal(row: RoleStatus) {
  return ROLE_STAGES.reduce((total, stage) => total + row[stage], 0);
}

export function StatusByRole() {
  return (
    /* h-full and a column so the row list can take flex-1 and space its five
     * rows across whatever height the band settled on — see the items-stretch
     * note in ./page.tsx. The rows grow apart rather than bunching at the top
     * over a blank half-card. */
    <div className="flex h-full flex-col">
      {/* The legend is always present: five series is well past the point
          where colour alone can carry identity. Names only, no counts — the
          ring in the card beside this one is the same five stage totals, and
          printing them twice in one band invites a reader to look for the
          difference between two copies of one number. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {ROLE_STAGES.map((stage) => (
          <li key={stage} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn("size-2.5 shrink-0 rounded-[3px]", STAGE_PAINT[stage].fill)}
            />
            <span className="text-meta text-ink-muted">{stage}</span>
          </li>
        ))}
      </ul>

      <ul className="mt-4 flex flex-1 flex-col justify-between gap-3.5">
        {STATUS_BY_ROLE.map((row) => {
          const total = rowTotal(row);

          return (
            <li key={row.role}>
              <div className="text-note flex items-baseline justify-between gap-3">
                <span className="text-ink truncate">{row.role}</span>
                <span className="text-ink-meta shrink-0 tabular-nums">{total}</span>
              </div>

              {/* Every row is the full width of the card, so the bars compare
                  composition and not size — a 27-applicant posting with half
                  its pipeline in screening should look better than an
                  86-applicant one sitting untouched, and it does. Row size is
                  carried by the total beside the name instead.

                  gap-[2px] is the surface gap the segments need: two fills
                  meeting edge to edge read as one shape with a colour change
                  in the middle, which is exactly the boundary a reader is
                  trying to find. */}
              <div className="mt-1.5 flex h-2.5 gap-[2px]">
                {ROLE_STAGES.map((stage) => {
                  const count = row[stage];
                  if (count === 0) return null;

                  return (
                    <span
                      key={stage}
                      className={cn(
                        "h-full first:rounded-l-[3px] last:rounded-r-[3px]",
                        STAGE_PAINT[stage].fill,
                      )}
                      style={{ width: `${(count / total) * 100}%` }}
                    />
                  );
                })}
              </div>

              {/* What segment length says to everyone else. Written as one
                  sentence rather than a nested list because a screen reader
                  reading five list items per row, five rows deep, buries the
                  comparison the chart exists to make. */}
              <p className="sr-only">
                {ROLE_STAGES.filter((stage) => row[stage] > 0)
                  .map((stage) => `${stage} ${row[stage]}`)
                  .join(", ")}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
