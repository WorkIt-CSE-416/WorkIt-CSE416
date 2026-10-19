import { CloudOff } from "lucide-react";
import type { Metadata } from "next";

import { ArrowRightIcon, BookmarkIcon, SearchIcon } from "@/components/icons";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";
import { STAGE_ORDER, type StageKey } from "../stage-colors";
import { timelineOf } from "../tracker";
import { ApplicationTile } from "./application-tile";
import { ApplicationsBoard } from "./board";
import { getNow, getTracker } from "./data";
import { DetailPanel } from "./detail-panel";
import { ClearFiltersLink, FilterBar } from "./filter-bar";
import { ApplicationsGrid } from "./grid";
import { ApplicationsList } from "./list";
import { applicationsHref, filterApplications, parseQuery, type View } from "./query";
import { ViewPanes } from "./view-panes";
import { ViewSwitcher } from "./view-switcher";

export const metadata: Metadata = {
  title: "Applications",
  description: "Track and manage your career progress.",
};

/**
 * /applications — every application the seeker is tracking, as a board, a
 * grid or a list (./data.ts): their saved and applied jobs, live (KAN-261).
 * Interviewing and Offer stay empty until the API stores those stages.
 *
 * The URL carries all of it (./query.ts): the view, the stage chips and
 * search in the filter bar, the list's sort, and ?app=, the application open
 * in the detail panel. So every view stays a server component, and the
 * Dashboard can link straight to a filtered list or one application.
 *
 * ALL THREE LAYOUTS ARE RENDERED, each with its own links, and
 * ./view-panes.tsx shows the one the URL names. The layout switch moves the
 * URL in place, so a new layout appears with the switch's thumb rather than
 * after this page is drawn again. Filters, the sort and ?app= still come
 * through here, since the filtering and the panel are done on the server.
 *
 * Nothing here writes. A job's Save button and its Applied button (or auto
 * apply) put it in Saved and Applied; nothing moves a card past Applied yet.
 * The board's column menus are still inert, and a card opens its panel
 * rather than an editor. A card's panel links to its job posting while the
 * posting is open.
 *
 * Three empty states, in order: the API failed (says so, never stand-in
 * cards: backend/CLAUDE.md), nothing is tracked yet (points to the Jobs
 * page), or the filters hide everything (Clear Filters).
 */
export default async function ApplicationsPage({ searchParams }: PageProps<"/applications">) {
  const query = parseQuery(await searchParams);
  const now = getNow();
  const { applications, error } = await getTracker();
  const all = applications ?? [];

  // The search alone, for the chips' counts: each says what turning its
  // stage on would show. Then the stages too, for the views.
  const searched = filterApplications(all, { stages: [], q: query.q });
  const shown = filterApplications(searched, query);
  const counts = Object.fromEntries(
    STAGE_ORDER.map((stage) => [stage, searched.filter((app) => app.stage === stage).length]),
  ) as Record<StageKey, number>;

  const open = query.app ? all.find((app) => app.id === query.app) : undefined;

  // Each layout's links carry its own layout, so whichever is shown, its
  // cards and sort headings keep it.
  const as = (view: View) => ({ ...query, view });

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      {/* The switcher is three glyphs, so it fits beside the title at every
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

      <FilterBar counts={counts} />

      <ViewPanes
        columns={query.stages.join(",")}
        panes={
          shown.length === 0
            ? null
            : {
                board: (
                  <ApplicationsBoard
                    applications={shown}
                    stages={query.stages.length > 0 ? query.stages : STAGE_ORDER}
                    query={as("board")}
                    now={now}
                  />
                ),
                grid: <ApplicationsGrid applications={shown} query={as("grid")} now={now} />,
                list: <ApplicationsList applications={shown} query={as("list")} now={now} />,
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

      {open && (
        <DetailPanel
          application={{
            id: open.id,
            role: open.role,
            company: open.company,
            stage: open.stage,
            status: open.status,
            summary: open.summary,
            match: open.match,
          }}
          tile={<ApplicationTile application={open} size="md" />}
          steps={timelineOf(open, now)}
          closeHref={applicationsHref(query, { app: null })}
          // Show on Calendar sat first here, hidden with the Calendar for now
          // (src/proxy.ts): a DayLink to the week of nextEvent(open, now)?.at
          // ?? open.appliedOn ?? open.savedOn.
          footer={
            open.jobHref && (
              <ButtonLink href={open.jobHref} variant="secondary" size="sm">
                View Job Posting
                <ArrowRightIcon className="size-3.5" />
              </ButtonLink>
            )
          }
        />
      )}
    </div>
  );
}
