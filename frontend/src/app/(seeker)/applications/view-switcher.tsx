import { SegmentedLinks } from "@/components/ui/segmented-control";

import { BoardIcon, GridIcon, ListIcon } from "./icons";
import { applicationsHref, type ApplicationsQuery } from "./query";

/**
 * Picks the layout the applications are drawn in: the shared segmented
 * control (ui/segmented-control.tsx), with a glyph per option, each named by
 * its tooltip.
 *
 * Links rather than buttons: each option is a real URL, so the choice can be
 * bookmarked and shared, the back button undoes it, and every view stays a
 * server component. The thumb slides on the click, ahead of the page.
 *
 * The mockup pairs grid and list. Board leads here because it is the default
 * and the richest of the three, so the row reads in the order a new user meets
 * them rather than the order they were designed.
 *
 * Switching keeps the filters, so a search survives a change of layout. It
 * closes the detail panel, which belongs to the view it was opened from.
 */
const OPTIONS = [
  { view: "board", label: "Board View", icon: <BoardIcon className="size-4" /> },
  { view: "grid", label: "Grid View", icon: <GridIcon className="size-4" /> },
  { view: "list", label: "List View", icon: <ListIcon className="size-4" /> },
] as const;

export function ViewSwitcher({ query }: { query: ApplicationsQuery }) {
  return (
    <SegmentedLinks
      label="Layout"
      value={query.view}
      options={OPTIONS.map(({ view, label, icon }) => ({
        value: view,
        label,
        icon,
        href: applicationsHref(query, { view, app: null }),
      }))}
    />
  );
}
