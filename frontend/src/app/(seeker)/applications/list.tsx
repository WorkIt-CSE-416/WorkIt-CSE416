import Link from "next/link";
import type { ReactNode } from "react";

import { SortIcon } from "@/components/icons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

import { STAGE_COLOR, STAGE_LABEL } from "../stage-colors";
import { LocalDate } from "../local-time";
import type { Application } from "../tracker";
import { ApplicationTile } from "./application-tile";
import { MatchBadge } from "./match-badge";
import {
  applicationHref,
  applicationsHref,
  sortApplications,
  type ApplicationsQuery,
  type Sort,
} from "./query";
import { Reflow } from "./reflow";

/**
 * The applications as a table, one row each: role and company, stage, the
 * resume sent, where the job is, its pay, whether its posting is still open,
 * the day it went in, and the Jobs page's match score (KAN-256). A Next Step
 * column went: with no dated events stored, it said "Nothing scheduled" on
 * every row. There is no closing date: scraped postings state none, so
 * Posting says only Open or Closed.
 *
 * It was a stack of cards holding the grid card's fields, marked in the code
 * as a placeholder. A table is what a list of like records wants: columns a
 * reader can scan down, and headings that sort. Its frame follows the company
 * Dashboard's Recent Applicants (company/applicants-preview.tsx): one white
 * card, 12px grey headings, rules between rows and no box around each.
 *
 * SORTING IS A LINK, ?sort=, like every other choice on this page, so the
 * table stays a server component and an order can be shared. Two columns
 * sort, each the way it is read: Applied latest first, Match best first.
 * The rest do not; the stage filter above the
 * table is how a stage is picked out. The heading in force says so in
 * aria-sort as well as in its chevron.
 *
 * Columns drop out as the page narrows (the page's own width, @container/main,
 * not the window's) rather than the table scrolling sideways, the least
 * scanned first: Pay, Location, Posting, Resume, Applied, then Match,
 * keeping role and stage, the two things a phone still needs. Match outlasts
 * the rest since the list became the primary view (KAN-256): the score is
 * the fact a seeker scans for. Every column shows from 1024px of page,
 * which is why the page takes the Dashboard's width. A row opens its
 * application's own page (./[jobId]); the role is the link, stretched across the row.
 */
const TH = "px-4 text-note text-ink-meta font-medium";
/** A plain fact cell: one line of grey note text. */
const TD = "px-4 text-note text-ink-meta";

/** Each optional column, from the one that stays longest to the first to go,
 *  as the page's width (@container/main) reaches it. */
const SHOW = {
  match: "hidden @lg/main:table-cell",
  applied: "hidden @xl/main:table-cell",
  resume: "hidden @2xl/main:table-cell",
  posting: "hidden @3xl/main:table-cell",
  location: "hidden @4xl/main:table-cell",
  pay: "hidden @5xl/main:table-cell",
};

/** Which way each sortable column runs, for aria-sort and the chevron. */
const DIRECTION: Record<Sort, "asc" | "desc"> = { applied: "desc", match: "desc" };

function SortHead({
  sort,
  query,
  className,
  children,
}: {
  sort: Sort;
  query: ApplicationsQuery;
  className?: string;
  children: ReactNode;
}) {
  const active = query.sort === sort;
  const direction = DIRECTION[sort];

  return (
    <TableHead
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : undefined}
      className={cn(TH, className)}
    >
      <Link
        href={applicationsHref(query, { sort, app: null })}
        scroll={false}
        className="hover:text-ink focus-visible:ring-brand-ring inline-flex items-center gap-1 rounded-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
      >
        {children}
        {/* Keyed on its state, so the glyph pops in when the column takes
            the sort rather than swapping in place. */}
        <SortIcon
          key={active ? direction : "none"}
          className={cn("animate-pop size-3.5 shrink-0", active ? "text-brand" : "text-ink-faint")}
          direction={active ? direction : undefined}
        />
      </Link>
    </TableHead>
  );
}

export function ApplicationsList({
  applications,
  query,
}: {
  applications: Application[];
  query: ApplicationsQuery;
}) {
  const rows = sortApplications(applications, query.sort);

  return (
    <Card padding="none" className="mt-4 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(TH, "w-full")}>Role</TableHead>
            <TableHead className={TH}>Stage</TableHead>
            <TableHead className={cn(TH, SHOW.resume)}>Resume</TableHead>
            <TableHead className={cn(TH, SHOW.location)}>Location</TableHead>
            <TableHead className={cn(TH, SHOW.pay)}>Pay</TableHead>
            <TableHead className={cn(TH, SHOW.posting)}>Posting</TableHead>
            <SortHead sort="applied" query={query} className={SHOW.applied}>
              Applied
            </SortHead>
            <SortHead sort="match" query={query} className={SHOW.match}>
              Match
            </SortHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((app, i) => {
            return (
              // Fades in down the table on arrival (a row cannot rise: its
              // transform does not reliably paint), 25ms apart, and glides to
              // its new place when the sort or a filter moves it.
              <Reflow key={app.id}>
                <TableRow
                  className="hover:bg-hover animate-fade relative"
                  style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}
                >
                  {/* w-full with max-w-0 is the table idiom for "take what the
                    other columns leave, and truncate inside it": without
                    it a long role sets its own minimum width and the table
                    scrolls sideways inside the card. */}
                  <TableCell className="w-full max-w-0 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <ApplicationTile application={app} size="sm" />
                      <div className="min-w-0">
                        <Link
                          href={applicationHref(app.id)}
                          className="text-label text-ink hover:text-brand focus-visible:ring-brand-ring block truncate rounded-xs font-semibold transition-colors duration-150 after:absolute after:inset-0 focus-visible:ring-2 focus-visible:outline-none"
                        >
                          {app.role}
                        </Link>
                        <p className="text-note text-ink-meta truncate">{app.company}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="px-4">
                    <Badge tone={STAGE_COLOR[app.stage].tone}>{STAGE_LABEL[app.stage]}</Badge>
                  </TableCell>
                  {/* Capped and cut, with the whole name on hover: a resume
                      name is the student's own and can run long. */}
                  <TableCell className={cn(TD, SHOW.resume)}>
                    {app.resume ? (
                      <span className="text-ink block max-w-40 truncate" title={app.resume}>
                        {app.resume}
                      </span>
                    ) : (
                      "Not sent"
                    )}
                  </TableCell>
                  <TableCell className={cn(TD, SHOW.location)}>
                    {app.location ?? "Not listed"}
                  </TableCell>
                  <TableCell className={cn(TD, SHOW.pay)}>{app.pay ?? "Not listed"}</TableCell>
                  {/* Closed in ink, so the rare closed posting stands out
                      from a column of Open. */}
                  <TableCell className={cn(TD, SHOW.posting)}>
                    {app.open === false ? (
                      <span className="text-ink font-medium">Closed</span>
                    ) : (
                      "Open"
                    )}
                  </TableCell>
                  <TableCell className={cn(TD, SHOW.applied)}>
                    {app.appliedOn ? <LocalDate at={app.appliedOn} /> : "Not yet"}
                  </TableCell>
                  <TableCell className={cn("px-4", SHOW.match)}>
                    {app.match != null && <MatchBadge score={app.match} />}
                  </TableCell>
                </TableRow>
              </Reflow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
