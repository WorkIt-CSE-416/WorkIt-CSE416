"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { CompanyLogo } from "@/components/company-logo";
import { CloseIcon, ExternalLinkIcon, GmailIcon, MailIcon } from "@/components/icons";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/shadcn/sheet";
import { Button, buttonClasses } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SelectField } from "@/components/ui/select-field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

import { When } from "../local-time";
import { isAllDay } from "../tracker";
import { acceptUpdate, dismissUpdate } from "./actions";
import { acceptEffect, EmailKindPill } from "./email-kinds";
import { CalendarPlusIcon, ReplyIcon } from "./icons";
import { applicationHref } from "./query";
import type { Update } from "./tracked";
import type { UpdateTarget } from "./updates";

/**
 * One email, read the way Gmail shows it (KAN-413), in a panel that slides
 * in from the right over the Applications Tracker when an Email Updates row
 * is clicked: the subject with its kind's pill, the sender's line with the
 * date, then the body. A toolbar along the top holds the common actions
 * (Accept, Dismiss, Reply, Open in Gmail) and WorkIt's own (Open
 * Application, Add to Google Calendar).
 *
 * WHAT IT CAN SHOW. WorkIt keeps no email bodies (docs/email_tracker.md,
 * "Privacy and security"): the body here is the summary the tracker kept,
 * and a line says the whole email opens in Gmail. Reply and Open in Gmail
 * are disabled until Gmail is connected (the message id they need is a
 * step 3 column). Add to Google Calendar works now: it opens Google's own
 * new-event page, filled in, for an email that names a date, with no
 * sign-in of WorkIt's.
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
          <EmailBody
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

function EmailBody({
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
  const [pick, setPick] = useState("");
  const job = target ?? applications.find((app) => app.id === pick);

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

  const calendar = job && update.at ? calendarLink(update, job) : null;

  return (
    <div className={cn("flex h-full flex-col", pending && "opacity-60")}>
      {/* THE TOOLBAR: the decision first, then the common actions, then
          WorkIt's own. Disabled ones say why in their tooltip. */}
      <div className="border-border-subtle flex flex-wrap items-center gap-2 border-b px-5 py-3 pr-12">
        <Button
          size="sm"
          disabled={pending || !job}
          onClick={() =>
            decide(() => acceptUpdate(update.id, target ? null : pick), "Couldn't add the email.")
          }
        >
          Accept
        </Button>
        <IconButton
          label="Dismiss"
          variant="outline"
          className="size-9"
          disabled={pending}
          onClick={() => decide(() => dismissUpdate(update.id), "Couldn't dismiss it.")}
        >
          <CloseIcon className="size-4" />
        </IconButton>
        <Divider />
        <IconButton
          label="Reply"
          tooltip="Reply works once Gmail is connected"
          variant="outline"
          className="size-9"
          disabled
        >
          <ReplyIcon className="size-4" />
        </IconButton>
        <IconButton
          label="Open in Gmail"
          tooltip="Opens in Gmail once it is connected"
          variant="outline"
          className="size-9"
          disabled
        >
          <GmailIcon className="size-4" />
        </IconButton>
        <Divider />
        {job && (
          <ToolbarLink href={applicationHref(job.id)} label="Open Application">
            <ExternalLinkIcon className="size-4" />
          </ToolbarLink>
        )}
        {calendar && (
          <ToolbarLink
            href={calendar}
            label="Add to Calendar"
            title="Opens Google Calendar with the event filled in"
            external
          >
            <CalendarPlusIcon className="size-4" />
          </ToolbarLink>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-5">
        <SheetHeader className="gap-2 p-0">
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="text-title text-ink font-semibold">{update.title}</SheetTitle>
            <EmailKindPill kind={update.emailKind} />
          </div>
          <SheetDescription className="text-meta text-ink-meta">
            {acceptEffect(update.emailKind, job?.stage)} when you accept it.
          </SheetDescription>
        </SheetHeader>

        {/* THE SENDER'S LINE, as Gmail draws it: who, about which job, and
            the date on the right. */}
        <div className="mt-5 flex items-start gap-3">
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
            <p className="text-note text-ink-meta truncate">
              {job ? `About ${job.role}` : "Matched none of your jobs"}
            </p>
          </div>
          {update.at && (
            <p className="text-note text-ink-meta shrink-0">
              <When at={update.at} />
            </p>
          )}
        </div>

        {!target && (
          <div className="mt-4">
            <SelectField
              id={`view-pick-${update.id}`}
              label="Which job is it about?"
              placeholder="Pick a Job"
              value={pick}
              onValueChange={setPick}
              options={applications.map((app) => ({
                value: app.id,
                label: `${app.company} · ${app.role}`,
              }))}
            />
          </div>
        )}

        <div className="text-body text-ink mt-6 whitespace-pre-line">
          {update.note ?? "No summary was kept for this email."}
        </div>
        <p className="text-note text-ink-meta border-border-subtle mt-6 border-t pt-4">
          WorkIt keeps a summary, not the whole email. The full email opens in Gmail once it&apos;s
          connected.
        </p>
      </div>
    </div>
  );
}

function Divider() {
  return <span aria-hidden="true" className="bg-border-subtle mx-1 h-6 w-px" />;
}

/** A toolbar action that goes somewhere, drawn as the outline icon
 *  buttons beside it, with its name on hover. */
function ToolbarLink({
  href,
  label,
  title,
  external = false,
  children,
}: {
  href: string;
  label: string;
  /** Said on hover, where the label is short. */
  title?: string;
  external?: boolean;
  children: ReactNode;
}) {
  const className = buttonClasses({ variant: "secondary", size: "sm" });
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" title={title} className={className}>
      {children}
      {label}
    </a>
  ) : (
    <Link href={href} className={className}>
      {children}
      {label}
    </Link>
  );
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
