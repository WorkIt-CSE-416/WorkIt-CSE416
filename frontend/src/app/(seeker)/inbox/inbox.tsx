"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { type FacetOption, FieldFacet } from "@/components/field-facet";
import { ArrowLeftIcon, CloseIcon } from "@/components/icons";
import { ShallowLink, useShallowParams, useShallowPush } from "@/components/shallow-routing";
import { IconButton } from "@/components/ui/icon-button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

import { markEmailsRead } from "../applications/actions";
import { emailKindGlyph } from "../applications/email-kinds";
import { StatusIcon } from "../applications/icons";
import type { Email } from "../applications/tracked";
import { EmailRowContent, rowFill, type EmailJob } from "./email-row";
import { NoEmailPicked, ReadingPane } from "./reading-pane";
import { InboxToolbar, RowCheck } from "./toolbar";

/** The Status dropdown's options, each a `?status=` value: what an email
 *  says of its application, the email kinds, each in its pill's glyph and
 *  colour (email-kinds.tsx). */
const STATUSES: FacetOption[] = (
  [
    ["interview", "Interviews"],
    ["assessment", "Assessments"],
    ["offer", "Offers"],
    ["rejection", "Rejections"],
    ["confirmation", "Application Received"],
    ["other", "Updates"],
  ] as const
).map(([kind, label]) => ({ value: kind, label, ...emailKindGlyph(kind) }));

/** The `?status=` list, keeping only the values it may hold. */
function picks(raw: string | null): string[] {
  return (raw ?? "").split(",").filter((v) => STATUSES.some((s) => s.value === v));
}

/**
 * The Inbox (KAN-413): every email about the student's applications, as an
 * inbox lists them, beside a reading pane, as Gmail and Superhuman lay out a
 * mailbox. The filter and the open email are the URL (`?status=`,
 * `?email=`), moved in place (ShallowLink), so a click never asks the
 * server and an email can be linked to, as an application's Emails tab
 * does. Below md the two take turns: the list, or the email with Back.
 *
 * ONE FILTER, STATUS, A DROPDOWN as on the Applications Tracker (KAN-427):
 * what the email says (an interview, an offer...), with a cross to clear
 * it. It was a row of six chips (KAN-413), which grew with every kind, and
 * for a while two dropdowns, Kind and a review Status (Needs Review, On
 * Your Tracker, Set Aside); the review one went, with the cards' Needs
 * Review badge, as noise: an email that waits says so when it is opened
 * (./reading-pane.tsx, the status banner). Named Status, not Kind: an
 * interview or an offer is where the application stands.
 *
 * THE TOOLBAR IS GMAIL'S (./toolbar.tsx): a select box over the list, with
 * Refresh and Mark All as Read while nothing is picked, and the picked
 * emails' actions while some are. A pick lasts while its email is shown,
 * so a filter that hides it unpicks it, and an action clears the picks.
 *
 * READ STATE IS THE API'S `readAt` (KAN-427), drawn ahead of it: opening an
 * unread email, or Mark as Read, shows it read at once (`marks`) and sends
 * the write; a refused write puts it back and says so.
 *
 * The frame takes the page's height left under the filters (./page.tsx),
 * in one row under the toolbar that may shrink below its content
 * (`minmax(0,1fr)`), so each column scrolls on its own and scrolling one
 * never moves the other. Its floor, `min-h-80`, is for a short window:
 * there the page scrolls once the frame cannot shrink further, rather than
 * leave a sliver of list.
 */
export function Inbox({ emails, jobs }: { emails: Email[]; jobs: EmailJob[] }) {
  const params = useShallowParams();
  const push = useShallowPush();
  const router = useRouter();
  const toast = useToast();
  const [, start] = useTransition();
  const statuses = picks(params.get("status"));
  const openId = params.get("email");
  const byId = new Map(jobs.map((job) => [job.id, job]));

  // What the student marked, ahead of the refreshed read: id → read. The
  // open email reads as read from the moment it opens.
  const [marks, setMarks] = useState<Map<string, boolean>>(new Map());
  const isRead = (email: Email) =>
    marks.get(email.id) ?? (email.readAt != null || email.id === openId);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const shown = emails.filter(
    (email) => statuses.length === 0 || statuses.includes(email.emailKind),
  );
  const checked = shown.filter((email) => picked.has(email.id));
  const open = emails.find((email) => email.id === openId);

  function mark(ids: string[], read: boolean, done?: () => void) {
    if (ids.length === 0) return;
    const before = marks;
    setMarks(new Map([...marks, ...ids.map((id) => [id, read] as const)]));
    start(async () => {
      const { error } = await markEmailsRead(ids, read);
      if (error) {
        setMarks(before);
        toast.show({ message: `Couldn't mark ${read ? "them read" : "them unread"}. ${error}` });
        return;
      }
      done?.();
      router.refresh();
    });
  }

  // Opening an unread email reads it, as Gmail does: drawn read at once
  // (isRead), and stored here, once per email opened. A failed write only
  // leaves it unread for the next visit, so it says nothing.
  const openUnread = open && open.readAt == null && marks.get(open.id) !== false ? open.id : null;
  useEffect(() => {
    if (!openUnread) return;
    void markEmailsRead([openUnread], true).then(({ error }) => {
      if (!error) router.refresh();
    });
    // Once per email opened, never again on a refresh of the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  const href = (next: { statuses?: string[]; email?: string | null }) => {
    const query = new URLSearchParams();
    const s = next.statuses ?? statuses;
    if (s.length) query.set("status", s.join(","));
    const e = next.email === undefined ? openId : next.email;
    if (e) query.set("email", e);
    const text = query.toString();
    return `/inbox${text ? `?${text}` : ""}`;
  };

  return (
    <>
      <div
        role="group"
        aria-label="Inbox Filters"
        className="mt-5 flex flex-wrap items-center gap-2"
      >
        <FieldFacet
          label="Status"
          Icon={StatusIcon}
          options={STATUSES}
          values={statuses}
          onChange={(next) => push(href({ statuses: next }))}
        />
        {statuses.length > 0 && (
          <IconButton
            label="Clear Filter"
            className="size-8"
            onClick={() => push(href({ statuses: [] }))}
          >
            <CloseIcon className="size-4" />
          </IconButton>
        )}
      </div>

      <div className="border-border-subtle rounded-card bg-panel mt-4 grid min-h-80 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border md:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
        <InboxToolbar
          className={cn("col-span-full", open && "hidden md:flex")}
          shown={shown}
          checked={checked}
          isRead={isRead}
          onPick={(ids) => setPicked(new Set(ids))}
          onMark={(ids, read) => mark(ids, read, () => setPicked(new Set()))}
          onDone={() => setPicked(new Set())}
          total={emails.length}
        />

        <div
          className={cn(
            "border-border-subtle overflow-y-auto overscroll-contain md:border-r",
            // Below md the open email takes the whole frame.
            open && "hidden md:block",
          )}
        >
          {shown.length > 0 ? (
            <ul className="divide-border-subtle divide-y">
              {shown.map((email) => {
                const here = email.id === openId;
                const on = picked.has(email.id);
                return (
                  <li
                    key={email.id}
                    className={cn(
                      "flex items-start",
                      rowFill({ read: isRead(email), open: here, picked: on }),
                    )}
                  >
                    <RowCheck
                      email={email}
                      job={email.jobId ? byId.get(email.jobId) : undefined}
                      checked={on}
                      onChange={(next) => {
                        const ids = new Set(picked);
                        if (next) ids.add(email.id);
                        else ids.delete(email.id);
                        setPicked(ids);
                      }}
                    />
                    <ShallowLink
                      href={href({ email: email.id })}
                      aria-current={here ? "true" : undefined}
                      className="focus-visible:ring-brand-ring block min-w-0 flex-1 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
                    >
                      <EmailRowContent
                        email={email}
                        job={email.jobId ? byId.get(email.jobId) : undefined}
                        selected={here}
                        read={isRead(email)}
                        bare
                      />
                    </ShallowLink>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-body text-ink-meta p-6">No emails here.</p>
          )}
        </div>

        <div className={cn("overflow-y-auto overscroll-contain", !open && "hidden md:block")}>
          {open ? (
            <>
              <ShallowLink
                href={href({ email: null })}
                className="text-label text-ink-meta hover:text-ink mt-4 ml-6 inline-flex items-center gap-1.5 md:hidden"
              >
                <ArrowLeftIcon className="size-4" />
                Back to Inbox
              </ShallowLink>
              <ReadingPane
                email={open}
                job={open.jobId ? byId.get(open.jobId) : undefined}
                jobs={jobs}
              />
            </>
          ) : (
            <NoEmailPicked />
          )}
        </div>
      </div>
    </>
  );
}
