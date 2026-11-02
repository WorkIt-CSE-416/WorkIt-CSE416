import "server-only";

import { apiGet } from "@/lib/api";
import type { FillHealth } from "@/lib/fill-health";
import {
  isReportId,
  type FillReport,
  type FillReportGroup,
  type FillReportSummary,
} from "@/lib/fill-reports";
import { getAccessToken } from "@/lib/session";

/**
 * Fix reports' reads for the admin pages (KAN-369): the API decides who is an
 * admin (WORKIT_ADMINS) and answers 403 to anyone else, which the pages show
 * as not found. Server-only: each forwards the session's token.
 */

export type Read<T> = { data: T; status: 200 } | { data: null; status: number };

async function read<T>(path: string, as: "json" | "text" = "json"): Promise<Read<T>> {
  const token = await getAccessToken();
  if (!token) return { data: null, status: 401 };
  const response = await apiGet(path, token);
  if (!response.ok) return { data: null, status: response.status };
  return {
    data: (as === "json" ? await response.json() : await response.text()) as T,
    status: 200,
  };
}

/** GET /admin/fill-reports with the query `reportsQuery` built. */
export function listFillReports(
  query: string,
): Promise<Read<{ reports: FillReportSummary[]; total: number }>> {
  return read(`/admin/fill-reports${query}`);
}

/** GET /admin/fill-report-groups with the query `groupsQuery` built (KAN-478). */
export function listFillReportGroups(query: string): Promise<Read<{ groups: FillReportGroup[] }>> {
  return read(`/admin/fill-report-groups${query}`);
}

export function getFillReport(id: string): Promise<Read<FillReport>> {
  return isReportId(id)
    ? read(`/admin/fill-reports/${id}`)
    : Promise.resolve({ data: null, status: 404 });
}

/** The fix brief, Markdown (GET /admin/fill-reports/{id}/brief). */
export function getFillBrief(id: string): Promise<Read<string>> {
  return isReportId(id)
    ? read(`/admin/fill-reports/${id}/brief`, "text")
    : Promise.resolve({ data: null, status: 404 });
}

/** The form's HTML, values out (GET /admin/fill-reports/{id}/fixture). */
export function getFillFixture(id: string): Promise<Read<string>> {
  return isReportId(id)
    ? read(`/admin/fill-reports/${id}/fixture`, "text")
    : Promise.resolve({ data: null, status: 404 });
}

/** Fill numbers per job system per day (KAN-476): GET /admin/fill-health with the query `healthQuery` built. */
export function getFillHealth(query: string): Promise<Read<FillHealth>> {
  return read(`/admin/fill-health${query}`);
}
