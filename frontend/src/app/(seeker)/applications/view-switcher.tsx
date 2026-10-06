import Link from "next/link";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { cn } from "@/lib/cn";

import { BoardIcon, GridIcon, ListIcon } from "./icons";
import { applicationsHref, type ApplicationsQuery, type View } from "./query";

/**
 * Picks the layout the applications are drawn in.
 *
 * Links rather than buttons: each option is a real URL, so the choice can be
 * bookmarked and shared, the back button undoes it, and this stays a server
 * component. The trade is that switching is a navigation, which is acceptable
 * for a page already server-rendered from a fixture.
 *
 * The mockup pairs grid and list. Board leads here because it is the default
 * and the richest of the three, so the row reads in the order a new user meets
 * them rather than the order they were designed.
 *
 * `aria-current` is what marks the active option; the raised segment is
 * decoration on top of it. Every option is icon-only, so every option is named,
 * and the name is its tooltip — the same pairing IconButton makes, written out
 * here because these are links rather than buttons.
 *
 * The raised segment carries a 1px ring as well as its shadow: white on the
 * well's grey is 1.07:1, so without an edge the active option barely shows.
 * Each option is 26px, which with the well's padding and border makes the
 * group 32px, the height of the stage chips below it.
 *
 * Switching keeps the filters, so a search survives a change of layout. It
 * closes the detail panel, which belongs to the view it was opened from.
 */
const OPTIONS: { view: View; label: string; Icon: typeof BoardIcon }[] = [
  { view: "board", label: "Board", Icon: BoardIcon },
  { view: "grid", label: "Grid", Icon: GridIcon },
  { view: "list", label: "List", Icon: ListIcon },
];

export function ViewSwitcher({ query }: { query: ApplicationsQuery }) {
  return (
    <div
      role="group"
      aria-label="Layout"
      className="bg-well border-border-subtle rounded-control flex shrink-0 items-center gap-0.5 border p-0.5"
    >
      {OPTIONS.map(({ view, label, Icon }) => {
        const isActive = view === query.view;

        return (
          <Tooltip key={view}>
            <TooltipTrigger
              render={
                <Link
                  href={applicationsHref(query, { view, app: null })}
                  aria-label={`${label} View`}
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "focus-visible:ring-brand-ring flex size-6.5 items-center justify-center rounded-[0.375rem] focus-visible:ring-2 focus-visible:outline-none",
                    isActive
                      ? "bg-panel text-ink ring-border shadow-panel ring-1"
                      : "text-ink-meta hover:text-ink hover:bg-panel/60",
                  )}
                />
              }
            >
              <Icon className="size-4" />
            </TooltipTrigger>
            <TooltipContent>{label} View</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
