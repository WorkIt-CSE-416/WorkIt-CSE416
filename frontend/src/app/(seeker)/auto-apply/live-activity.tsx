"use client";

import { useRunnerJob } from "@/lib/autofill-extension";

import { ActivityList, type ActivityItem } from "./activity-list";

/**
 * Live Activity's list, with the one row the server cannot know: the
 * queued job posting open in the extension's run tab reads Working in
 * Browser (useRunnerJob), in flight, and loses its cross, since taking it
 * out of the queue would leave the tab on a job that is gone. Every
 * other row is as the server drew it (./activity-list.tsx).
 */
export function LiveActivity({ items, now }: { items: ActivityItem[]; now: Date }) {
  const runnerJob = useRunnerJob();
  return (
    <ActivityList
      items={items.map((item) =>
        item.status === "queued" && item.id === runnerJob
          ? { ...item, status: "browser", detail: "Open in a background tab" }
          : item,
      )}
      now={now}
    />
  );
}
