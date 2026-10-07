import type { Metadata } from "next";

import { CalendarIcon, SearchIcon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { CompanyTile } from "@/components/ui/company-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";
import { DayLink } from "../local-time";
import { STAGE_ORDER, type StageKey } from "../stage-colors";
import { nextEvent, timelineOf } from "../tracker";
import { ApplicationsBoard } from "./board";
import { getApplications, getNow } from "./data";
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
 * grid or a list, from the tracker fixture in ./data.ts.
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
 * Nothing writes yet. The board's column menus and an offer card's button are
 * still inert, and a card opens its panel rather than an editor.
 */
export default async function ApplicationsPage({ searchParams }: PageProps<"/applications">) {
  const query = parseQuery(await searchParams);
  const now = getNow();
  const all = getApplications();

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
      {/* Wraps below sm, where the title and the switcher don't share a
          line. items-start, as on the Dashboard, so the switcher sits level
          with the title rather than the subtitle. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
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
          shown.length === 0 && (
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
          )
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
          tile={<CompanyTile Icon={open.Icon} size="md" tone="outline" />}
          steps={timelineOf(open, now)}
          closeHref={applicationsHref(query, { app: null })}
          footer={
            // The week of what it is waiting on, or of when it went in.
            <DayLink
              at={nextEvent(open, now)?.at ?? open.appliedOn ?? open.savedOn}
              view="week"
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              <CalendarIcon className="size-4" />
              Show on Calendar
            </DayLink>
          }
        />
      )}
    </div>
  );
}
