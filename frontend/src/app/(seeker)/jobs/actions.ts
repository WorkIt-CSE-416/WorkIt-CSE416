"use server";

import { apiGet } from "@/lib/api";

import { feedQuery, readFilters, readQuery } from "./filter-query";
import { getFeedPage, type FeedPage } from "./listings";

/** A query string as the record a page's searchParams would be. */
function paramsOf(query: string): Record<string, string[]> {
  const params: Record<string, string[]> = {};
  for (const [key, value] of new URLSearchParams(query)) (params[key] ??= []).push(value);
  return params;
}

/**
 * How many jobs these filters keep: the All Filters panel's "Show 128 Jobs",
 * counted as the picks change, before anything is applied. Takes the query
 * string the panel would write (./filter-query), with /search's `q` when it
 * is open there, and reads it back the same way a page does, so a value the
 * API would refuse never reaches it. A public endpoint like every server
 * action, over public data. Null when the API can't answer: the button then
 * just says "Show Jobs".
 */
export async function countJobs(query: string): Promise<number | null> {
  const params = paramsOf(query);
  try {
    const res = await apiGet(`/jobs/count${feedQuery(readFilters(params), readQuery(params))}`);
    if (!res.ok) return null;
    return ((await res.json()) as { jobs: number }).jobs;
  } catch {
    return null;
  }
}

/** The furthest Load More goes, the API's own cap on `offset`. */
const MAX_OFFSET = 100_000;

/**
 * The page of the feed after the `offset` roles a list already shows, for its
 * Load More (./feed-list). `query` is the one the page was drawn with
 * (feedQuery: its filters and /search's words), read back the same way, so a
 * hand-made call can only ask for what a page could.
 */
export async function loadMoreJobs(query: string, offset: number): Promise<FeedPage> {
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
    return { jobs: null, more: false, error: "That page of jobs doesn't exist." };
  }
  const params = paramsOf(query);
  return getFeedPage(feedQuery(readFilters(params), readQuery(params)), offset);
}
