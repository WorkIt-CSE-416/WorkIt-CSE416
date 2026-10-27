"use client";

import { ArrowLeftIcon } from "@/components/icons";
import { ShallowLink, useShallowParams } from "@/components/shallow-routing";
import { chipClasses } from "@/components/ui/chip";
import { cn } from "@/lib/cn";

import type { Email } from "../applications/tracked";
import { EmailRowContent, type EmailJob } from "./email-row";
import { NoEmailPicked, ReadingPane } from "./reading-pane";

/** The Inbox's filters, in order, each a `?filter=` value. Needs Review is
 *  the one with a count: the rest are kinds to look up, not work to do. */
const FILTERS = [
  { value: "all", label: "All" },
  { value: "review", label: "Needs Review" },
  { value: "interview", label: "Interviews" },
  { value: "assessment", label: "Assessments" },
  { value: "offer", label: "Offers" },
  { value: "rejection", label: "Rejections" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

function matches(email: Email, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "review") return email.status === "proposed";
  return email.emailKind === filter;
}

/**
 * The Inbox (KAN-413): every email about the student's applications, as an
 * inbox lists them, beside a reading pane, as Gmail and Superhuman lay out a
 * mailbox. The filter and the open email are the URL (`?filter=`,
 * `?email=`), moved in place (ShallowLink), so a click never asks the
 * server and an email can be linked to, as an application's Emails tab
 * does. Below md the two take turns: the list, or the email with Back.
 */
export function Inbox({ emails, jobs }: { emails: Email[]; jobs: EmailJob[] }) {
  const params = useShallowParams();
  const filter = (FILTERS.find((f) => f.value === params.get("filter"))?.value ?? "all") as Filter;
  const openId = params.get("email");
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const shown = emails.filter((email) => matches(email, filter));
  const open = emails.find((email) => email.id === openId);
  const waiting = emails.filter((email) => email.status === "proposed").length;

  const href = (next: { filter?: Filter; email?: string | null }) => {
    const query = new URLSearchParams();
    const f = next.filter ?? filter;
    if (f !== "all") query.set("filter", f);
    const e = next.email === undefined ? openId : next.email;
    if (e) query.set("email", e);
    const text = query.toString();
    return `/inbox${text ? `?${text}` : ""}`;
  };

  return (
    <>
      <nav aria-label="Inbox Filters" className="mt-5 flex flex-wrap gap-2">
        {FILTERS.map(({ value, label }) => (
          <ShallowLink
            key={value}
            href={href({ filter: value })}
            aria-current={filter === value ? "page" : undefined}
            className={chipClasses({ pressed: filter === value })}
          >
            {label}
            {value === "review" && waiting > 0 && <span className="tabular-nums">{waiting}</span>}
          </ShallowLink>
        ))}
      </nav>

      <div className="border-border-subtle rounded-card bg-panel mt-4 grid min-h-[34rem] overflow-hidden border md:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
        <div
          className={cn(
            "border-border-subtle md:border-r",
            // Below md the open email takes the whole frame.
            open && "hidden md:block",
          )}
        >
          {shown.length > 0 ? (
            <ul className="divide-border-subtle divide-y">
              {shown.map((email) => (
                <li key={email.id}>
                  <ShallowLink
                    href={href({ email: email.id })}
                    aria-current={email.id === openId ? "true" : undefined}
                    className="focus-visible:ring-brand-ring block focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
                  >
                    <EmailRowContent
                      email={email}
                      job={email.jobId ? byId.get(email.jobId) : undefined}
                      selected={email.id === openId}
                    />
                  </ShallowLink>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body text-ink-meta p-6">
              {filter === "review" ? "Nothing needs your review." : "No emails here."}
            </p>
          )}
        </div>

        <div className={cn(!open && "hidden md:block")}>
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
