"use client";

import { differenceInCalendarDays, format } from "date-fns";

import { CompanyLogo } from "@/components/company-logo";
import { MailIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

import { EmailKindPill } from "../applications/email-kinds";
import type { Email } from "../applications/tracked";
import { useHydrated } from "../local-time";
import type { StageKey } from "../stage-colors";

/** The job an email is about, as the tracker holds it. */
export type EmailJob = {
  id: string;
  role: string;
  company: string;
  logoUrl: string | null;
  stage: StageKey;
};

/**
 * One email as an inbox lists it (KAN-413), the Inbox's rows and an
 * application's Emails tab alike: the sender's logo and name with the
 * received time on the right, the subject, one line of its text, and its
 * kind's pill. One that waits for the student (`status` proposed) has a dot
 * and a bold subject, as an unread email does in Gmail; WorkIt keeps no
 * read state, so the dot means "needs review", not "unread". A row that
 * matched no job says Not Linked; one matched to a job the list does not
 * hold (a queued one) does not. The caller wraps it in its link.
 */
export function EmailRowContent({
  email,
  job,
  selected = false,
}: {
  email: Email;
  job: EmailJob | undefined;
  selected?: boolean;
}) {
  const waiting = email.status === "proposed";
  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-3 transition-colors duration-150",
        selected ? "bg-brand-tint" : "hover:bg-hover",
      )}
    >
      <span className="relative mt-0.5 shrink-0">
        {job ? (
          <CompanyLogo
            name={job.company}
            src={job.logoUrl}
            className="text-meta size-9 rounded-full"
          />
        ) : (
          <span className="bg-surface flex size-9 items-center justify-center rounded-full">
            <MailIcon className="text-ink-meta size-4" />
          </span>
        )}
        {waiting && (
          <span
            aria-label="Needs review"
            className="bg-brand ring-panel absolute -top-0.5 -left-0.5 size-2.5 rounded-full ring-2"
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className={cn("text-label text-ink truncate", waiting && "font-semibold")}>
            {job ? job.company : "Unknown sender"}
          </p>
          <ReceivedShort at={email.receivedAt} />
        </div>
        <p
          className={cn(
            "text-meta text-ink truncate",
            waiting ? "font-semibold" : "text-ink-muted",
          )}
        >
          {email.title}
        </p>
        <p className="text-note text-ink-meta truncate">{preview(email.note)}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <EmailKindPill kind={email.emailKind} />
          {!email.jobId && <Badge tone="outline">Not Linked</Badge>}
        </div>
      </div>
    </div>
  );
}

/** The received time as an inbox list prints it: the time today, else the
 *  day. In the viewer's zone, so after hydration only. */
function ReceivedShort({ at }: { at: string }) {
  const hydrated = useHydrated();
  if (!hydrated) return null;
  const date = new Date(at);
  const today = differenceInCalendarDays(new Date(), date) === 0;
  return (
    <span className="text-note text-ink-meta shrink-0 tabular-nums">
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
