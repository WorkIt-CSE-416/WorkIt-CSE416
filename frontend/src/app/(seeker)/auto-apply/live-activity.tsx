"use client";

import { CircleDot, Inbox } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { FieldFacet, type FacetOption } from "@/components/field-facet";
import { CloseIcon, FilterIcon } from "@/components/icons";
import { useShallowParams, useShallowPush } from "@/components/shallow-routing";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { useRunnerJob } from "@/lib/autofill-extension";

import type { RunStage } from "./actions";
import { ActivityList, activityOf, GROUPS, inboxOrder, STATUS } from "./activity-list";
import type { Application } from "./applications";
import { pollApplications } from "./desktop-actions";
import { activityHref, parseActivityQuery, STATUS_FILTERS, type StatusFilter } from "./query";
import { ReviewPane } from "./review-pane";

const STATUS_OPTIONS: FacetOption[] = STATUS_FILTERS.map((group) => ({
  value: group,
  label: GROUPS[group].label,
  Icon: GROUPS[group].Icon,
  iconClassName: GROUPS[group].ink,
}));

/** The stages that move without the seeker: while any row is in one, the
 *  list asks again every POLL_MS. */
const MOVING: RunStage[] = ["queued", "filling", "approved"];
const POLL_MS = 3_000;

/**
 * Live Activity as the Inbox (KAN-323, picked from the WorkIt Desktop
 * prototypes): the Status filter, then the list of applications on the left
 * (./activity-list.tsx) and the picked one's review on the right
 * (./review-pane.tsx). Below 896px of page the two stack.
 *
 * THE ROWS ARE THE SERVER'S, KEPT CURRENT HERE. The page reads them scored
 * (./applications.ts) and passes them in; while any is queued, filling or
 * approved, this re-reads the list every 3 seconds (pollApplications,
 * unscored) so Desktop's Workers and the extension's runner show as they
 * move, and keeps each job's score from the page's read. A refresh of the
 * route (Start, the cross) passes new rows in, which replace the polled
 * ones. Supabase Realtime can replace the poll later (auto-apply/desktop.md).
 *
 * It adds the one row the server cannot know: the queued job posting open
 * in the extension's run tab reads Working in Browser (useRunnerJob).
 *
 * THE PICK: a click on a row shows it on the right. With none picked, the
 * first application that needs review is shown; after Approve or Skip the
 * next one is. The pick is the page's own state, not the URL's.
 *
 * THE FILTER IS THE URL'S (./query.ts), read through shallow routing so a
 * pick redraws in the next frame. The Status dropdown is the Applications
 * page's (components/field-facet.tsx); Clear Filters is an outlined cross
 * while a status is picked. Both Clear Filters hand focus back to the
 * dropdown, since each leaves the page as it clears.
 */
export function LiveActivity({ applications }: { applications: Application<RunStage>[] }) {
  const query = parseActivityQuery(useShallowParams());
  const push = useShallowPush();
  const runnerJob = useRunnerJob();
  const statusButton = useRef<HTMLButtonElement>(null);
  const [picked, setPicked] = useState<string | null>(null);

  // The last poll, tied to the rows it followed: new rows from the server
  // make it stale at once, with no effect to clear it.
  const [polled, setPolled] = useState<{
    from: Application<RunStage>[];
    rows: Application<RunStage>[];
  } | null>(null);
  const current = polled?.from === applications ? polled.rows : applications;
  const moving = current.some((a) => MOVING.includes(a.stage));

  const refresh = useCallback(async () => {
    const { data } = await pollApplications();
    if (data) setPolled({ from: applications, rows: data });
  }, [applications]);

  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [moving, refresh]);

  const scores = new Map(applications.map((a) => [a.job.id, a.match ?? null]));
  const rows = inboxOrder(
    current.map((application) => {
      const item = activityOf(application);
      const match = item.match ?? scores.get(item.id) ?? null;
      return item.status === "queued" && item.id === runnerJob
        ? { ...item, match, status: "browser" as const, detail: "Open in a background tab" }
        : { ...item, match };
    }),
  );
  const shown =
    query.statuses.length === 0
      ? rows
      : rows.filter((item) => query.statuses.includes(STATUS[item.status].group));
  const selected =
    rows.find((item) => item.id === picked) ?? shown.find((item) => item.status === "review");

  /** After Approve or Skip: the next review, then the list read again. */
  function done(id: string) {
    setPicked(shown.find((item) => item.status === "review" && item.id !== id)?.id ?? null);
    void refresh();
  }

  const setStatuses = (statuses: string[]) =>
    push(activityHref(query, { statuses: statuses as StatusFilter[] }), undefined, {
      replace: true,
    });
  const clearFilters = () => {
    statusButton.current?.focus();
    setStatuses([]);
  };
  const reviews = rows.filter((item) => item.status === "review").length;

  return (
    <>
      <div className="mt-3 flex items-center gap-2">
        <FieldFacet
          ref={statusButton}
          label="Status"
          Icon={CircleDot}
          options={STATUS_OPTIONS}
          values={query.statuses}
          onChange={setStatuses}
          className="min-w-36"
        />
        {query.statuses.length > 0 && (
          <IconButton
            label="Clear filters"
            variant="outline"
            className="animate-fade size-9 shrink-0"
            onClick={clearFilters}
          >
            <CloseIcon className="size-4" />
          </IconButton>
        )}
        {reviews > 0 && (
          <p className="text-note text-ink-meta ml-auto">
            {reviews} {reviews === 1 ? "needs" : "need"} your review
          </p>
        )}
      </div>

      {shown.length > 0 ? (
        <div className="mt-3 grid items-start gap-4 @4xl/main:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Card padding="none" className="max-h-[75vh] overflow-y-auto">
            <ActivityList items={shown} selected={selected?.id ?? null} onSelect={setPicked} />
          </Card>
          {selected ? (
            <Card padding="lg" className="@4xl/main:sticky @4xl/main:top-4">
              <ReviewPane key={selected.id} item={selected} onDone={() => done(selected.id)} />
            </Card>
          ) : (
            <EmptyState Icon={Inbox} title="Nothing to Review">
              Applications land here for your review as WorkIt Desktop fills them. Pick any job on
              the left to see where it stands.
            </EmptyState>
          )}
        </div>
      ) : (
        <EmptyState
          Icon={FilterIcon}
          title="No Jobs With That Status"
          className="mt-3"
          action={
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              Clear Filters
            </Button>
          }
        >
          Pick another status, or show them all.
        </EmptyState>
      )}
    </>
  );
}
