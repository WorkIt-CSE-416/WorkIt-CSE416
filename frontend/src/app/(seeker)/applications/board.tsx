import { CalendarIcon, EllipsisIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CompanyTile } from "@/components/ui/company-tile";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

import { STAGE_COLOR, STAGE_ICON } from "../stage-colors";
import { COLUMNS, type Application } from "./data";
import { MatchBadge } from "./match-badge";

/**
 * The applications grouped into pipeline columns, in the shadcn kanban layout.
 *
 * WHAT CHANGED AND WHY: the earlier board drew bare columns of cards on the page
 * and marked each card's stage with a 3px accent along its top edge. This design
 * puts every column inside its own recessed panel, which is a stronger grouping
 * than a coloured edge — so the edge is gone from the card, and the PANEL
 * carries the stage: each column is tinted in its stage's colour
 * (../stage-colors.ts) with a faint border in the same hue, the colours the
 * Dashboard's pipeline uses, and its header leads with the stage's icon, the
 * same glyph as that stage's badge there. The cards inside stay plain white,
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
 * Nothing is interactive yet, so the column's menu button is inert like the
 * rest of KAN-43. The design's per-column add button has been removed. Its drag
 * handle is deliberately not here either — a handle that cannot be dragged
 * invites a gesture that does nothing, which is worse than a menu button that
 * does nothing.
 */
function ApplicationCard({ item }: { item: Application }) {
  const { Icon } = item;

  return (
    <Card as="li" padding="sm" selected={item.active} className="flex flex-col gap-2.5">
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
          <h3 className="text-subtitle text-ink line-clamp-2 leading-5">{item.role}</h3>
          <p className="text-note text-ink-meta mt-1 truncate">{item.company}</p>
        </div>
      </div>

      {item.summary && <p className="text-note text-ink-meta line-clamp-2">{item.summary}</p>}

      {/* The one place an application's next commitment appears on the board —
          the design has no slot for it, and dropping it would lose the only
          forward-looking thing a card says. An icon rather than a grey box:
          the box was a third nested panel (column, card, box). The icon is
          grey, not brand: the calendar is the Interviewing glyph and violet is
          the Applied colour, so a coloured one put a second stage on every
          card. The dark, medium-weight label is what marks it to act on. */}
      {item.next && (
        <div className="flex items-start gap-2">
          <CalendarIcon className="text-ink-meta mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-note text-ink font-medium">{item.next.label}</p>
            <p className="text-note text-ink-meta">{item.next.when}</p>
          </div>
        </div>
      )}

      <div className="border-border-subtle flex items-center justify-between gap-2 border-t pt-2.5">
        <p className="text-note text-ink-meta min-w-0 truncate">{item.meta.text}</p>
        <MatchBadge score={item.match} />
      </div>

      {/* Also not in the design. An offer has a date it expires on, so the one
          card carrying a deadline keeps its action; the saved cards' "Apply"
          link and bookmark are dropped, because opening the card can do both
          and neither is time-critical. */}
      {item.cta && (
        <Button variant="positive" className="w-full">
          {item.cta}
        </Button>
      )}
    </Card>
  );
}

export function ApplicationsBoard() {
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
      aria-label="Applications board"
      tabIndex={0}
      className="focus-visible:ring-brand-ring rounded-card relative mt-4 overflow-x-auto focus-visible:ring-2 focus-visible:outline-none"
    >
      <div className="grid grid-cols-[repeat(4,minmax(13.5rem,1fr))] items-start gap-3">
        {COLUMNS.map((column) => {
          const StageIcon = STAGE_ICON[column.stage];

          return (
            <section
              key={column.title}
              aria-labelledby={`col-${column.title}`}
              className={cn("rounded-card border p-2", STAGE_COLOR[column.stage].panel)}
            >
              <header className="flex items-center gap-2 px-1 pb-2">
                {/* The stage's glyph in its solid colour, as the Dashboard's
                  pipeline badges draw it, so a column and its badge there
                  read as the same stage. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-white",
                    STAGE_COLOR[column.stage].fill,
                  )}
                >
                  <StageIcon className="size-3.5" />
                </span>
                {/* text-subtitle rather than SectionHeading's text-title: the
                  column is a panel inside the page now, not a section of it,
                  and a 20px heading would outweigh the cards it labels. */}
                <h2 id={`col-${column.title}`} className="text-subtitle text-ink">
                  {column.title}
                </h2>
                <span
                  className={cn(
                    "bg-panel text-meta rounded-full px-1.5 py-0.5 font-semibold",
                    STAGE_COLOR[column.stage].onTint,
                  )}
                >
                  {column.items.length}
                </span>

                <span className="ml-auto flex items-center">
                  <IconButton label={`${column.title} column options`} tooltip="Column options">
                    <EllipsisIcon className="size-4" />
                  </IconButton>
                </span>
              </header>

              <ul className="flex flex-col gap-2">
                {column.items.map((item) => (
                  <ApplicationCard key={item.role} item={item} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
