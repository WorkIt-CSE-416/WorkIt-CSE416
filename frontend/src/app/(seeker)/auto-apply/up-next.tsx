"use client";

import { useRunnerJob } from "@/lib/autofill-extension";

import { ActivityTable, type ActivityItem } from "./activity-list";

/**
 * Up Next: the queue, in the order the extension takes it (oldest first),
 * each job with the resume it will go out with (./page.tsx, resumeFor).
 * Live Activity's table in its "queue" variant (./activity-list.tsx): the
 * Resume column in place of Date Applied, which a queued job never has, and
 * no sorting, since this order is the run's. The queued job open in the
 * extension's tab reads Working in Browser (useRunnerJob), as it did in Live
 * Activity, with its glyph that goes to the tab in place of the cross.
 */
export function UpNext({ items }: { items: ActivityItem[] }) {
  const runnerJob = useRunnerJob();
  const rows = items.map((item) =>
    item.id === runnerJob
      ? { ...item, status: "browser" as const, detail: "Open in a background tab" }
      : item,
  );
  return <ActivityTable items={rows} sort="queue" onSort={() => {}} variant="queue" />;
}
