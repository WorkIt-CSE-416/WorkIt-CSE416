import "server-only";

import { apiGet } from "@/lib/api";

/**
 * The one piece of news the seeker bar shows beside the account: how many
 * roles were posted in the last 24 hours, or nothing.
 *
 * It used to fall back to a resume nudge and then a greeting. Both moved to
 * where they belong once those places existed — the greeting is the
 * Dashboard's heading, and the nudge is the profile strength card at the
 * foot of the panel — so the bar only speaks up when there is news, and a
 * pill there always means something new.
 *
 * Deadlines ("Interview tomorrow at 2:00 PM") outrank roles here once the
 * application tracker has a backend; until then they are fixtures, and a bar
 * that invents a deadline is worse than one that says nothing. The Dashboard's
 * Up Next shows them from the fixture, labelled as such by where it lives.
 *
 * "Since yesterday" is a rolling 24 hours, not a calendar day: the server runs
 * in UTC and does not know the seeker's midnight (frontend/CLAUDE.md).
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Roles in the feed posted within the last 24 hours; 0 when the feed can't
 *  be read, so the bar stays quiet rather than reporting an outage there. The
 *  feed is newest first and capped at the API's 500; a day never fills that. */
export async function countNewRoles(): Promise<number> {
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
