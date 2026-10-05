import "server-only";

import { apiGet } from "@/lib/api";
import { listResumes } from "@/lib/resume-actions";

/**
 * The one line of news the seeker bar shows beside the account, chosen on the
 * server from what the API can answer today. Only the most useful thing
 * applies, in this order:
 *
 *   news      roles posted in the last 24 hours, from the scraped feed
 *   nudge     no resume uploaded yet, so nothing can be matched
 *   greeting  nothing to act on; the bar just says hello
 *
 * Deadlines ("Interview tomorrow at 2:00 PM") and progress ("5 applications
 * this week") belong above all three, but the application tracker is still
 * fixtures (applications/data.ts), and a status line that invents a deadline
 * is worse than none. Add them here first when it has a backend.
 *
 * "Since yesterday" is a rolling 24 hours, not a calendar day: the server
 * runs in UTC and does not know the seeker's midnight (frontend/CLAUDE.md).
 * The greeting's time of day is chosen in the browser for the same reason.
 */
export type SeekerStatus =
  { kind: "news"; count: number } | { kind: "nudge" } | { kind: "greeting" };

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getSeekerStatus(): Promise<SeekerStatus> {
  const [newRoles, resumes] = await Promise.all([countNewRoles(), listResumes()]);

  if (newRoles > 0) return { kind: "news", count: newRoles };
  // An error is not "no resumes": a failed load says nothing about them.
  if (resumes.error == null && resumes.resumes.length === 0) return { kind: "nudge" };
  return { kind: "greeting" };
}

/** Roles in the feed posted within the last 24 hours. The feed is newest
 *  first and capped at the API's 500; a day never fills that. A failed fetch
 *  counts as none, so the line falls through to the next message. */
async function countNewRoles(): Promise<number> {
  try {
    const res = await apiGet("/jobs?limit=500");
    if (!res.ok) return 0;
    const jobs: { posted_at: string | null }[] = await res.json();
    const since = Date.now() - DAY_MS;
    return jobs.filter((job) => job.posted_at && Date.parse(job.posted_at) >= since).length;
  } catch {
    return 0;
  }
}
