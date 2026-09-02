/**
 * Fixture for /company/audit-logs.
 *
 * Static sample rows only — nothing is read from a real log pipe yet, so the
 * toolbar's search, the Export CSV button and the pager on the page are inert,
 * the same way the applications mockup ships its Filter and New Entry controls.
 * Swap this array for the real feed and the page is unchanged.
 */
export type LogStatus = "success" | "failed" | "rolled-back" | "review";

export type AuditLogEntry = {
  id: string;
  /** Already formatted for display — "YYYY-MM-DD HH:MM:SS". */
  timestamp: string;
  /** Admin username or automated agent that performed the action. */
  actor: string;
  /** Machine-style verb, rendered as a pill. */
  action: string;
  /** What the action was performed on. */
  target: string;
  status: LogStatus;
};

export const AUDIT_LOG: readonly AuditLogEntry[] = [
  {
    id: "1",
    timestamp: "2023-10-24 14:32:01",
    actor: "admin_sarah",
    action: "UPDATE_CONFIG",
    target: "AI_Summaries_Flag",
    status: "success",
  },
  {
    id: "2",
    timestamp: "2023-10-24 11:15:42",
    actor: "system_auto",
    action: "MODEL_ROLLBACK",
    target: "ResumeParser v3.2.1",
    status: "rolled-back",
  },
  {
    id: "3",
    timestamp: "2023-10-23 09:00:12",
    actor: "john_doe_ops",
    action: "AUTH_FAILURE",
    target: "Admin_Console",
    status: "failed",
  },
  {
    id: "4",
    timestamp: "2023-10-23 08:58:33",
    actor: "john_doe_ops",
    action: "AUTH_FAILURE",
    target: "Admin_Console",
    status: "failed",
  },
  {
    id: "5",
    timestamp: "2023-10-22 17:20:05",
    actor: "admin_priya",
    action: "GRANT_ROLE",
    target: "billing_admin → maria_lin",
    status: "success",
  },
  {
    id: "6",
    timestamp: "2023-10-22 03:11:59",
    actor: "system_auto",
    action: "BACKUP_RUN",
    target: "nightly-snapshot",
    status: "review",
  },
  {
    id: "7",
    timestamp: "2023-10-21 12:44:30",
    actor: "admin_sarah",
    action: "DELETE_POSTING",
    target: "job#8842",
    status: "success",
  },
];
