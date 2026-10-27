"use client";

import Link from "next/link";
import { useState, type MouseEvent } from "react";

import { CompanyLogo } from "@/components/company-logo";
import { MailIcon } from "@/components/icons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/table";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/cn";

import { When } from "../local-time";
import type { StageKey } from "../stage-colors";
import { EmailKindPill } from "./email-kinds";
import { EmailView } from "./email-view";
import { applicationHref } from "./query";
import type { Update } from "./tracked";

/**
 * Email Updates (KAN-413, docs/email_tracker.md, "Where it lives"): emails
 * the email tracker read from Gmail, waiting for the student, as a table at
 * the top of the Applications Tracker, framed as Auto Apply's Live Activity
 * table is. It shows only while an email waits.
 *
 * THREE COLUMNS, ONE LINE A ROW: the job, the email's kind as a pill, and
 * the date it names. A click on a row opens the email itself
 * (./email-view.tsx, a Gmail-style panel with a toolbar: Accept, Dismiss,
 * Reply, Open in Gmail, Open Application, Add to Google Calendar); the
 * job's name stays a link to its application, whose Emails lists the same
 * email. An email that matched no job says so in its row and is linked to
 * one in its panel. The user cut the first versions down to this: a card
 * per email with Move to Interviewing, Not Right and Wrong Job? under two
 * tabs, then a table with an Email column, a line under each pill and
 * Accept and dismiss on every row, which made each row tall.
 */

/** The application a row names, as the tracker already holds it. */
export type UpdateTarget = {
  id: string;
  role: string;
  company: string;
  logoUrl: string | null;
  stage: StageKey;
};

const TH = "text-note text-ink-meta px-4 font-medium";
const TD = "text-note text-ink px-4 py-3";

export function UpdatesTable({
  updates,
  applications,
}: {
  updates: Update[];
  applications: UpdateTarget[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (updates.length === 0) return null;
  const byId = new Map(applications.map((app) => [app.id, app]));
  const open = updates.find((update) => update.id === openId) ?? null;

  /** A click anywhere on a row opens its email, but a link or button in
   *  it keeps its own job. */
  function rowClick(event: MouseEvent<HTMLTableRowElement>, id: string) {
    if ((event.target as HTMLElement).closest("a, button")) return;
    setOpenId(id);
  }

  return (
    <section aria-labelledby="email-updates" className="mt-6">
      <SectionHeading id="email-updates">Email Updates ({updates.length})</SectionHeading>
      <p className="text-meta text-ink-meta mt-1">
        Replies about your applications. Open one to read it and accept or dismiss it.
      </p>
      <Card padding="none" className="mt-3 overflow-x-auto">
        <Table className="min-w-[36rem] table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn(TH, "w-[55%]")}>Job</TableHead>
              <TableHead className={cn(TH, "w-[25%]")}>Type</TableHead>
              <TableHead className={cn(TH, "w-[20%]")}>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {updates.map((update) => {
              const target = update.jobId ? byId.get(update.jobId) : undefined;
              return (
                <TableRow
                  key={update.id}
                  onClick={(event) => rowClick(event, update.id)}
                  className="hover:bg-hover cursor-pointer"
                >
                  <TableCell className={TD}>
                    {target ? <JobCell target={target} /> : <NoJobCell />}
                  </TableCell>
                  <TableCell className={TD}>
                    {/* The row's keyboard way in: the pill is its button. */}
                    <button
                      type="button"
                      onClick={() => setOpenId(update.id)}
                      aria-label={`Open the email: ${update.title}`}
                      className="focus-visible:ring-brand-ring rounded-full focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <EmailKindPill kind={update.emailKind} />
                    </button>
                  </TableCell>
                  <TableCell className={cn(TD, !update.at && "text-ink-meta")}>
                    {update.at ? <When at={update.at} /> : "None"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      <EmailView
        update={open}
        target={open?.jobId ? byId.get(open.jobId) : undefined}
        applications={applications}
        onClose={() => setOpenId(null)}
      />
    </section>
  );
}

/** The job's logo, role (the row's real link, for the keyboard) and company. */
function JobCell({ target }: { target: UpdateTarget }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <CompanyLogo
        name={target.company}
        src={target.logoUrl}
        className="text-meta size-8 shrink-0 rounded"
      />
      <div className="min-w-0">
        <Link
          href={applicationHref(target.id)}
          className="text-label text-ink hover:text-brand focus-visible:ring-brand-ring block truncate rounded-xs font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          title={target.role}
        >
          {target.role}
        </Link>
        <p className="text-note text-ink-meta truncate">{target.company}</p>
      </div>
    </div>
  );
}

/** An email that matched none of the student's jobs: it is linked to one
 *  in its panel. */
function NoJobCell() {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="bg-surface flex size-8 shrink-0 items-center justify-center rounded">
        <MailIcon className="text-ink-meta size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-label text-ink font-semibold">No Matching Job</p>
        <p className="text-note text-ink-meta">Open it to pick one</p>
      </div>
    </div>
  );
}
