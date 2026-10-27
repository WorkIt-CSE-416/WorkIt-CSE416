"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { CloseIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SectionHeading } from "@/components/ui/section-heading";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

import { When } from "../../local-time";
import type { StageKey } from "../../stage-colors";
import { sortKey, type ApplicationEvent } from "../../tracker";
import { acceptUpdate, dismissUpdate } from "../actions";
import { acceptEffect, EmailKindPill, type EmailKind } from "../email-kinds";
import type { Update } from "../tracked";

/**
 * Emails (KAN-413, docs/email_tracker.md): every email about this
 * application, as one record, so a confirmation, an assessment, an
 * interview invite or a rejection is kept with the job it is about, not
 * only as a date. One row per email: its kind's pill (./../email-kinds),
 * its subject and summary, the date it names, and where it stands: the
 * waiting ones (the Updates table's rows for this job) with Accept and
 * Dismiss, the accepted ones marked Added. Waiting ones come first, then
 * the rest, newest first. Until Gmail is connected (build step 3) it holds
 * only what a sample or a test put there.
 */
export function ApplicationEmails({
  jobId,
  stage,
  waiting,
  accepted,
}: {
  jobId: string;
  stage: StageKey;
  /** Updates proposed for this application. */
  waiting: Update[];
  /** This application's events read from email, already accepted. */
  accepted: ApplicationEvent[];
}) {
  const newest = (a: { at: string }, b: { at: string }) =>
    (b.at ? sortKey(b.at) : 0) - (a.at ? sortKey(a.at) : 0);
  const rows = [
    ...[...waiting].sort(newest).map((email) => ({ email, waiting: true })),
    ...[...accepted].sort(newest).map((email) => ({ email, waiting: false })),
  ];

  return (
    <section aria-labelledby={`emails-${jobId}`} className="mt-5">
      <SectionHeading id={`emails-${jobId}`}>Emails</SectionHeading>
      {rows.length > 0 ? (
        <ul className="divide-border-subtle border-border-subtle rounded-card bg-panel mt-3 divide-y border">
          {rows.map(({ email, waiting }) => (
            <EmailRow
              key={email.id ?? email.title + email.at}
              email={email}
              waiting={waiting}
              stage={stage}
            />
          ))}
        </ul>
      ) : (
        <p className="text-body text-ink-meta mt-3">
          Replies about this application show here once Gmail is connected.
        </p>
      )}
    </section>
  );
}

function EmailRow({
  email,
  waiting,
  stage,
}: {
  email: ApplicationEvent;
  waiting: boolean;
  stage: StageKey;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const kind: EmailKind = email.emailKind ?? "other";

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

  return (
    <li
      className={cn(
        "grid grid-cols-1 gap-3 p-4 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-start",
        pending && "opacity-50",
      )}
    >
      <div>
        <EmailKindPill kind={kind} />
        {waiting && <p className="text-note text-ink-meta mt-1">{acceptEffect(kind, stage)}</p>}
      </div>
      <div className="min-w-0">
        <p className="text-label text-ink truncate font-semibold" title={email.title}>
          {email.title}
        </p>
        {email.at && (
          <p className="text-note text-ink-meta">
            <When at={email.at} />
          </p>
        )}
        {email.note && <p className="text-body text-ink-muted mt-1">{email.note}</p>}
      </div>
      <div className="flex items-center gap-2 sm:justify-end">
        {waiting && email.id ? (
          <>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => decide(() => acceptUpdate(email.id!, null), "Couldn't add the email.")}
            >
              Accept
            </Button>
            <IconButton
              label={`Dismiss ${email.title}`}
              tooltip="Dismiss"
              disabled={pending}
              onClick={() => decide(() => dismissUpdate(email.id!), "Couldn't dismiss it.")}
            >
              <CloseIcon className="size-4" />
            </IconButton>
          </>
        ) : (
          <Badge tone="inert">Added</Badge>
        )}
      </div>
    </li>
  );
}
