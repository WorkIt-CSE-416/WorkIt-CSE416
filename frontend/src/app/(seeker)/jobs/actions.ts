"use server";

import { apiGet } from "@/lib/api";

import { filtersQuery, readFilters } from "./filter-query";

/**
 * How many jobs these filters keep: the All Filters panel's "Show 128 Jobs",
 * counted as the picks change, before anything is applied. Takes the query
 * string the panel would write (./filter-query) and reads it back the same
 * way a page does, so a value the API would refuse never reaches it. A public
 * endpoint like every server action, over public data. Null when the API
 * can't answer: the button then just says "Show Jobs".
 */
export async function countJobs(query: string): Promise<number | null> {
  const params: Record<string, string[]> = {};
  for (const [key, value] of new URLSearchParams(query)) (params[key] ??= []).push(value);
  try {
    const res = await apiGet(`/jobs/count${filtersQuery(readFilters(params))}`);
    if (!res.ok) return null;
    return ((await res.json()) as { jobs: number }).jobs;
  } catch {
    return null;
  }
}
