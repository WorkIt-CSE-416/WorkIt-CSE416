import type { Metadata } from "next";

import { FilterIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

import { ApplicationsBoard } from "./board";
import { ApplicationsGrid } from "./grid";
import { ApplicationsList } from "./list";
import { ViewSwitcher } from "./view-switcher";
import { parseView } from "./views";
import { SEEKER_GUTTER } from "../gutter";

export const metadata: Metadata = {
  title: "Applications",
  description: "Track and manage your career progress.",
};

/* KAN-43 renders the applications mockup only, against the fixture in ./data.
 * Nothing here reads or writes yet, so Filter, the column menus, the bookmarks
 * and the two card actions are all inert on purpose. The mockup's New Entry
 * button has been removed rather than left inert. */

export default async function ApplicationsPage({ searchParams }: PageProps<"/applications">) {
  const view = parseView((await searchParams).view);

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      {/* Wraps below sm, where the title and the controls don't share a
          line: the controls were shrink-0, so on a phone they pushed past the
          right edge and the whole page scrolled sideways. items-start, as on
          the Dashboard, so the controls sit level with the title rather than
          the subtitle. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-heading text-ink">My Applications</h1>
          <p className="text-body text-ink-meta mt-1">Track and manage your career progress.</p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <ViewSwitcher current={view} />
          <Button variant="secondary" size="sm">
            <FilterIcon className="size-4" />
            Filter
          </Button>
        </div>
      </div>

      {view === "grid" && <ApplicationsGrid />}
      {view === "list" && <ApplicationsList />}

      {view === "board" && <ApplicationsBoard />}
    </div>
  );
}
