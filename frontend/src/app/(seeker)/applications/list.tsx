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
import { CompanyTile } from "@/components/ui/company-tile";
import { cn } from "@/lib/cn";

import { STAGE_COLOR, STAGE_LABEL } from "../stage-colors";
import { nextEvent, shortDay, type Application } from "../tracker";
import { MatchBadge } from "./match-badge";
import { NextStep } from "./next-step";
import { applicationsHref, sortApplications, type ApplicationsQuery, type Sort } from "./query";

/**
 * The applications as a table: role and company, stage, next step, the day it
 * went in, and the match, one row each.
 *
 * It was a stack of cards holding the grid card's fields, marked in the code
 * as a placeholder. A table is what a list of like records wants: columns a
 * reader can scan down, and headings that sort. Its frame follows the company
 * Dashboard's Recent Applicants (company/applicants-preview.tsx): one white
 * card, 12px grey headings, rules between rows and no box around each.
 *
 * SORTING IS A LINK, ?sort=, like every other choice on this page, so the
 * table stays a server component and an order can be shared. Three columns
 * sort, each the way it is read: Next Step soonest first, Applied latest
 * first, Match best first. Role and stage do not; the stage filter above the
 * table is how a stage is picked out. The heading in force says so in
 * aria-sort as well as in its chevron.
 *
 * Columns drop out as the page narrows (the page's own width, @container/main,
 * not the window's) rather than the table scrolling sideways: Match first,
 * then Applied, then the next step, keeping role and stage, the two things a
 * phone still needs. A row opens its application's detail panel; the role is
 * the link, stretched across the row.
 */
const TH = "px-4 text-note text-ink-meta font-medium";

/** Which way each sortable column runs, for aria-sort and the chevron. */
const DIRECTION: Record<Sort, "asc" | "desc"> = { next: "asc", applied: "desc", match: "desc" };

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
        className="hover:text-ink focus-visible:ring-brand-ring inline-flex items-center gap-1 rounded-xs focus-visible:ring-2 focus-visible:outline-none"
      >
        {children}
        <SortIcon
          className={cn("size-3.5 shrink-0", active ? "text-brand" : "text-ink-faint")}
          direction={active ? direction : undefined}
        />
      </Link>
    </TableHead>
  );
}

export function ApplicationsList({
  applications,
  query,
  now,
}: {
  applications: Application[];
  query: ApplicationsQuery;
  now: Date;
}) {
  const rows = sortApplications(applications, query.sort, now);

  return (
    <Card padding="none" className="mt-4 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(TH, "w-full")}>Role</TableHead>
            <TableHead className={TH}>Stage</TableHead>
            <SortHead sort="next" query={query} className="hidden @lg/main:table-cell">
              Next Step
            </SortHead>
            <SortHead sort="applied" query={query} className="hidden @2xl/main:table-cell">
              Applied
            </SortHead>
            <SortHead sort="match" query={query} className="hidden @3xl/main:table-cell">
              Match
            </SortHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((app) => {
            const { Icon } = app;

            return (
              <TableRow key={app.id} className="hover:bg-hover relative">
                {/* w-full with max-w-0 is the table idiom for "take what the
                    other columns leave, and truncate inside it": without
                    it a long role sets its own minimum width and the table
                    scrolls sideways inside the card. */}
                <TableCell className="w-full max-w-0 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <CompanyTile Icon={Icon} size="sm" tone="outline" />
                    <div className="min-w-0">
                      <Link
                        href={applicationsHref(query, { app: app.id })}
                        scroll={false}
                        className="text-label text-ink hover:text-brand focus-visible:ring-brand-ring block truncate rounded-xs font-semibold after:absolute after:inset-0 focus-visible:ring-2 focus-visible:outline-none"
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
                <TableCell className="hidden px-4 @lg/main:table-cell">
                  <NextStep next={nextEvent(app, now)} truncate className="w-48" />
                </TableCell>
                <TableCell className="text-note text-ink-meta hidden px-4 @2xl/main:table-cell">
                  {app.appliedOn ? shortDay(app.appliedOn) : "Not yet"}
                </TableCell>
                <TableCell className="hidden px-4 @3xl/main:table-cell">
                  <MatchBadge score={app.match} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
