"use client";

import { useShallowParams } from "@/components/shallow-routing";
import { SegmentedLinks } from "@/components/ui/segmented-control";

import { BoardIcon, GridIcon, ListIcon } from "./icons";
import { applicationsHref, parseQuery } from "./query";

/** The page's choices as it is showing them (components/shallow-routing.tsx).
 *  The layout moves in place, so anything that builds a link from the
 *  layout (the switcher, the filter bar, the pane shown) reads it here rather
 *  than from the server's render, which a layout switch never repeats. */
export function useApplicationsQuery() {
  return parseQuery(Object.fromEntries(useShallowParams()));
}

/**
 * Picks the layout the applications are drawn in: the shared segmented
 * control (ui/segmented-control.tsx), with a glyph per option, each named by
 * its tooltip.
 *
 * Each option is a real URL, so the choice can be bookmarked and shared and
 * the back button undoes it, but it moves the URL in place (`shallow`): the
 * server has already drawn all three layouts, and ./view-panes.tsx shows the
 * one the URL names, so the new layout appears with the thumb instead of a
 * round trip after it.
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

export function ViewSwitcher() {
  const query = useApplicationsQuery();

  return (
    <SegmentedLinks
      shallow
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
