"use client";

import Link from "next/link";

import type { Email } from "../tracked";
import { EmailRowContent, type EmailJob } from "../../inbox/email-row";

/**
 * An application's Emails tab (KAN-413): every email about this job, as the
 * Inbox lists them (../../inbox/email-row.tsx), newest first. A row opens
 * the email in the Inbox's reading pane (`/inbox?email=`), whose Back
 * returns here, so an email is read and decided in one place.
 */
export function EmailsTab({ emails, job }: { emails: Email[]; job: EmailJob }) {
  if (emails.length === 0) {
    return (
      <p className="text-body text-ink-meta mt-6">
        Replies about this application show up here once Gmail is connected.
      </p>
    );
  }
  return (
    <ul className="border-border-subtle rounded-card bg-panel divide-border-subtle mt-6 divide-y overflow-hidden border">
      {emails.map((email) => (
        <li key={email.id}>
          <Link
            href={`/inbox?email=${encodeURIComponent(email.id)}`}
            className="focus-visible:ring-brand-ring block focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
          >
            <EmailRowContent email={email} job={job} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
