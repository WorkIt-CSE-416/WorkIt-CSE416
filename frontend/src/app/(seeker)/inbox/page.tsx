import { CloudSlashIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { Suspense } from "react";

import { MailIcon } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

import { getEmailsOnce, getTracker } from "../applications/data";
import { SEEKER_GUTTER } from "../gutter";
import { Inbox } from "./inbox";

export const metadata: Metadata = {
  title: "Inbox",
  description: "Replies about your applications, filed onto their jobs.",
};

/**
 * /inbox (KAN-413, docs/email_tracker.md, "Where it lives"): every email
 * about the student's applications, its own page, after the critique that
 * moved it off the Applications Tracker (an email table stacked on the
 * applications list read as a second, worse copy of it). A list beside a
 * reading pane (./inbox.tsx). The emails come from GET .../emails, every
 * status, and the jobs from the tracker's own read, so a sender's logo and a
 * job's stage match the tracker. Nothing writes emails until the Gmail
 * reader is built; the six on the shared test data are samples.
 *
 * THE PAGE IS EXACTLY THE SCREEN UNDER THE BAR (KAN-427), the job rail's
 * `100svh-4rem` (../jobs/jobs-rail.tsx), as a mailbox is: the heading and
 * the filters stay put, and the list and the open email each scroll inside
 * their own column (./inbox.tsx). It used to grow with its longest column,
 * so the whole page scrolled and took the filters with it.
 */
export default async function InboxPage() {
  const [{ emails, error: emailsError }, { applications, error: trackerError }] = await Promise.all(
    [getEmailsOnce(), getTracker()],
  );
  // Without the jobs every email would read as Unknown Sender and Not
  // Linked, so a failed tracker read is the Inbox's failure too, never
  // stand-ins.
  const error = emailsError ?? trackerError;
  const jobs = (applications ?? []).map(({ id, role, company, logoUrl, stage, appliedOn }) => ({
    id,
    role,
    company,
    logoUrl,
    stage,
    appliedOn,
  }));

  return (
    <div
      className={cn(
        "max-w-dashboard mx-auto flex h-[calc(100svh-4rem)] w-full flex-col py-6",
        SEEKER_GUTTER,
      )}
    >
      <h1 className="text-heading text-ink">Inbox</h1>
      <p className="text-body text-ink-meta mt-1">
        Replies about your applications, filed onto their jobs.
      </p>

      {emails == null || applications == null ? (
        <EmptyState
          Icon={CloudSlashIcon}
          title="Your Inbox Isn't Loading"
          className="mt-6"
          detail={process.env.NODE_ENV === "development" ? error : undefined}
        >
          We couldn&apos;t reach your emails. Refresh the page in a few minutes.
        </EmptyState>
      ) : emails.length === 0 ? (
        <EmptyState Icon={MailIcon} title="No Emails Yet" className="mt-6">
          Once Gmail is connected in Settings, replies about your applications show up here.
        </EmptyState>
      ) : (
        // The filter and the open email are read in the browser
        // (useShallowParams), which needs a boundary on a server page.
        <Suspense>
          <Inbox emails={emails} jobs={jobs} />
        </Suspense>
      )}
    </div>
  );
}
