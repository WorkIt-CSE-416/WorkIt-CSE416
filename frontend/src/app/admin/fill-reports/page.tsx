import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { listFillReports } from "@/lib/fill-report-queries";
import { PAGE_SIZE, reportsQuery, STATUSES, statusOf } from "@/lib/fill-reports";

export const metadata: Metadata = { title: "Fill Reports" };

/**
 * Fix reports (KAN-369), the admins' list: the reports students sent from
 * the extension's panel, newest first, filtered by job system and status.
 * Only WorkIt's admins (the API's WORKIT_ADMINS) see it; anyone else gets
 * the 404, so the page doesn't say it exists. Outside both shells: it is the
 * team's tool, not a student's screen.
 */
export default async function FillReportsPage({ searchParams }: PageProps<"/admin/fill-reports">) {
  const params = await searchParams;
  const { data, status } = await listFillReports(reportsQuery(params));
  if (status === 401) redirect("/login");
  if (!data) notFound();
  const system = typeof params.job_system === "string" ? params.job_system : "";
  const chosen = statusOf(params.status);
  const page = Math.max(1, Number.parseInt(String(params.page ?? "1"), 10) || 1);
  const link = (changes: Record<string, string | null>) => {
    const query = new URLSearchParams();
    const next = { job_system: system || null, status: chosen, page: null, ...changes };
    for (const [key, value] of Object.entries(next)) if (value) query.set(key, value);
    return `/admin/fill-reports${query.size ? `?${query}` : ""}`;
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="text-title text-ink">Fill Reports</h1>
      <p className="text-body text-ink-muted mt-1">
        Problems students reported from the extension, newest first. Open one for its fix brief.
      </p>
      <form className="mt-4 flex flex-wrap items-end gap-3" action="/admin/fill-reports">
        <label className="text-body text-ink flex flex-col gap-1">
          Job System
          <input
            name="job_system"
            defaultValue={system}
            placeholder="greenhouse"
            className="border-border-subtle rounded-control border px-2 py-1"
          />
        </label>
        <label className="text-body text-ink flex flex-col gap-1">
          Status
          <select
            name="status"
            defaultValue={chosen ?? ""}
            className="border-border-subtle rounded-control border px-2 py-1"
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="bg-brand text-on-brand rounded-control text-body px-3 py-1.5"
        >
          Filter
        </button>
      </form>
      <p className="text-body text-ink-muted mt-4">{data.total} reports</p>
      <table className="text-body mt-2 w-full border-collapse text-left">
        <thead>
          <tr className="text-ink-muted border-border-subtle border-b">
            <th className="py-2 pr-3">Sent</th>
            <th className="py-2 pr-3">Job System</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Opened By</th>
            <th className="py-2 pr-3">Marked Wrong</th>
            <th className="py-2 pr-3">Note</th>
          </tr>
        </thead>
        <tbody>
          {data.reports.map((r) => (
            <tr key={r.id} className="border-border-subtle text-ink border-b align-top">
              <td className="py-2 pr-3 whitespace-nowrap">
                <Link href={`/admin/fill-reports/${r.id}`} className="text-brand underline">
                  {new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")}
                </Link>
              </td>
              <td className="py-2 pr-3">
                <Link href={link({ job_system: r.job_system })} className="underline">
                  {r.job_system}
                </Link>
              </td>
              <td className="py-2 pr-3">{r.status}</td>
              <td className="py-2 pr-3">{r.trigger ?? ""}</td>
              <td className="py-2 pr-3">{r.marked.join(", ")}</td>
              <td className="max-w-md py-2 pr-3 break-words">{r.note ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <nav className="text-body mt-4 flex gap-4">
        {page > 1 && <Link href={link({ page: String(page - 1) })}>Newer</Link>}
        {page * PAGE_SIZE < data.total && (
          <Link href={link({ page: String(page + 1) })}>Older</Link>
        )}
      </nav>
    </main>
  );
}
