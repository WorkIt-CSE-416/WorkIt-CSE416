import type { Metadata } from "next";

import { FilterIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

import { ApplicationsBoard } from "./board";
import { ApplicationsGrid } from "./grid";
import { PlusIcon } from "./icons";
import { ApplicationsList } from "./list";
import { ViewSwitcher } from "./view-switcher";
import { parseView } from "./views";

export const metadata: Metadata = {
  title: "Applications",
  description: "Track and manage your career progress.",
};

/* KAN-43 renders the applications mockup only, against the fixture in ./data.
 * Nothing here reads or writes yet, so Filter, New Entry, the column menus, the
 * bookmarks and the two card actions are all inert on purpose. */

export default async function ApplicationsPage({ searchParams }: PageProps<"/applications">) {
  const view = parseView((await searchParams).view);

  return (
    <main className="max-w-app mx-auto w-full flex-1 px-12 py-4.5">
      <div className="flex items-end justify-between gap-4">
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
          <Button size="sm">
            <PlusIcon className="size-4" />
            New Entry
          </Button>
        </div>
      </div>

      {view === "grid" && <ApplicationsGrid />}
      {view === "list" && <ApplicationsList />}

      {view === "board" && <ApplicationsBoard />}
    </main>
  );
}
