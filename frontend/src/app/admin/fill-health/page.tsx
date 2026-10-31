import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { daysOf, healthQuery, percent, versionOf } from "@/lib/fill-health";
import { getFillHealth } from "@/lib/fill-report-queries";

export const metadata: Metadata = { title: "Fill Health" };

/**
 * Fill numbers (KAN-476), the admins' page: per job system per day (UTC),
 * how many fills the extension ran, the share with no failed field, the
 * share of fields left needing the student, and the top error names,
 * filtered by engine version. A job system that breaks shows as its Clean
 * share dropping. Only WorkIt's admins (the API's WORKIT_ADMINS) see it;
 * anyone else gets the 404, as /admin/fill-reports.
 */
export default async function FillHealthPage({ searchParams }: PageProps<"/admin/fill-health">) {
  const params = await searchParams;
  const { data, status } = await getFillHealth(healthQuery(params));
  if (status === 401) redirect("/login");
  if (!data) notFound();
  const days = daysOf(params.days);
  const version = versionOf(params.engine_version) ?? "";

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="text-title text-ink">Fill Health</h1>
      <p className="text-body text-ink-muted mt-1">
        How the extension&apos;s fills went, per job system per day (UTC). Counts only, never
        answers.
      </p>
      <form className="mt-4 flex flex-wrap items-end gap-3" action="/admin/fill-health">
        <label className="text-body text-ink flex flex-col gap-1">
          Days
          <select
            name="days"
            defaultValue={String(days)}
            className="border-border-subtle rounded-control border px-2 py-1"
          >
            {[1, 7, 14, 30, 90].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="text-body text-ink flex flex-col gap-1">
          Engine Version
          <select
            name="engine_version"
            defaultValue={version}
            className="border-border-subtle rounded-control border px-2 py-1"
          >
            <option value="">All</option>
            {data.engine_versions.map((v) => (
              <option key={v} value={v}>
                {v}
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
      {data.rows.length === 0 ? (
        <p className="text-body text-ink-muted mt-4">No fills in this period.</p>
      ) : (
        <table className="text-body mt-4 w-full border-collapse text-left">
          <thead>
            <tr className="text-ink-muted border-border-subtle border-b">
              <th className="py-2 pr-3">Day</th>
              <th className="py-2 pr-3">Job System</th>
              <th className="py-2 pr-3 text-right">Fills</th>
              <th className="py-2 pr-3 text-right">No Failed Field</th>
              <th className="py-2 pr-3 text-right">Needs You Rate</th>
              <th className="py-2 pr-3">Top Errors</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr
                key={`${r.day}:${r.job_system}`}
                className="border-border-subtle text-ink border-b align-top"
              >
                <td className="py-2 pr-3 whitespace-nowrap">{r.day}</td>
                <td className="py-2 pr-3">{r.job_system}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.fills}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{percent(r.clean_share)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{percent(r.needs_you_rate)}</td>
                <td className="py-2 pr-3">
                  {r.top_errors.map((e) => `${e.name} ${e.count}`).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
