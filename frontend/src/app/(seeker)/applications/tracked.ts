import "server-only";

import { getApplications, type Application as Stored } from "../auto-apply/applications";
import type { Application } from "../tracker";

/**
 * The seeker's saved and applied jobs, live (KAN-261): a job's Save button
 * and its Applied button (or auto apply's Submitted) write them, and the
 * API's application list reads them back (GET .../applications
 * ?stage=saved&stage=applied, backend/app/routers/auto_apply.py). Server-only,
 * as every read forwards the session's token. ./data.ts caches it per
 * request.
 *
 * A failed read is an error, never stand-in cards (backend/CLAUDE.md): the
 * page says they aren't loading.
 */
export async function getTracked(): Promise<
  { applications: Application[]; error: null } | { applications: null; error: string }
> {
  const { applications, error } = await getApplications(["saved", "applied"] as const);
  if (applications == null) return { applications: null, error };
  return { applications: applications.map(toApplication), error: null };
}

/** One stored application as a tracker card. */
function toApplication({ job, stage, added_at, applied_at, open }: Stored<"saved" | "applied">) {
  return {
    id: job.id,
    role: job.title,
    company: job.company,
    logoUrl: job.logo_url,
    // A closed posting's page is gone, so its card links nowhere.
    jobHref: open ? `/jobs/${encodeURIComponent(job.id)}` : undefined,
    stage,
    status: open ? undefined : "Posting Closed",
    match: job.match ?? null,
    savedOn: added_at,
    appliedOn: applied_at,
    events: [],
  } satisfies Application;
}
