import type { Metadata } from "next";

import { Avatar } from "@/components/avatar";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/cn";

import { DownloadIcon } from "../icons";
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
 * so it is the only colour in the table, and it is a status pill like every
 * other state in the app. Its tones are Badge's, by kind: positive for a clean
 * action, danger for a failure, warning for a row waiting on a human to
 * decide, inert for an automated rollback. A failure and a pending decision
 * used to share one red, which raised the same alarm for both. The Action
 * verb is plain code, so nothing else in a row competes with its status.
 *
 * Status is the second column, straight after the time, for the reason the
 * Applicants table puts Stage second: on a phone the scroller shows about two
 * columns, and whether an action failed is the one fact worth having without
 * scrolling for it.
 */
const STATUS_META: Record<LogStatus, { label: string; tone: BadgeTone }> = {
  success: { label: "Success", tone: "positive" },
  failed: { label: "Failed", tone: "danger" },
  "rolled-back": { label: "Rolled Back", tone: "inert" },
  review: { label: "Needs Review", tone: "warning" },
};

/** The company tables' heading style (their SortHeader): 12px ink-meta. */
const TH = "px-4 py-3 text-left text-note text-ink-meta font-medium";
const TD = "px-4 py-3";

export default function CompanyAuditLogsPage() {
  return (
    <div className="max-w-app mx-auto w-full flex-1 px-4 py-6 sm:px-8 lg:px-12">
      <header className="mb-5">
        <h1 className="text-heading text-ink">System Audit Logs</h1>
        <p className="text-body text-ink-meta mt-1">
          View and search system-wide administrative and automated actions.
        </p>
      </header>

      <Card padding="none" className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-3">
          <SearchField
            id="audit-log-search"
            label="Search logs"
            name="q"
            placeholder="Search logs…"
            className="min-w-0 flex-1 sm:max-w-xs"
          />
          <Button variant="secondary" size="sm">
            <DownloadIcon className="size-3.5" />
            Export CSV
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-border-subtle border-y">
                <th className={TH}>Timestamp</th>
                <th className={TH}>Status</th>
                <th className={TH}>Actor</th>
                <th className={TH}>Action</th>
                <th className={TH}>Target</th>
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
                  <td className={cn(TD, "whitespace-nowrap")}>
                    <Badge variant="status" tone={STATUS_META[entry.status].tone}>
                      {STATUS_META[entry.status].label}
                    </Badge>
                  </td>
                  <td className={TD}>
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <Avatar name={entry.actor} className="text-meta size-6" />
                      <span className="text-body text-ink">{entry.actor}</span>
                    </span>
                  </td>
                  <td className={TD}>
                    <code className="text-note text-ink-muted font-mono">{entry.action}</code>
                  </td>
                  {/* nowrap so a long target cannot wrap its row to two lines;
                      every row is one height, and the scroller takes the width. */}
                  <td className={cn(TD, "text-body text-ink whitespace-nowrap")}>{entry.target}</td>
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
