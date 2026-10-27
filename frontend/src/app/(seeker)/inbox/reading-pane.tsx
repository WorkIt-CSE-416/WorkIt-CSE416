"use client";

import { format, formatDistanceToNowStrict } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { CompanyLogo } from "@/components/company-logo";
import { ExternalLinkIcon, MailIcon } from "@/components/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

import { acceptUpdate, dismissUpdate } from "../applications/actions";
import { EmailKindPill } from "../applications/email-kinds";
import { CalendarPlusIcon, ReplyIcon } from "../applications/icons";
import { applicationHref } from "../applications/query";
import type { Email } from "../applications/tracked";
import { useHydrated, When } from "../local-time";
import { STAGE_LABEL, type StageKey } from "../stage-colors";
import { isAllDay } from "../tracker";
import type { EmailJob } from "./email-row";

/**
 * The Inbox's reading pane (KAN-413): one email, laid out as Gmail lays out
 * an open message. The subject, its kind's pill (with the date it names, for
 * an interview or a due date) and two icons: Open Application and Add to
 * Calendar. Then, only when the email waits for the student, one quiet card:
 * "Move Research Internship to Interviewing?" with Move and Not Now, or, for
 * an email that matched no job, Link to Job. Then the sender's line (logo,
 * name, "to me", the received time, Reply) and the email's text.
 *
 * Emails that change no stage were filed onto their job when they arrived
 * (backend `needs_review`), so most emails ask nothing. WorkIt keeps no
 * email bodies (docs/email_tracker.md): the text is what the tracker kept,
 * and Reply opens Gmail on a search for the subject until the message id is
 * kept (build step 3).
 */
export function ReadingPane({
  email,
  job,
  jobs,
}: {
  email: Email;
  job?: EmailJob;
  jobs: EmailJob[];
}) {
  const gmail = gmailSearch(email.title);
  const calendar = job && email.at ? calendarLink(email, job) : null;
  const dated = email.at && email.emailKind !== "confirmation" && email.emailKind !== "other";

  return (
    <article className="px-6 py-5">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-title text-ink font-semibold">{email.title}</h2>
          <div className="text-note text-ink-meta mt-1.5 flex flex-wrap items-center gap-2">
            <EmailKindPill kind={email.emailKind} />
            {dated && <When at={email.at} />}
            {email.status === "accepted" && job && <span>On your tracker</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {job && (
            <IconLink href={applicationHref(job.id)} label="Open Application">
              <ExternalLinkIcon className="size-[18px]" />
            </IconLink>
          )}
          {calendar && (
            <IconLink href={calendar} label="Add to Google Calendar" external>
              <CalendarPlusIcon className="size-[18px]" />
            </IconLink>
          )}
        </div>
      </header>

      {email.status === "proposed" && (
        // Remounted per email, so a job pick never carries over.
        <Decision key={email.id} email={email} job={job} jobs={jobs} />
      )}

      <div className="mt-6 flex items-start gap-3">
        {job ? (
          <CompanyLogo
            name={job.company}
            src={job.logoUrl}
            className="text-label size-10 shrink-0 rounded-full"
          />
        ) : (
          <span className="bg-surface flex size-10 shrink-0 items-center justify-center rounded-full">
            <MailIcon className="text-ink-meta size-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-label text-ink font-semibold">
            {job ? job.company : "Unknown sender"}
          </p>
          <p className="text-note text-ink-meta">to me</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Received at={email.receivedAt} />
          <IconLink href={gmail} label="Reply in Gmail" external>
            <ReplyIcon className="size-[18px]" />
          </IconLink>
        </div>
      </div>

      <div className="text-body text-ink mt-5 pl-[52px] whitespace-pre-line">
        {email.note ?? "No text was kept for this email."}
      </div>
    </article>
  );
}

/** The stage each kind moves an application to, and how far along each
 *  stage is, as the API's `advance` ranks them. */
const MOVES_TO: Partial<Record<Email["emailKind"], StageKey>> = {
  interview: "interviewing",
  offer: "offer",
  rejection: "rejected",
};
const RANK: Record<StageKey, number> = {
  saved: 0,
  applied: 1,
  interviewing: 2,
  offer: 3,
  rejected: 4,
};

/**
 * The one question a waiting email asks, in a quiet card: move the job's
 * stage, or link the email to a job. Not Now leaves it off the tracker
 * (dismissed) and the email stays in the Inbox as a record.
 */
function Decision({ email, job, jobs }: { email: Email; job?: EmailJob; jobs: EmailJob[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [pick, setPick] = useState("");

  function decide(run: () => Promise<{ error: string | null }>, failed: string) {
    start(async () => {
      const { error } = await run();
      if (error) {
        toast.show({ message: `${failed} ${error}` });
        return;
      }
      router.refresh();
    });
  }

  const box = cn(
    "border-border-subtle bg-surface rounded-card mt-4 flex flex-wrap items-center gap-3 border px-4 py-3",
    pending && "opacity-60",
  );
  const notNow = (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => decide(() => dismissUpdate(email.id), "Couldn't set it aside.")}
    >
      Not Now
    </Button>
  );

  if (!job) {
    return (
      <div className={box}>
        <p className="text-meta text-ink flex-1">Which job is this email about?</p>
        <SelectField
          id={`link-${email.id}`}
          label="Job"
          hideLabel
          placeholder="Pick a Job"
          value={pick}
          onValueChange={setPick}
          options={jobs.map((one) => ({ value: one.id, label: `${one.company} · ${one.role}` }))}
          className="w-64"
        />
        <Button
          size="sm"
          disabled={!pick || pending}
          onClick={() => decide(() => acceptUpdate(email.id, pick), "Couldn't link it.")}
        >
          Link to Job
        </Button>
        {notNow}
      </div>
    );
  }

  const move = MOVES_TO[email.emailKind];
  const question =
    move && RANK[move] > RANK[job.stage]
      ? { line: `Move ${job.role} to ${STAGE_LABEL[move]}?`, action: "Move" }
      : { line: `Add this to ${job.role}'s timeline?`, action: "Add" };
  return (
    <div className={box}>
      <p className="text-meta text-ink min-w-0 flex-1">{question.line}</p>
      <Button
        size="sm"
        disabled={pending}
        onClick={() => decide(() => acceptUpdate(email.id, null), "Couldn't apply it.")}
      >
        {question.action}
      </Button>
      {notNow}
    </div>
  );
}

/** Gmail's received line: "Tue, Oct 27, 9:42 AM (7 hours ago)", in the
 *  viewer's own zone, after hydration. */
function Received({ at }: { at: string }) {
  const hydrated = useHydrated();
  if (!hydrated) return null;
  const date = new Date(at);
  return (
    <p className="text-note text-ink-meta mr-1 whitespace-nowrap">
      {format(date, "EEE, MMM d, h:mm a")} ({formatDistanceToNowStrict(date, { addSuffix: true })})
    </p>
  );
}

/** An icon that goes somewhere, round, with its name on hover. */
function IconLink({
  href,
  label,
  external = false,
  children,
}: {
  href: string;
  label: string;
  external?: boolean;
  children: ReactNode;
}) {
  const className =
    "text-ink-meta hover:text-ink hover:bg-hover focus-visible:ring-brand-ring inline-flex size-9 items-center justify-center rounded-full transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          external ? (
            <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} />
          ) : (
            <Link href={href} aria-label={label} />
          )
        }
        className={className}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Gmail, searching for the email's subject: until Gmail is connected
 *  WorkIt has no message id, and the search finds the message in one
 *  click in whichever Gmail account is signed in. */
function gmailSearch(subject: string) {
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`subject:"${subject}"`)}`;
}

/** Google Calendar's own new-event page, filled in from the email: an hour
 *  at its time, or the whole day for a due date. Nothing of WorkIt's signs
 *  in; the student saves it in their own calendar. */
function calendarLink(email: Email, job: EmailJob) {
  const stamp = (date: Date) =>
    date
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  let dates: string;
  if (isAllDay(email.at)) {
    const day = email.at.replace(/-/g, "");
    const next = new Date(`${email.at}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    dates = `${day}/${next.toISOString().slice(0, 10).replace(/-/g, "")}`;
  } else {
    const start = new Date(email.at);
    dates = `${stamp(start)}/${stamp(new Date(start.getTime() + 60 * 60 * 1000))}`;
  }
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${email.title} · ${job.company}`,
    dates,
    details: `${job.role} at ${job.company}. Added from WorkIt.`,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** The empty pane: nothing picked yet. */
export function NoEmailPicked() {
  return (
    <div className="text-body text-ink-meta flex h-full min-h-64 items-center justify-center p-6">
      Pick an email to read it.
    </div>
  );
}
