import "server-only";

import { connection } from "next/server";

import { apiGet } from "@/lib/api";
import { extractErrorMessage } from "@/lib/auth";

import type { ExperienceLevel, WorkStyle } from "./data";

/**
 * The live feed: scraped roles from the API's `GET /jobs`, which serves the
 * scraper's feed.json (backend/app/routers/jobs.py). Mirrors
 * backend/app/schemas/jobs.py field for field. Read by /jobs, by /search (which
 * narrows it to the query) and by the Dashboard's New Matches.
 *
 * NOT IN ./data.ts, THOUGH THAT IS THE USUAL SEAM. `filters.tsx` is a client
 * component importing its option lists from ./data, and `apiGet` is
 * server-only — putting the fetch there would pull it into the client bundle
 * and fail the build. ./data keeps the fixtures, which still back the
 * expanded view at /jobs/[jobId] and the filter options.
 *
 * Its own type, not an optional-everything `Recommendation`: a scraped role has
 * no salary, description, job type or match score, and making those optional
 * on the fixture type would push null checks into every screen that reads it.
 */
export type JobListing = {
  id: string;
  title: string;
  company: string;
  apply_url: string;
  /** Exactly the API's `Literal["internship", "new_grad"]` — the scraper keeps
   *  intern and new-grad roles only. */
  experience_level: Exclude<ExperienceLevel, "experienced">;
  work_style: WorkStyle | null;
  location: string | null;
  posted_at: string | null;
  logo_url: string | null;
};

/** Public, so no token. An error is a message to print, never fixture jobs in
 *  its place — made-up postings shown silently would read as real ones. */
export async function getJobListings(): Promise<
  { jobs: JobListing[]; error: null } | { jobs: null; error: string }
> {
  // Request time, not build time: without this `next build` prerenders the
  // feed once — with no API running in CI, that bakes the error in for good.
  await connection();
  try {
    const res = await apiGet("/jobs");
    if (!res.ok) return { jobs: null, error: await extractErrorMessage(res) };
    return { jobs: (await res.json()) as JobListing[], error: null };
  } catch {
    return { jobs: null, error: "Could not reach the server." };
  }
}
