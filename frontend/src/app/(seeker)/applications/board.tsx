import { CalendarIcon, EllipsisIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CompanyTile } from "@/components/ui/company-tile";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

import { COLUMNS, type Application, type Column } from "./data";
import { CommentIcon, PaperclipIcon, PlusIcon } from "./icons";
import { ProgressRing } from "./progress-ring";

/**
 * The applications grouped into pipeline columns, in the shadcn kanban layout.
 *
 * WHAT CHANGED AND WHY: the earlier board drew bare columns of cards on the page
 * and marked each card's stage with a 3px accent along its top edge. This design
 * puts every column inside its own recessed panel, which is a stronger grouping
 * than a coloured edge — so the accent edge is gone from the card and the stage
 * now shows up in the ring, the dot on the stage pill, and the panel around it.
 *
 * Adapted rather than copied, for the same reason as the grid: the source is
 * monochrome with a black primary button and red/amber/blue priority dots, and
 * WorkIt has a palette of its own. Structure is what carries over — a panelled
 * column, a card of title + description + a company/progress row + a ruled
 * footer of small facts.
 *
 * Its "priority" pill has no equivalent here, and inventing one would have meant
 * inventing both the field and two palette colours. The slot takes the thing an
 * application actually has: its status where there is one ("Round 2"), and its
 * stage otherwise, dotted in the stage's colour.
 *
 * Nothing is interactive yet, so the column's add and menu buttons are inert
 * like the rest of KAN-43. The design's drag handle is deliberately not here —
 * a handle that cannot be dragged invites a gesture that does nothing, which is
 * worse than a menu button that does nothing.
 */
const DOT = {
  pale: "bg-brand-pale",
  brand: "bg-brand",
  positive: "bg-positive",
} as const;

function StagePill({ label, accent }: { label: string; accent: Column["accent"] }) {
  return (
    <span className="border-border-subtle text-meta text-ink-muted inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5">
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT[accent])} />
      {label}
    </span>
  );
}

function Count({
  Icon,
  value,
  label,
}: {
  Icon: typeof PaperclipIcon;
  value: number;
  label: string;
}) {
  return (
    <span className="text-meta text-ink-meta flex items-center gap-1">
      <Icon className="size-3.5" />
      {value}
      <span className="sr-only">{label}</span>
    </span>
  );
}

function ApplicationCard({ item, column }: { item: Application; column: Column }) {
  const { Icon } = item;
  const { accent } = column;

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
        <ProgressRing value={column.progress} accent={accent} />
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
        <StagePill label={item.status ?? column.title} accent={accent} />
        <span className="text-meta text-ink-meta flex min-w-0 items-center gap-1">
          <CalendarIcon className="size-3.5 shrink-0" />
          <span className="truncate">{item.meta.text}</span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {item.documents !== undefined && (
            <Count Icon={PaperclipIcon} value={item.documents} label="documents sent" />
          )}
          {item.notes !== undefined && (
            <Count Icon={CommentIcon} value={item.notes} label="notes" />
          )}
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
       928px content column at any comfortable width. The negative margin moves
       only the scrollport — the first column stays aligned with the heading
       above it, while the last runs to the edge of the window instead of
       stopping short of it with empty page alongside.
       calc(50% - 50vw) is that distance: 50% is half the 928px content column,
       50vw half the window, so the two cancel to exactly -48px at 1024 and grow
       from there. (On a platform with classic, space-taking scrollbars 100vw is
       a scrollbar wider than the client area, so this can overshoot by that
       much; overlay scrollbars, which is everything current, are exact.) */
    <div className="mt-4 mr-[calc(50%-50vw)] overflow-x-auto">
      <div className="flex w-max items-start gap-4 pr-12">
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

              <span className="ml-auto flex items-center gap-0.5">
                <IconButton label={`Add an application to ${column.title}`}>
                  <PlusIcon className="size-4" />
                </IconButton>
                <IconButton label={`${column.title} column options`}>
                  <EllipsisIcon className="size-4" />
                </IconButton>
              </span>
            </header>

            <ul className="flex flex-col gap-2">
              {column.items.map((item) => (
                <ApplicationCard key={item.role} item={item} column={column} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
