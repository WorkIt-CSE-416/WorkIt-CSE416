import Link from "next/link";

import { EllipsisIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CompanyTile } from "@/components/ui/company-tile";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

import { STAGE_COLOR, STAGE_ICON, STAGE_LABEL, type StageKey } from "../stage-colors";
import { nextEvent, sinceLabel, type Application } from "../tracker";
import { MatchBadge } from "./match-badge";
import { NextStep } from "./next-step";
import { applicationsHref, type ApplicationsQuery } from "./query";
import { Reflow } from "./reflow";

/**
 * The applications grouped into pipeline columns, in the shadcn kanban layout.
 *
 * WHAT CHANGED AND WHY: the earlier board drew bare columns of cards on the page
 * and marked each card's stage with a 3px accent along its top edge. This design
 * puts every column inside its own recessed panel, which is a stronger grouping
 * than a coloured edge — so the edge is gone from the card, and the PANEL
 * carries the stage: each column is tinted in its stage's colour
 * (../stage-colors.ts) with a faint border in the same hue, the colours the
 * Dashboard's Up Next uses, and its header leads with the stage's icon, the
 * same glyph as that stage's rows there. The cards inside stay plain white,
 * so the colour groups them without decorating each one.
 *
 * Adapted rather than copied, for the same reason as the grid: the source is
 * monochrome with a black primary button and red/amber/blue priority dots, and
 * WorkIt has a palette of its own. Structure is what carries over — a panelled
 * column, a card of company + title, a description, and a ruled footer of
 * small facts, which is where the match sits. The design's footer counts
 * (attachments, comments) were dropped as noise the card did not need.
 *
 * Its "priority" pill has no equivalent here, and inventing one would have meant
 * inventing both the field and two palette colours. The slot held a stage pill
 * for a while, but the column heading already names the stage, so a card no
 * longer repeats it; that also drops an application's `status` ("Round 2") from
 * the board.
 *
 * A CARD OPENS ITS APPLICATION: the role is a link to the detail panel
 * (./detail-panel.tsx), stretched over the whole card, so the card is one
 * target and a keyboard reaches it in one stop. The column's menu button is
 * still inert. The design's per-column add button has been removed. Its drag
 * handle is deliberately not here either — a handle that cannot be dragged
 * invites a gesture that does nothing, which is worse than a menu button that
 * does nothing.
 *
 * The stage filter picks which columns show, and the search narrows the
 * cards inside them; a column the search empties says so rather than
 * collapsing, so the board keeps its shape.
 */
function ApplicationCard({
  item,
  href,
  now,
  delay,
}: {
  item: Application;
  href: string;
  now: Date;
  /** Its place in the entrance cascade, in ms. */
  delay: number;
}) {
  const { Icon } = item;

  return (
    <Card
      as="li"
      padding="sm"
      // Rises in on arrival, after the cards before it, and lifts 2px under
      // the pointer, since the whole card is one target; it settles back
      // down on press. See "Motion" in frontend/CLAUDE.md.
      className="hover:border-brand/40 hover:shadow-lift ease-glide animate-rise relative flex flex-col gap-2.5 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Who and what together: the company tile leads the title, the way a
          job card does. The tile is the neutral outline: a tinted one used
          the Applied violet (or the Offer green) and so carried a stage of
          its own, which the column heading already names. The match lives in
          the footer, so the role and company get the card's whole width. The
          title clamps at two lines and the block holds two lines' height, so
          every card's summary starts at the same depth. */}
      <div className="flex items-start gap-2.5">
        <CompanyTile Icon={Icon} size="sm" tone="outline" />
        <div className="min-h-15 min-w-0 flex-1">
          <h3 className="text-subtitle text-ink line-clamp-2 leading-5">
            <Link
              href={href}
              scroll={false}
              className="after:rounded-card focus-visible:after:ring-brand-ring after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2"
            >
              {item.role}
            </Link>
          </h3>
          <p className="text-note text-ink-meta mt-1 truncate">{item.company}</p>
        </div>
      </div>

      {item.summary && <p className="text-note text-ink-meta line-clamp-2">{item.summary}</p>}

      {/* The one place an application's next commitment appears on the board —
          the design has no slot for it, and dropping it would lose the only
          forward-looking thing a card says. The grid and list draw the same
          block (./next-step.tsx). */}
      <NextStep next={nextEvent(item, now)} />

      <div className="border-border-subtle flex items-center justify-between gap-2 border-t pt-2.5">
        <p className="text-note text-ink-meta min-w-0 truncate">{sinceLabel(item)}</p>
        <MatchBadge score={item.match} />
      </div>

      {/* Also not in the design. An offer has a date it expires on, so the one
          card carrying a deadline keeps its action; the saved cards' "Apply"
          link and bookmark are dropped, because opening the card can do both
          and neither is time-critical. */}
      {item.cta && (
        <Button variant="positive" className="relative w-full">
          {item.cta}
        </Button>
      )}
    </Card>
  );
}

export function ApplicationsBoard({
  applications,
  stages,
  query,
  now,
}: {
  applications: Application[];
  /** The columns to draw, in order: every stage unless the filter picks some. */
  stages: StageKey[];
  query: ApplicationsQuery;
  now: Date;
}) {
  return (
    /* The four columns share the content column as equal grid tracks, so
       every stage, Offer included, is on screen at a desktop width. They used
       to be fixed 288px columns in a 1200px strip, which left Offer a 16px
       sliver at the right edge of the 928px column. Each track keeps a 216px
       floor: below about 900px of page the strip scrolls sideways instead of
       squeezing a card past legibility, and the scrollport is still exactly
       the content column, cut off at the same right edge as the buttons
       above. It is a named region with a tab stop so a keyboard can scroll
       it too.

       `relative` is what keeps the scrolling here and off the page. The match
       badges carry sr-only labels, which are absolutely positioned, and an
       absolute box is clipped only by an overflow ancestor that is also its
       containing block. Without it their containing block is the shell's
       scroller, so the labels on the off-screen columns escape this div and
       make the whole page scroll sideways — by about 100px, when the card
       counts that used to sit in the footer did exactly that. */
    <div
      role="region"
      aria-label="Applications Board"
      tabIndex={0}
      className="focus-visible:ring-brand-ring rounded-card relative mt-4 overflow-x-auto focus-visible:ring-2 focus-visible:outline-none"
    >
      {/* As many tracks as columns, so two filtered stages share the width
          the four did. An inline style because the count is data: a class
          Tailwind has not seen in the source is never generated. */}
      <div
        className="grid items-start gap-3"
        style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(13.5rem, 1fr))` }}
      >
        {stages.map((stage, column) => {
          const StageIcon = STAGE_ICON[stage];
          const title = STAGE_LABEL[stage];
          const items = applications.filter((item) => item.stage === stage);

          return (
            <section
              key={stage}
              aria-labelledby={`col-${stage}`}
              className={cn("rounded-card border p-2", STAGE_COLOR[stage].panel)}
            >
              <header className="flex items-center gap-2 px-1 pb-2">
                {/* The stage's glyph in its solid colour, as the Dashboard's
                  Up Next rows draw it, so a column and its rows there read
                  as the same stage. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-white",
                    STAGE_COLOR[stage].fill,
                  )}
                >
                  <StageIcon className="size-3.5" />
                </span>
                {/* text-subtitle rather than SectionHeading's text-title: the
                  column is a panel inside the page now, not a section of it,
                  and a 20px heading would outweigh the cards it labels. */}
                <h2 id={`col-${stage}`} className="text-subtitle text-ink">
                  {title}
                </h2>
                <span
                  className={cn(
                    "bg-panel text-meta rounded-full px-1.5 py-0.5 font-semibold",
                    STAGE_COLOR[stage].onTint,
                  )}
                >
                  {items.length}
                </span>

                <span className="ml-auto flex items-center">
                  <IconButton label={`${title} column options`} tooltip="Column options">
                    <EllipsisIcon className="size-4" />
                  </IconButton>
                </span>
              </header>

              {items.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {items.map((item, row) => (
                    <Reflow key={item.id}>
                      <ApplicationCard
                        item={item}
                        href={applicationsHref(query, { app: item.id })}
                        now={now}
                        // Left to right, then down: 30ms a column, 40ms a row,
                        // so the board fills in like a sweep, not all at once.
                        delay={column * 30 + Math.min(row, 5) * 40}
                      />
                    </Reflow>
                  ))}
                </ul>
              ) : (
                <p className="text-note text-ink-meta px-1 pb-2">No matches in {title}.</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
