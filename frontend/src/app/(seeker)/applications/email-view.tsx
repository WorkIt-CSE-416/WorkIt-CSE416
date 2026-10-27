"use client";

import { format, formatDistanceToNowStrict } from "date-fns";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { CompanyLogo } from "@/components/company-logo";
import { ExternalLinkIcon, MailIcon } from "@/components/icons";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/shadcn/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { Button, buttonClasses } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SelectField } from "@/components/ui/select-field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

import { useHydrated, When } from "../local-time";
import { STAGE_LABEL, type StageKey } from "../stage-colors";
import { isAllDay } from "../tracker";
import { acceptUpdate, dismissUpdate } from "./actions";
import { EmailKindPill, type EmailKind } from "./email-kinds";
import { CalendarPlusIcon, DoneIcon, ReplyIcon } from "./icons";
import { applicationHref } from "./query";
import type { Update } from "./tracked";
import type { UpdateTarget } from "./updates";

/**
 * One email, read the way Gmail shows an open message (KAN-413), in a panel
 * from the right over the Applications Tracker when an Email Updates row is
 * clicked:
 *
 *   toolbar      icons only: Done (Gmail's Archive: leave it off the
 *                tracker), Open Application, Add to Calendar
 *   subject      the email's subject and its kind's pill
 *   suggestion   one line and one action: what WorkIt would do with it
 *                ("Move to Interviewing", "Add to Timeline"), or, for an
 *                email that matched no job, which job it is about
 *   sender       the sender's logo and name, "to me", and on the right the
 *                received date and time with Reply
 *   body         the email's text
 *   footer       Reply, as Gmail's message ends
 *
 * A first version had Accept, a dismiss cross, Reply and Open in Gmail as a
 * row of buttons with Open Application and Add to Calendar as worded
 * buttons, and put the summary where the email should be; the user wanted
 * fewer buttons and a real email's layout. Reply opens Gmail on a search
 * for the subject (the message id it needs to open the email itself is a
 * step 3 column). WorkIt keeps no email bodies (docs/email_tracker.md,
 * "Privacy and security"): the body shown is the text the tracker kept.
 */
export function EmailView({
  update,
  target,
  applications,
  onClose,
}: {
  /** The email shown; null closes the panel. */
  update: Update | null;
  target: UpdateTarget | undefined;
  applications: UpdateTarget[];
  onClose: () => void;
}) {
  return (
    <Sheet open={update != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        {update && (
          <Message
            // A new email starts with a fresh job pick.
            key={update.id}
            update={update}
            target={target}
            applications={applications}
            onDone={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Message({
  update,
  target,
  applications,
  onDone,
}: {
  update: Update;
  target: UpdateTarget | undefined;
  applications: UpdateTarget[];
  onDone: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  function decide(run: () => Promise<{ error: string | null }>, failed: string) {
    start(async () => {
      const { error } = await run();
      if (error) {
        toast.show({ message: `${failed} ${error}` });
        return;
      }
      onDone();
      router.refresh();
    });
  }

  const gmail = gmailSearch(update.title);
  const calendar = target && update.at ? calendarLink(update, target) : null;

  return (
    <div className={cn("flex h-full flex-col", pending && "opacity-60")}>
      {/* THE TOOLBAR, icons only, as Gmail's above an open message. */}
      <div className="border-border-subtle flex items-center gap-1 border-b px-4 py-2 pr-12">
        <IconButton
          label="Done"
          tooltip="Done: leave it off your tracker"
          className="size-9"
          disabled={pending}
          onClick={() => decide(() => dismissUpdate(update.id), "Couldn't mark it done.")}
        >
          <DoneIcon className="size-[18px]" />
        </IconButton>
        {target && (
          <ToolbarLink href={applicationHref(target.id)} label="Open Application">
            <ExternalLinkIcon className="size-[18px]" />
          </ToolbarLink>
        )}
        {calendar && (
          <ToolbarLink href={calendar} label="Add to Google Calendar" external>
            <CalendarPlusIcon className="size-[18px]" />
          </ToolbarLink>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-6 pt-5 pb-8">
        <SheetHeader className="p-0">
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="text-title text-ink font-semibold">{update.title}</SheetTitle>
            <EmailKindPill kind={update.emailKind} />
          </div>
          <SheetDescription className="sr-only">
            An email about {target ? `${target.role} at ${target.company}` : "a job you applied to"}
            .
          </SheetDescription>
        </SheetHeader>

        <Suggestion
          update={update}
          target={target}
          applications={applications}
          pending={pending}
          onAccept={(jobId) =>
            decide(() => acceptUpdate(update.id, jobId), "Couldn't add the email.")
          }
        />

        {/* THE SENDER'S LINE, as Gmail draws it: who, to whom, and the
            received time with Reply on the right. */}
        <div className="mt-5 flex items-start gap-3">
          {target ? (
            <CompanyLogo
              name={target.company}
              src={target.logoUrl}
              className="text-label size-10 shrink-0 rounded-full"
            />
          ) : (
            <span className="bg-surface flex size-10 shrink-0 items-center justify-center rounded-full">
              <MailIcon className="text-ink-meta size-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-label text-ink font-semibold">
              {target ? target.company : "Unknown sender"}
            </p>
            <p className="text-note text-ink-meta">to me</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {update.receivedAt && <Received at={update.receivedAt} />}
            <ToolbarLink href={gmail} label="Reply in Gmail" external>
              <ReplyIcon className="size-[18px]" />
            </ToolbarLink>
          </div>
        </div>

        <div className="text-body text-ink mt-5 pl-[52px] whitespace-pre-line">
          {update.note ?? "No text was kept for this email."}
        </div>

        <div className="mt-8 pl-[52px]">
          <a
            href={gmail}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            <ReplyIcon className="size-4" />
            Reply
          </a>
        </div>
      </div>
    </div>
  );
}

/** What each kind's suggestion line says, before its action. */
const LINES: Record<EmailKind, string> = {
  confirmation: "Your application went through.",
  assessment: "This asks you to complete an assessment, due",
  interview: "This looks like an interview invite for",
  offer: "This looks like an offer.",
  rejection: "The company isn't moving forward.",
  other: "A message about this application.",
};

/** The stage each kind moves an application to, and how far along each
 *  stage is, as the API's `advance` ranks them: the action names the move
 *  only when it is forward. */
const MOVES_TO: Partial<Record<EmailKind, StageKey>> = {
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
 * One tinted line with one action: what accepting the email does, named for
 * its effect, or, for an email that matched no job, a picker and Add. The
 * only accept on the panel; the toolbar's Done is its opposite.
 */
function Suggestion({
  update,
  target,
  applications,
  pending,
  onAccept,
}: {
  update: Update;
  target: UpdateTarget | undefined;
  applications: UpdateTarget[];
  pending: boolean;
  onAccept: (jobId: string | null) => void;
}) {
  const [pick, setPick] = useState("");
  const box = "bg-brand-tint rounded-card mt-4 flex flex-wrap items-center gap-3 px-4 py-3";

  if (!target) {
    return (
      <div className={box}>
        <p className="text-meta text-ink flex-1">Which job is this about?</p>
        <SelectField
          id={`view-pick-${update.id}`}
          label="Job"
          hideLabel
          placeholder="Pick a Job"
          value={pick}
          onValueChange={setPick}
          options={applications.map((app) => ({
            value: app.id,
            label: `${app.company} · ${app.role}`,
          }))}
          className="w-64"
        />
        <Button size="sm" disabled={!pick || pending} onClick={() => onAccept(pick)}>
          Add
        </Button>
      </div>
    );
  }

  const kind = update.emailKind;
  const move = MOVES_TO[kind];
  const action =
    move && RANK[move] > RANK[target.stage] ? `Move to ${STAGE_LABEL[move]}` : "Add to Timeline";
  // Only the two lines that end on a date take one.
  const dated = (kind === "interview" || kind === "assessment") && update.at;
  return (
    <div className={box}>
      <p className="text-meta text-ink flex-1">
        {dated ? (
          <>
            {LINES[kind]} <When at={update.at} />.
          </>
        ) : (
          LINES[kind].replace(/, due$| for$/, ".")
        )}
      </p>
      <Button size="sm" disabled={pending} onClick={() => onAccept(null)}>
        {action}
      </Button>
    </div>
  );
}

/** Gmail's received line: "Mon, Oct 27, 9:42 AM (3 hours ago)", in the
 *  viewer's own zone. The panel opens only after a click, so it is always
 *  hydrated; the check keeps a server render from printing the server's
 *  zone. */
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

/** An icon that goes somewhere, drawn as the toolbar's icon buttons are,
 *  with its name on hover. */
function ToolbarLink({
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
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          external ? (
            <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} />
          ) : (
            <a href={href} aria-label={label} />
          )
        }
        className="text-ink-meta hover:text-ink hover:bg-hover focus-visible:ring-brand-ring inline-flex size-9 items-center justify-center rounded-full transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
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
function calendarLink(update: Update, job: UpdateTarget) {
  const stamp = (date: Date) =>
    date
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  let dates: string;
  if (isAllDay(update.at)) {
    const day = update.at.replace(/-/g, "");
    const next = new Date(`${update.at}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    dates = `${day}/${next.toISOString().slice(0, 10).replace(/-/g, "")}`;
  } else {
    const start = new Date(update.at);
    dates = `${stamp(start)}/${stamp(new Date(start.getTime() + 60 * 60 * 1000))}`;
  }
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${update.title} · ${job.company}`,
    dates,
    details: `${job.role} at ${job.company}. Added from WorkIt.`,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
