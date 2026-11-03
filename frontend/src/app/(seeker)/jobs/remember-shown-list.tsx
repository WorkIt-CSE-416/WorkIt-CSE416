"use client";

import { useEffect } from "react";

import type { ApplicationStage } from "../auto-apply/actions";
import { readKept } from "./feed-pages";
import type { ListSource } from "./list-pages";
import type { JobListing } from "./listings";
import { rememberList } from "./shown-list";

/** Hands the split view's first page to the rail, which draws the list there
 *  (./jobs-rail.tsx, KAN-519), as ./feed-list does for the large cards. An
 *  empty or failed list is written too, so the rail stops waiting. The pages
 *  the rail loaded come after it (./feed-pages), which only a return keeps:
 *  written alone, the first page cut the list short on Back. Draws nothing. */
export function RememberShownList({
  query,
  source,
  jobs,
  more,
  stages,
}: {
  query: string;
  source: ListSource;
  jobs: JobListing[];
  more: boolean;
  stages: Record<string, ApplicationStage>;
}) {
  const ids = jobs.map((job) => job.id).join();
  useEffect(() => {
    const kept = readKept();
    const mine = kept?.query === query ? kept : null;
    const first = new Set(jobs.map((job) => job.id));
    const loaded = (mine?.jobs ?? []).filter((job) => !first.has(job.id));
    rememberList({
      query,
      source,
      jobs: [...jobs, ...loaded],
      offset: mine?.offset ?? jobs.length,
      more: mine ? mine.more : more,
      stages,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when the list shown changes
  }, [ids, query, source, more]);
  return null;
}
