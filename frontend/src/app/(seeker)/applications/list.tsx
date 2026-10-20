import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

import {
  BriefcaseIcon,
  CalendarIcon,
  CoinIcon,
  ExternalLinkIcon,
  FileIcon,
  PencilIcon,
  PinIcon,
  SortIcon,
  workStyleIcon,
} from "@/components/icons";
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
import { Fact } from "@/components/ui/fact";
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
 * The applications as a table, one row each, in the order a tracking sheet
 * reads (KAN-256): Date Applied, Company, Role, Track (the job type), Location,
 * Work Model, Pay Range, Source (the hiring system its posting is on),
 * Status, then the extras WorkIt adds: Match, the Resume sent, whether the
 * Posting is still open, and Notes / Next Step. Company and Role are their own
 * columns, since a seeker applies to several roles at one company.
 *
 * Notes / Next Step is a placeholder for now: nothing stores notes yet, and
 * Status can only be Saved or Applied until the API keeps later stages.
 *
 * It was a stack of cards holding the grid card's fields, marked in the code
 * as a placeholder. A table is what a list of like records wants: columns a
 * reader can scan down, and headings that sort. Its frame follows the company
 * Dashboard's Recent Applicants (company/applicants-preview.tsx): one white
 * card, 12px grey headings, rules between rows and no box around each.
 *
 * SORTING IS A LINK, ?sort=, like every other choice on this page, so the
 * table stays a server component and an order can be shared. Two columns
 * sort, each the way it is read: Date Applied latest first, Match best
 * first. The rest do not; the stage filter above the table is how a stage is
 * picked out. The heading in force says so in aria-sort as well as in its
 * chevron.
 *
 * IT SCROLLS SIDEWAYS, as a Notion table does, rather than dropping columns:
 * every column keeps its width and never wraps (shadcn's cell is nowrap), and
 * the card is the scroll port. The role is capped and cut, with the whole
 * title on hover. A row opens its application's own page (./[jobId]); the
 * role is the link, stretched across the row.
 */
const TH = "px-4 text-note text-ink-meta font-medium";
/** A plain fact cell: one line of note text in ink, as easy to read as the
 *  role; it was grey, which read as disabled (KAN-256). */
const TD = "px-4 text-note text-ink";

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

/** A fact cell's value, or its missing word a step greyer. */
function FactCell({
  Icon,
  value,
  missing,
  title,
  className,
}: {
  Icon: ComponentType<{ className?: string }>;
  value: ReactNode;
  missing: string;
  title?: string;
  className?: string;
}) {
  const has = value != null && value !== "";
  return (
    <TableCell className={TD}>
      <Fact Icon={Icon} title={title} className={cn(className, !has && "text-ink-meta")}>
        {has ? value : missing}
      </Fact>
    </TableCell>
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
            <SortHead sort="applied" query={query}>
              Date Applied
            </SortHead>
            <TableHead className={TH}>Company</TableHead>
            <TableHead className={TH}>Role</TableHead>
            <TableHead className={TH}>Track</TableHead>
            <TableHead className={TH}>Location</TableHead>
            <TableHead className={TH}>Work Model</TableHead>
            <TableHead className={TH}>Pay Range</TableHead>
            <TableHead className={TH}>Source</TableHead>
            <TableHead className={TH}>Status</TableHead>
            <SortHead sort="match" query={query}>
              Match
            </SortHead>
            <TableHead className={TH}>Resume</TableHead>
            <TableHead className={TH}>Posting</TableHead>
            <TableHead className={TH}>Notes / Next Step</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((app, i) => (
            // Fades in down the table on arrival (a row cannot rise: its
            // transform does not reliably paint), 25ms apart, and glides to
            // its new place when the sort or a filter moves it.
            <Reflow key={app.id}>
              <TableRow
                className="hover:bg-hover animate-fade relative"
                style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}
              >
                <FactCell
                  Icon={CalendarIcon}
                  value={app.appliedOn ? <LocalDate at={app.appliedOn} /> : null}
                  missing="Not yet"
                />
                <TableCell className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <ApplicationTile application={app} size="sm" />
                    <span
                      className="text-label text-ink max-w-40 truncate font-medium"
                      title={app.company}
                    >
                      {app.company}
                    </span>
                  </div>
                </TableCell>
                {/* Capped and cut, the whole title on hover: scraped titles
                    run long ("... 2027 in Eurasburg / Bavaria"). */}
                <TableCell className="px-4">
                  <Link
                    href={applicationHref(app.id)}
                    title={app.role}
                    className="text-label text-ink hover:text-brand focus-visible:ring-brand-ring block max-w-72 truncate rounded-xs font-semibold transition-colors duration-150 after:absolute after:inset-0 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {app.role}
                  </Link>
                </TableCell>
                <FactCell Icon={BriefcaseIcon} value={app.track} missing="Not listed" />
                <FactCell Icon={PinIcon} value={app.location} missing="Not listed" />
                <FactCell
                  Icon={workStyleIcon(app.workModel ?? null)}
                  value={app.workModel}
                  missing="Not listed"
                />
                <FactCell Icon={CoinIcon} value={app.pay} missing="Not listed" />
                <FactCell Icon={ExternalLinkIcon} value={app.source} missing="Unknown" />
                <TableCell className="px-4">
                  <Badge tone={STAGE_COLOR[app.stage].tone}>{STAGE_LABEL[app.stage]}</Badge>
                </TableCell>
                <TableCell className="px-4">
                  {app.match != null ? (
                    <MatchBadge score={app.match} />
                  ) : (
                    <span className="text-note text-ink-meta">Not scored</span>
                  )}
                </TableCell>
                <FactCell
                  Icon={FileIcon}
                  value={app.resume}
                  missing="Not sent"
                  title={app.resume ?? undefined}
                  className="max-w-44"
                />
                {/* A pill: positive is the badge's tone for a live posting,
                    inert for one that is over. */}
                <TableCell className="px-4">
                  {app.open === false ? (
                    <Badge tone="inert">Closed</Badge>
                  ) : (
                    <Badge tone="positive">Open</Badge>
                  )}
                </TableCell>
                {/* A placeholder until notes are stored. */}
                <FactCell Icon={PencilIcon} value={null} missing="No notes yet" />
              </TableRow>
            </Reflow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
