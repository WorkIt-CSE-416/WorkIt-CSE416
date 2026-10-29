"use client";

import { ListChecksIcon } from "@phosphor-icons/react/ssr";
import { format, formatDistanceToNowStrict } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { CompanyLogo } from "@/components/company-logo";
import { ArrowRightIcon } from "@/components/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink, buttonClasses } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

import { acceptUpdate, dismissUpdate } from "../applications/actions";
import { EmailKindPill } from "../applications/email-kinds";
import { CalendarPlusIcon, ReplyIcon } from "../applications/icons";
import { applicationHref } from "../applications/query";
import type { Email } from "../applications/tracked";
import { useHydrated, When } from "../local-time";
import { STAGE_COLOR, STAGE_LABEL, type StageKey } from "../stage-colors";
import { isAllDay } from "../tracker";
import { SenderAvatar, type EmailJob } from "./email-row";
import { PickApplication } from "../applications/pick-application";

/**
 * The Inbox's reading pane (KAN-413): one email, laid out as Gmail lays out
 * an open message. The subject and its kind's pill, with View Application
 * and Add to Calendar as worded buttons at the right, each with its glyph.
 * Then, only when the email waits for the
 * student, the status banner (`Decision`): the application, its stage now
 * and the stage the email moves it to, with Confirm and Cancel. Then the
 * sender's line (logo, name, "to me", the received time, Reply) and the
 * email's text.
 *
 * NO DATE BESIDE THE PILL (KAN-427): it repeated the received time on most
 * emails, a rejection's or an update's. The one date worth a line, an
 * interview's or a due date, is in the banner and on Add to Calendar.
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

  return (
    <article className="px-6 py-5">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-title text-ink font-semibold">{email.title}</h2>
          <div className="text-note text-ink-meta mt-1.5 flex flex-wrap items-center gap-2">
            <EmailKindPill kind={email.emailKind} />
            {email.status === "accepted" && job && <span>On your tracker</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Both worded, not icons (KAN-427): an arrow out of a box said
              "opens another site" for a page in WorkIt, and a bare calendar
              glyph left Add to Calendar to a hover. Each keeps a glyph
              before its word, the pair drawn alike: View Application the
              Applications Tracker's own ListChecks (../seeker-sidebar.tsx). */}
          {job && (
            <ButtonLink href={applicationHref(job.id)} variant="secondary" size="sm">
              <ListChecksIcon aria-hidden className="size-4" />
              View Application
            </ButtonLink>
          )}
          {calendar && (
            <a
              href={calendar}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              <CalendarPlusIcon aria-hidden className="size-4" />
              Add to Calendar
            </a>
          )}
        </div>
      </header>

      {email.status === "proposed" && (
        // Remounted per email, so a job pick never carries over.
        <Decision key={email.id} email={email} job={job} jobs={jobs} />
      )}

      <div className="mt-6 flex items-start gap-3">
        <SenderAvatar email={email} job={job} size="pane" />
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
 * The status banner (KAN-427): what accepting a waiting email does to its
 * application, shown before it is done. Its head names the change; its body
 * is the application (logo, role, company) and a before and after, the
 * stage now and the stage it moves to, each in its stage's pill
 * (../stage-colors.ts), or "Stage stays" when the email moves nothing (a
 * later stage, an assessment), with the date it adds to the timeline for an
 * interview or a due date. Confirm accepts it; Cancel sets it aside
 * (dismissed), and the email stays in the Inbox as a record. It replaced a
 * one-line question ("Move Intern to Rejected?"), which said neither where
 * the application stood nor which company it was.
 *
 * An email that matched no job asks for one first, with Choose Application:
 * a view of the Applications Tracker in a modal (../applications/pick-application.tsx),
 * not a dropdown, so each application shows where it stands. Once one is
 * picked the banner shows it, with Change, and its before and after. One the tracker matched to a job the Inbox
 * does not list (a queued one: the Inbox lists the tracker's jobs) keeps its
 * match and asks only to add it: a picker there would not hold the job, and
 * a pick would move another one.
 */
function Decision({ email, job, jobs }: { email: Email; job?: EmailJob; jobs: EmailJob[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [pick, setPick] = useState("");
  const [choosing, setChoosing] = useState(false);

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

  const unlisted = !job && email.jobId != null;
  const target = job ?? jobs.find((one) => one.id === pick);
  const move = MOVES_TO[email.emailKind];
  const after = target && move && RANK[move] > RANK[target.stage] ? move : undefined;
  const dated = email.at && (email.emailKind === "interview" || email.emailKind === "assessment");
  const heading = unlisted
    ? "Add This Email to Your Tracker"
    : !job
      ? "Link This Email to an Application"
      : after
        ? "Update Application Status"
        : "Add to Application Timeline";

  return (
    <section
      aria-label={heading}
      className={cn(
        "border-border-subtle bg-panel rounded-card shadow-panel mt-4 overflow-hidden border",
        pending && "opacity-60",
      )}
    >
      <h3 className="text-label text-ink bg-surface border-border-subtle border-b px-4 py-2.5 font-semibold">
        {heading}
      </h3>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4">
        {target ? (
          <div className="flex min-w-0 items-center gap-3">
            <CompanyLogo
              name={target.company}
              src={target.logoUrl}
              className="text-meta size-9 shrink-0 rounded-full"
            />
            <div className="min-w-0">
              <p className="text-label text-ink truncate font-semibold">{target.role}</p>
              <p className="text-note text-ink-meta truncate">
                {target.company}
                {/* A pick from Choose Application can change until Confirm. */}
                {!job && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      onClick={() => setChoosing(true)}
                      className="text-brand hover:text-brand-hover focus-visible:ring-brand-ring rounded-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
                    >
                      Change
                    </button>
                  </>
                )}
              </p>
            </div>
          </div>
        ) : unlisted ? (
          <p className="text-meta text-ink-muted">
            It goes on the application the tracker matched it to.
          </p>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setChoosing(true)}>
            <ListChecksIcon aria-hidden className="size-4" />
            Choose Application
          </Button>
        )}
        {!job && !unlisted && (
          <PickApplication
            open={choosing}
            jobs={jobs}
            picked={pick}
            description="Pick the application this email is about."
            onPick={(id) => {
              setPick(id);
              setChoosing(false);
            }}
            onClose={() => setChoosing(false)}
          />
        )}

        {target && (
          <div className="flex items-center gap-2" aria-label="Stage change">
            <StagePill stage={target.stage} />
            {after ? (
              <>
                <ArrowRightIcon aria-label="to" className="text-ink-meta size-4" />
                <StagePill stage={after} />
              </>
            ) : (
              <span className="text-note text-ink-meta">Stage stays</span>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => decide(() => dismissUpdate(email.id), "Couldn't set it aside.")}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={pending || (!job && !unlisted && !pick)}
            onClick={() =>
              decide(
                () => acceptUpdate(email.id, job || unlisted ? null : pick),
                "Couldn't apply it.",
              )
            }
          >
            Confirm
          </Button>
        </div>
      </div>
      {dated && target && (
        <p className="text-note text-ink-meta border-border-subtle border-t px-4 py-2.5">
          Adds {email.emailKind === "interview" ? "the interview" : "the due date"},{" "}
          <When at={email.at} />, to its timeline.
        </p>
      )}
    </section>
  );
}

/** A stage in its own pill, as the Applications Tracker draws it. */
function StagePill({ stage }: { stage: StageKey }) {
  return <Badge tone={STAGE_COLOR[stage].tone}>{STAGE_LABEL[stage]}</Badge>;
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
