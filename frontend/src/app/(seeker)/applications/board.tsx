import { CalendarIcon, EllipsisIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CompanyTile } from "@/components/ui/company-tile";
import { IconButton } from "@/components/ui/icon-button";

import { COLUMNS, type Application } from "./data";
import { MatchBadge } from "./match-badge";

/**
 * The applications grouped into pipeline columns, in the shadcn kanban layout.
 *
 * WHAT CHANGED AND WHY: the earlier board drew bare columns of cards on the page
 * and marked each card's stage with a 3px accent along its top edge. This design
 * puts every column inside its own recessed panel, which is a stronger grouping
 * than a coloured edge — so the accent edge is gone from the card, and the panel
 * around it is the only place the stage shows.
 *
 * Adapted rather than copied, for the same reason as the grid: the source is
 * monochrome with a black primary button and red/amber/blue priority dots, and
 * WorkIt has a palette of its own. Structure is what carries over — a panelled
 * column, a card of title + description + a company/match row + a ruled
 * footer of small facts. The design's footer counts (attachments, comments) were
 * dropped as noise the card did not need.
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
      <div>
        <h3 className="text-subtitle text-ink leading-5">{item.role}</h3>
        {item.summary && (
          <p className="text-note text-ink-meta mt-1 line-clamp-2">{item.summary}</p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <CompanyTile Icon={Icon} size="sm" tone={item.tone ?? "brand"} />
          <span className="text-note text-ink-meta truncate">{item.company}</span>
        </span>
        <MatchBadge score={item.match} />
      </div>

      {/* The one place an application's next commitment appears on the board —
          the design has no slot for it, and dropping it would lose the only
          forward-looking thing a card says. */}
      {item.next && (
        <div className="bg-well rounded-control flex items-start gap-2 p-2">
          <CalendarIcon className="text-ink-meta mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-note text-ink font-medium">{item.next.label}</p>
            <p className="text-meta text-ink-meta">{item.next.when}</p>
          </div>
        </div>
      )}

      <div className="border-border-subtle flex items-center gap-2 border-t pt-2.5">
        <span className="text-meta text-ink-meta flex min-w-0 items-center gap-1">
          <CalendarIcon className="size-3.5 shrink-0" />
          <span className="truncate">{item.meta.text}</span>
        </span>
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
    /* The strip scrolls sideways: four panelled columns are wider than the
       928px content column at any comfortable width. The scrollport is exactly
       that column, so the board is cut off at the same right edge as the
       buttons above it rather than running on into the page margin. It used to
       bleed to the window edge on a calc(50% - 50vw) negative margin; the
       margin is part of the layout, so the board stops at it now.

       `relative` is what keeps the scrolling here and off the page. The match
       badges carry sr-only labels, which are absolutely positioned, and an
       absolute box is clipped only by an overflow ancestor that is also its
       containing block. Without it their containing block is the shell's
       scroller, so the labels on the off-screen columns escape this div and
       make the whole page scroll sideways — by about 100px, when the card
       counts that used to sit in the footer did exactly that. */
    <div className="relative mt-4 overflow-x-auto">
      <div className="flex w-max items-start gap-4">
        {COLUMNS.map((column) => (
          <section
            key={column.title}
            aria-labelledby={`col-${column.title}`}
            className="bg-well border-border-subtle rounded-card w-72 shrink-0 border p-2"
          >
            <header className="flex items-center gap-2 px-1 pb-2">
              {/* text-subtitle rather than SectionHeading's text-title: the
                  column is a panel inside the page now, not a section of it,
                  and a 20px heading would outweigh the cards it labels. */}
              <h2 id={`col-${column.title}`} className="text-subtitle text-ink">
                {column.title}
              </h2>
              <span className="bg-panel border-border-subtle text-meta text-ink-meta rounded-full border px-1.5 py-0.5">
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
        ))}
      </div>
    </div>
  );
}
