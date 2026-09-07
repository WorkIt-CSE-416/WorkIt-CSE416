import type { Metadata } from "next";

import { Avatar } from "@/components/avatar";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/cn";

import { AUDIT_LOG, type LogStatus } from "./data";

export const metadata: Metadata = {
  title: "System Audit Logs",
  description: "System-wide administrative and automated actions.",
};

/**
 * /company/audit-logs — the internal audit trail, business-side only.
 *
 * It sits under /company for the same reason every other company screen does:
 * the folder is inside company/layout.tsx, so the seeker (seeker) group can
 * never resolve it and the single /company auth check (see company/layout.tsx)
 * covers it for free.
 *
 * NOTHING HERE IS WIRED. Search, Export CSV and the pager are inert, matching
 * how the applications mockup ships its Filter and New Entry controls. Rows come
 * from ./data.
 *
 * The mockup frames this as a health view: STATUS is the column that matters,
 * so it is the only coloured text in the table — positive for a clean action,
 * red for a failure or a row that needs a human, muted for an automated
 * rollback. --color-destructive is still shadcn's stock red (see globals.css);
 * it stands in until WorkIt designs one.
 */
const STATUS_META: Record<LogStatus, { label: string; className: string }> = {
  success: { label: "Success", className: "text-positive" },
  failed: { label: "Failed", className: "text-destructive" },
  "rolled-back": { label: "Rolled Back", className: "text-ink-meta" },
  review: { label: "Needs Review", className: "text-destructive" },
};

/** Automated actions read neutral; anything an admin types reads brand. */
function actionTone(action: string): BadgeTone {
  return /ROLLBACK|BACKUP|FAILURE/.test(action) ? "neutral" : "brand";
}

const TH = "text-caption text-ink-subtle px-4 py-3 uppercase";
const TD = "px-4 py-3";

export default function CompanyAuditLogsPage() {
  return (
    <div className="max-w-app mx-auto w-full flex-1 px-6 py-6 sm:px-12">
      <header className="mb-5">
        <h1 className="text-heading text-ink">System Audit Logs</h1>
        <p className="text-body text-ink-meta mt-1">
          View and search system-wide administrative and automated actions.
        </p>
      </header>

      <Card padding="none" className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-end gap-3 p-3">
          <SearchField
            id="audit-log-search"
            label="Search logs"
            name="q"
            placeholder="Search logs…"
            className="min-w-0 flex-1 sm:max-w-xs"
          />
          <Button variant="secondary" size="sm">
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="size-4"
            >
              <path d="M8 2.5v7M5 6.5 8 9.5l3-3M3 12.5h10" />
            </svg>
            Export CSV
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-well border-border-subtle border-y">
                <th className={TH}>Timestamp</th>
                <th className={TH}>Actor</th>
                <th className={TH}>Action</th>
                <th className={TH}>Target</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {AUDIT_LOG.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-border-subtle hover:bg-accent border-b transition-colors last:border-0"
                >
                  <td className={cn(TD, "text-body text-ink-meta whitespace-nowrap")}>
                    {entry.timestamp}
                  </td>
                  <td className={TD}>
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <Avatar name={entry.actor} className="text-meta size-6" />
                      <span className="text-body text-ink">{entry.actor}</span>
                    </span>
                  </td>
                  <td className={TD}>
                    <Badge variant="tag" tone={actionTone(entry.action)}>
                      {entry.action}
                    </Badge>
                  </td>
                  <td className={cn(TD, "text-body text-ink")}>{entry.target}</td>
                  <td
                    className={cn(
                      TD,
                      "text-body font-medium whitespace-nowrap",
                      STATUS_META[entry.status].className,
                    )}
                  >
                    {STATUS_META[entry.status].label}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="text-note text-ink-meta flex items-center justify-between p-3">
          <p>Showing 1 to {AUDIT_LOG.length} of 1,248 entries</p>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" disabled>
              Previous
            </Button>
            <Button variant="ghost" size="sm">
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
