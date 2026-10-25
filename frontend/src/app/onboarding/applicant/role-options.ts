import "server-only";

import { seasonLabel } from "@/app/(seeker)/jobs/filter-query";
import { getJobFacets, getJobLocations } from "@/app/(seeker)/jobs/listings";
import type { PickOption } from "@/components/filter-controls";

/** The month each season starts, 0 for January. */
const SEASON_START: Record<string, number> = { winter: 0, spring: 2, summer: 5, fall: 8 };

/** Start Date offers only seasons still ahead (KAN-275): a bare year ("2027",
 *  postings that name no season) says nothing a student can plan by, and a
 *  season already under way (Fall 2026 in October) is too late to start. All
 *  Filters still offers both. A month is coarse enough that the server's UTC
 *  clock does not matter. */
function upcoming({ value }: { value: string }) {
  const [season, year] = value.split("-");
  return year != null && new Date(Number(year), SEASON_START[season]) > new Date();
}

/**
 * The Role step's picker options (./role-step), for onboarding and
 * Settings' Job Preferences alike: what the Jobs page's filters offer, from
 * the same cached API calls. Either list comes back empty when the API is
 * down, and its picker then says nothing matches.
 */
export async function getRoleOptions(): Promise<{
  roles: PickOption[];
  places: PickOption[];
  seasons: PickOption[];
}> {
  const [facets, locations] = await Promise.all([getJobFacets(), getJobLocations()]);
  return {
    roles: facets.role.map((r) => ({ value: r.value, label: r.label, count: r.jobs })),
    places: locations.map((p) => ({
      value: p.code,
      label: p.label,
      count: p.jobs,
      nested: p.code.includes("-"),
    })),
    seasons: facets.start_term.filter(upcoming).map((t) => ({
      value: t.value,
      label: seasonLabel(t.value),
      count: t.jobs,
    })),
  };
}
