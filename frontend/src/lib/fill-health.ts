/**
 * Fill numbers (KAN-476), the /admin/fill-health page's pure half: the
 * shapes GET /admin/fill-health answers (backend app/schemas/fill_events.py)
 * and the page's query. The read is in ./fill-report-queries.ts.
 */

export const DEFAULT_DAYS = 14;

export type FillHealthRow = {
  day: string;
  job_system: string;
  /** Fills, a Workday walk once (its final step's event). */
  fills: number;
  /** The share of pages (a Workday step is one) with no failed field: a job system that breaks shows as this dropping. */
  clean_share: number;
  /** Fields left needing the student over all fields, less those skipped by the student's choice. */
  needs_you_rate: number;
  top_errors: { name: string; count: number }[];
};

export type FillHealth = { rows: FillHealthRow[]; engine_versions: string[] };

type Param = string | string[] | undefined;
const first = (value: Param) => (Array.isArray(value) ? value[0] : value);

/** The days a filter asks for, 1 to 90, else DEFAULT_DAYS. */
export function daysOf(value: Param): number {
  const days = Number.parseInt(first(value) ?? "", 10);
  return days >= 1 && days <= 90 ? days : DEFAULT_DAYS;
}

/** A plain engine version (letters, digits and . _ + -), or null. */
export function versionOf(value: Param): string | null {
  const version = first(value);
  return version && /^[A-Za-z0-9._+-]{1,64}$/.test(version) ? version : null;
}

/** GET /admin/fill-health's query from the page's search params. */
export function healthQuery(params: { days?: Param; engine_version?: Param }): string {
  const query = new URLSearchParams({ days: String(daysOf(params.days)) });
  const version = versionOf(params.engine_version);
  if (version) query.set("engine_version", version);
  return `?${query}`;
}

/** A share as a whole percent: "67%". */
export function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}
