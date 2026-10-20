import { CloudOff } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BookmarkIcon, SearchIcon } from "@/components/icons";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";
import { STAGE_ORDER, type StageKey } from "../stage-colors";
import { getTracker } from "./data";
import { ClearFiltersLink, FilterBar } from "./filter-bar";
import { ApplicationsGrid } from "./grid";
import { ApplicationsList } from "./list";
import { applicationHref, filterApplications, filterOptions, parseQuery } from "./query";
import { ViewPanes } from "./view-panes";
import { ViewSwitcher } from "./view-switcher";

export const metadata: Metadata = {
  title: "Applications",
  description: "Track and manage your career progress.",
};

/**
 * /applications — every application the seeker is tracking, as a list (the
 * default) or a grid (./data.ts): their saved and applied jobs, live
 * (KAN-261). Interviewing and Offer stay empty until the API stores those
 * stages. The board is archived (KAN-256).
 *
 * The URL carries all of it (./query.ts): the view, the stage chips, search
 * and Filter button in the filter bar, and the list's sort. So the filtering
 * stays on the server, and the Dashboard can link straight to a filtered
 * list or one application. The list's column layout is the browser's own
 * (./column-layout.ts).
 *
 * BOTH LAYOUTS ARE RENDERED, each with its own links, and
 * ./view-panes.tsx shows the one the URL names. The layout switch moves the
 * URL in place, so a new layout appears with the switch's thumb rather than
 * after this page is drawn again. Filters and the sort still come through
 * here, since the filtering is done on the server; the list sorts itself.
 *
 * Nothing here writes. A job's Save button and its Applied button (or auto
 * apply) put it in Saved and Applied; nothing moves a card past Applied yet.
 * A card or row opens the application's own page (./[jobId], KAN-256),
 * which replaced a side panel here.
 *
 * Three empty states, in order: the API failed (says so, never stand-in
 * cards: backend/CLAUDE.md), nothing is tracked yet (points to the Jobs
 * page), or the filters hide everything (Clear Filters).
 */
export default async function ApplicationsPage({ searchParams }: PageProps<"/applications">) {
  const query = parseQuery(await searchParams);
  // The side panel's old links (the Dashboard's Next Up, a bookmark) open
  // the application's own page instead (KAN-256).
  if (query.app) redirect(applicationHref(query.app));
  const { applications, error } = await getTracker();
  const all = applications ?? [];

  // The search and the Filter button, for the chips' counts: each says what
  // turning its stage on would show. Then the stages too, for the views.
  const searched = filterApplications(all, { ...query, stages: [] });
  const shown = filterApplications(searched, query);
  const counts = Object.fromEntries(
    STAGE_ORDER.map((stage) => [stage, searched.filter((app) => app.stage === stage).length]),
  ) as Record<StageKey, number>;

  return (
    // EVERY PIXEL THE PANEL GIVES (KAN-256): no width cap, and when the
    // sidebar collapses the page takes back the room the shell holds empty.
    // The shell keeps pages at their open-sidebar width (--panel-gain, "A
    // PAGE KEEPS THE WIDTH" in ../layout.tsx) so layouts never rearrange
    // mid-collapse; this page's list is a table that scrolls sideways, so
    // the room only shows more columns. A negative margin of half the gain on
    // each side widens the page itself, easing with the panel, while its
    // @…/main queries still see the open width, so nothing on it reflows.
    // Reading pages keep --container-app: text past ~80 characters a line is
    // hard to follow.
    <div className={cn("-mx-[calc(var(--panel-gain)/2)] flex-1 py-6", SEEKER_GUTTER)}>
      {/* The switcher is two glyphs, so it fits beside the title at every
          width: the subtitle wraps rather than pushing it onto a line of its
          own. items-start, as on the Dashboard, so the switcher sits level
          with the title rather than the subtitle. */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-heading text-ink">My Applications</h1>
          <p className="text-body text-ink-meta mt-1">Track and manage your career progress.</p>
        </div>

        <ViewSwitcher />
      </div>

      <FilterBar counts={counts} options={filterOptions(all, query.filters)} />

      {/* The board (./board.tsx) is archived (KAN-256); ./query.ts says how to
          bring it back. Its pane was <ApplicationsBoard applications={shown}
          stages={query.stages.length > 0 ? query.stages : STAGE_ORDER}
          query={{ ...query, view: "board" }} />, keyed on query.stages in ./view-panes.tsx. */}
      <ViewPanes
        panes={
          shown.length === 0
            ? null
            : {
                grid: <ApplicationsGrid applications={shown} />,
                list: <ApplicationsList applications={shown} />,
              }
        }
        empty={
          shown.length === 0 &&
          (error != null ? (
            <EmptyState
              Icon={CloudOff}
              title="Applications Aren't Loading"
              className="mt-4"
              detail={process.env.NODE_ENV === "development" ? error : undefined}
            >
              We couldn&apos;t reach your saved and applied jobs. Refresh the page in a few minutes.
            </EmptyState>
          ) : all.length === 0 ? (
            <EmptyState
              Icon={BookmarkIcon}
              title="Nothing Saved Yet"
              className="mt-4"
              action={
                <ButtonLink href="/jobs" variant="secondary" size="sm">
                  <SearchIcon className="size-4" />
                  Find Jobs
                </ButtonLink>
              }
            >
              Save a job, or mark one as applied, and it shows up here.
            </EmptyState>
          ) : (
            <EmptyState
              Icon={SearchIcon}
              title="No Matching Applications"
              className="mt-4"
              action={
                <ClearFiltersLink className={buttonClasses({ variant: "secondary", size: "sm" })} />
              }
            >
              Nothing you&apos;re tracking matches these filters.
            </EmptyState>
          ))
        }
      />
    </div>
  );
}
