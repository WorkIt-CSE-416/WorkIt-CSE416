"use client";

import { useEffect } from "react";

import type { ApplicationStage } from "../auto-apply/actions";
import type { ListSource } from "./list-pages";
import type { JobListing } from "./listings";
import { rememberList } from "./shown-list";

/** Hands the split view's first page to the rail, which draws the list there
 *  (./jobs-rail.tsx, KAN-519), as ./feed-list does for the large cards. An
 *  empty or failed list is written too, so the rail stops waiting. Draws
 *  nothing. */
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
    rememberList({ query, source, jobs, offset: jobs.length, more, stages });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when the list shown changes
  }, [ids, query, source, more]);
  return null;
}
