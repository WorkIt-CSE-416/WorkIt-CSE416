import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { buttonClasses } from "@/components/ui/button";
import { triageFillReport } from "@/lib/fill-report-actions";
import { getFillBrief, getFillReport } from "@/lib/fill-report-queries";
import { STATUSES } from "@/lib/fill-reports";

import { CopyBrief } from "./copy-brief";

export const metadata: Metadata = { title: "Fill Report" };

/**
 * One fix report (KAN-369), for an admin: its summary, the fields and the
 * timeline, the fix brief (copy it, or download it with the form's fixture
 * for a coding agent), and its triage: status and note. 404 for anyone the
 * API doesn't count as an admin. The fixture is a download, never rendered
 * here: it is an employer page's markup.
 */
export default async function FillReportPage({ params }: PageProps<"/admin/fill-reports/[id]">) {
  const { id } = await params;
  const [report, brief] = await Promise.all([getFillReport(id), getFillBrief(id)]);
  if (report.status === 401) redirect("/login");
  if (!report.data) notFound();
  const r = report.data;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <Link href="/admin/fill-reports" className="text-body text-brand underline">
        All Fill Reports
      </Link>
      <h1 className="text-title text-ink mt-2">
        Fill Report {r.id.slice(0, 8)}: {r.job_system}
      </h1>
      <p className="text-body text-ink-muted mt-1 break-all">
        {r.posting_url} · engine {r.engine_version} · {r.context?.browser ?? "browser unknown"} ·
        opened by {r.trigger ?? "unknown"} ·{" "}
        {new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC
      </p>
      {r.note && <p className="text-body text-ink mt-3">“{r.note}”</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {brief.data && <CopyBrief brief={brief.data} />}
        <a
          href={`/admin/fill-reports/${r.id}/brief`}
          className={buttonClasses({ variant: "secondary", size: "sm" })}
        >
          Download Fix Brief
        </a>
        {r.html && (
          <a
            href={`/admin/fill-reports/${r.id}/fixture`}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            Download Form Fixture
          </a>
        )}
      </div>

      <form action={triageFillReport} className="mt-6 flex flex-wrap items-end gap-3">
        <input type="hidden" name="id" value={r.id} />
        <label className="text-body text-ink flex flex-col gap-1">
          Status
          <select
            name="status"
            defaultValue={r.status}
            className="border-border-subtle rounded-control border px-2 py-1"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-body text-ink flex min-w-80 flex-1 flex-col gap-1">
          Admin Note
          <input
            name="admin_note"
            defaultValue={r.admin_note ?? ""}
            className="border-border-subtle rounded-control border px-2 py-1"
          />
        </label>
        <button type="submit" className={buttonClasses({ size: "sm" })}>
          Save
        </button>
      </form>

      <h2 className="text-ink mt-8 font-semibold">Fields ({r.fields.length})</h2>
      <div className="overflow-x-auto">
        <table className="text-body mt-2 w-full border-collapse text-left">
          <thead>
            <tr className="text-ink-muted border-border-subtle border-b">
              {[
                "Field",
                "Name",
                "Kind",
                "Selector",
                "Source",
                "Planned",
                "Status",
                "Read-Back",
                "Marked",
              ].map((h) => (
                <th key={h} className="py-2 pr-3">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.fields.map((f, n) => (
              <tr
                key={`${f.name ?? f.label_shape}-${n}`}
                className={`border-border-subtle text-ink border-b align-top ${f.marked ? "bg-danger-tint" : ""}`}
              >
                <td className="py-1 pr-3">{f.label ?? f.label_shape}</td>
                <td className="py-1 pr-3 font-mono">{f.name ?? ""}</td>
                <td className="py-1 pr-3">{f.kind}</td>
                <td className="py-1 pr-3 font-mono">{f.selector ?? ""}</td>
                <td className="py-1 pr-3">{f.source ?? ""}</td>
                <td className="py-1 pr-3">{f.planned ?? ""}</td>
                <td className="py-1 pr-3">{f.status ?? f.error ?? ""}</td>
                <td className="py-1 pr-3">{f.readback ?? ""}</td>
                <td className="py-1 pr-3">{f.marked ? "Wrong" : f.edited ? "Edited" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="text-ink mt-8 font-semibold">Fix Brief</h2>
      <pre className="bg-well rounded-card text-ink mt-2 max-h-[60vh] overflow-auto p-4 text-xs whitespace-pre-wrap">
        {brief.data ?? "The brief couldn't be loaded."}
      </pre>
    </main>
  );
}
