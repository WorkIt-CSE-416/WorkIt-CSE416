/**
 * Fix reports (KAN-369), the admin pages' pure half: the report's shapes as
 * the API answers them (backend app/schemas/fill_reports.py) and the list's
 * query. Reads are in ./fill-report-queries.ts (server-only), the triage in
 * ./fill-report-actions.ts.
 */

export const STATUSES = ["new", "triaged", "fixed"] as const;
export type ReportStatus = (typeof STATUSES)[number];
export const PAGE_SIZE = 50;

export type FillReportSummary = {
  id: string;
  created_at: string;
  job_system: string;
  posting_url: string;
  engine_version: string;
  status: ReportStatus;
  trigger: string | null;
  note: string | null;
  field_count: number;
  marked: string[];
};

export type FillReportField = {
  name?: string;
  label?: string;
  label_shape: string;
  kind: string;
  required?: boolean;
  selector?: string;
  visible?: boolean;
  source?: string;
  planned?: string;
  status?: string;
  reason?: string;
  readback?: string;
  error?: string;
  marked?: boolean;
  edited?: boolean;
};

export type TimelineStep = {
  t: number;
  kind: string;
  field?: string;
  status?: string;
  message?: string;
  stack?: string;
};

export type FillReport = FillReportSummary & {
  fields: FillReportField[];
  context: {
    extension_version?: string;
    browser?: string;
    captured_at?: string;
    frame?: string;
  } | null;
  timeline: TimelineStep[] | null;
  html: string | null;
  admin_note: string | null;
  updated_at: string | null;
};

type Param = string | string[] | undefined;
const first = (value: Param) => (Array.isArray(value) ? value[0] : value);

/** A status the API takes, or null. */
export function statusOf(value: Param): ReportStatus | null {
  const status = first(value);
  return STATUSES.find((s) => s === status) ?? null;
}

/** Whether `value` is a report's id: only a UUID goes into an API path. */
export function isReportId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** GET /admin/fill-reports's query from the page's search params: a known status, a job system's name, the page. */
export function reportsQuery(params: { status?: Param; job_system?: Param; page?: Param }): string {
  const query = new URLSearchParams();
  const system = first(params.job_system);
  if (system && /^[a-z_]{1,24}$/.test(system)) query.set("job_system", system);
  const status = statusOf(params.status);
  if (status) query.set("status", status);
  const page = Math.max(1, Number.parseInt(first(params.page) ?? "1", 10) || 1);
  query.set("limit", String(PAGE_SIZE));
  query.set("offset", String((page - 1) * PAGE_SIZE));
  return `?${query}`;
}
