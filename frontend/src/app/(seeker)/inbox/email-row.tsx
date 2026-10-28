"use client";

import { LinkBreakIcon } from "@phosphor-icons/react/ssr";
import { differenceInCalendarDays, format } from "date-fns";

import { CompanyLogo } from "@/components/company-logo";
import { MailIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

import { EmailKindPill } from "../applications/email-kinds";
import type { Email } from "../applications/tracked";
import { useHydrated } from "../local-time";
import type { StageKey } from "../stage-colors";

/** The job an email is about, as the tracker holds it. `appliedOn` is for
 *  the Choose Application modal's Applied column (./pick-application.tsx). */
export type EmailJob = {
  id: string;
  role: string;
  company: string;
  logoUrl: string | null;
  stage: StageKey;
  appliedOn: string | null;
};

/**
 * One email as an inbox lists it (KAN-413), the Inbox's rows and an
 * application's Emails tab alike: the sender's logo and name with the
 * received time on the right, the subject, one line of its text, and its
 * kind's pill. Read and unread are drawn as Gmail draws them (KAN-427:
 * `read`, the email's `readAt` or the Inbox's own pending mark), by the
 * row's fill and weight (`rowFill`): unread is white with the sender,
 * subject and date in bold; read is grey (--color-app) in regular weight
 * with a quieter subject. It was a brand dot on the sender's logo, which
 * read as a status on the company rather than on the email. One that waits
 * for the student (`status` proposed) has no mark of its own: a Needs
 * Review badge did, as noise beside the kind's pill, and the status banner
 * says so once it is opened. A row that matched no job shows an empty
 * dashed logo (`SenderAvatar`). The caller wraps it in
 * its link; `bare` leaves the fills to the caller, which the Inbox's row
 * draws behind its checkbox too.
 */
export function EmailRowContent({
  email,
  job,
  selected = false,
  read = email.readAt != null,
  bare = false,
}: {
  email: Email;
  job: EmailJob | undefined;
  selected?: boolean;
  read?: boolean;
  bare?: boolean;
}) {
  const unread = !read;
  return (
    <div className={cn("flex gap-3 px-4 py-3", !bare && rowFill({ read, open: selected }))}>
      <span className="mt-0.5 shrink-0">
        <SenderAvatar email={email} job={job} size="row" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className={cn("text-label text-ink truncate", unread && "font-semibold")}>
            {unread && <span className="sr-only">Unread, </span>}
            {job ? job.company : "Unknown sender"}
          </p>
          <ReceivedShort at={email.receivedAt} bold={unread} />
        </div>
        <p
          className={cn("text-meta text-ink truncate", unread ? "font-semibold" : "text-ink-muted")}
        >
          {email.title}
        </p>
        <p className="text-note text-ink-meta truncate">{preview(email.note)}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <EmailKindPill kind={email.emailKind} />
        </div>
      </div>
    </div>
  );
}

/**
 * Who an email is from, in the logo's spot: the company's logo, or for an
 * email that matched no application (`jobId` null) an empty dashed circle
 * with a broken link (KAN-427), the logo that is not there. It replaced a
 * Not Linked badge, a second pill on the row; this keeps the row as tidy as
 * a linked one. One matched to a job the Inbox does not list (a queued one)
 * is linked, so it keeps the plain envelope. The row and the reading
 * pane's sender line draw it alike.
 */
export function SenderAvatar({
  email,
  job,
  size,
}: {
  email: Email;
  job: EmailJob | undefined;
  size: "row" | "pane";
}) {
  const box = size === "row" ? "size-9" : "size-10";
  const glyph = size === "row" ? "size-4" : "size-5";
  if (job) {
    return (
      <CompanyLogo
        name={job.company}
        src={job.logoUrl}
        className={cn(box, "shrink-0 rounded-full", size === "row" ? "text-meta" : "text-label")}
      />
    );
  }
  if (!email.jobId) {
    return (
      <span
        role="img"
        aria-label="Not linked to an application"
        title="Not linked to an application"
        className={cn(
          box,
          "border-ink-faint flex shrink-0 items-center justify-center rounded-full border border-dashed",
        )}
      >
        <LinkBreakIcon aria-hidden className={cn(glyph, "text-ink-meta")} />
      </span>
    );
  }
  return (
    <span className={cn(box, "bg-surface flex shrink-0 items-center justify-center rounded-full")}>
      <MailIcon className={cn(glyph, "text-ink-meta")} />
    </span>
  );
}

/**
 * A row's fill, Gmail's: unread white, read grey, and lavender for the
 * email that is open or picked, with a brand bar at the open one's left
 * edge. The pointer raises a row with --shadow-row rather than a fill. One
 * function for the Inbox's rows and an application's Emails tab, so the two
 * lists never draw read differently.
 */
export function rowFill({
  read,
  open = false,
  picked = false,
}: {
  read: boolean;
  open?: boolean;
  picked?: boolean;
}) {
  return cn(
    "relative transition-[background-color,box-shadow] duration-150 hover:z-[1] hover:shadow-row",
    open || picked ? "bg-brand-tint" : read ? "bg-app" : "bg-panel",
    open && "before:bg-brand before:absolute before:inset-y-0 before:left-0 before:w-[3px]",
  );
}

/** The received time as an inbox list prints it: the time today, else the
 *  day. In the viewer's zone, so after hydration only. */
function ReceivedShort({ at, bold }: { at: string; bold: boolean }) {
  const hydrated = useHydrated();
  if (!hydrated) return null;
  const date = new Date(at);
  const today = differenceInCalendarDays(new Date(), date) === 0;
  return (
    <span
      className={cn(
        "text-note shrink-0 tabular-nums",
        bold ? "text-ink font-semibold" : "text-ink-meta",
      )}
    >
      {format(date, today ? "h:mm a" : "MMM d")}
    </span>
  );
}

/** An email's first line that says something: past a greeting ("Hi
 *  Andrew,"), as Gmail's preview reads. */
export function preview(text: string | null | undefined) {
  if (!text) return "";
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(hi|hello|dear|hey)\b.*,$/i.test(line));
  return lines[0] ?? "";
}
