"use client";

import Link from "next/link";

import { ClickableRow } from "@/components/clickable-row";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/table";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";

import { ApplicationTile } from "../applications/application-tile";
import { applicationHref } from "../applications/query";
import { STAGE_COLOR, STAGE_LABEL } from "../stage-colors";
import type { AppliedApplication } from "./data";

const DAY_LONG = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

/** The Applications list's head and fact cells (../applications/list.tsx). */
const TH = "px-4 text-note text-ink-meta font-medium";
const TD = "px-4 text-note text-ink";

/**
 * One day of Activity, opened from a filled day (KAN-423): the applications
 * sent that day in a table, earliest first, as the Applications list draws
 * them: the company tile over the role and company, the time it went in,
 * and its stage's badge now. A row opens that application's own page, and
 * View All Applications the whole list, for anything the table leaves out.
 *
 * `date` is the viewer's own day, "2026-10-27", the day the streak counted
 * them on (./streak.tsx), so `applications` arrive already picked for it.
 * It stays set while the dialog closes, so the dialog keeps its words as it
 * fades out.
 * The dialog only ever opens after a click, in the browser, so the time is
 * the viewer's clock with no server text to match.
 */
export function DayApplications({
  date,
  open,
  applications,
  onClose,
}: {
  date: string;
  open: boolean;
  applications: AppliedApplication[];
  onClose: () => void;
}) {
  const count = applications.length;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-subtitle font-semibold">
            {DAY_LONG.format(Date.parse(date))}
          </DialogTitle>
          <DialogDescription>
            You sent {count} {count === 1 ? "application" : "applications"} on this day.
          </DialogDescription>
        </DialogHeader>

        <div className="border-border-subtle rounded-card overflow-hidden border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={TH}>Role</TableHead>
                <TableHead className={TH}>Applied</TableHead>
                <TableHead className={TH}>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {applications.map((app) => (
                <ClickableRow
                  key={app.id}
                  href={applicationHref(app.id)}
                  className="hover:bg-hover"
                >
                  <TableCell className={`${TD} max-w-0 py-3`}>
                    <div className="flex min-w-0 items-center gap-3">
                      <ApplicationTile application={app} size="sm" />
                      <div className="min-w-0">
                        <Link
                          href={applicationHref(app.id)}
                          title={app.role}
                          className="text-label text-ink hover:text-brand focus-visible:ring-brand-ring block truncate rounded-xs font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                        >
                          {app.role}
                        </Link>
                        <p className="text-note text-ink-meta truncate" title={app.company}>
                          {app.company}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className={`${TD} w-24 whitespace-nowrap`}>
                    <time dateTime={app.appliedOn}>{TIME.format(new Date(app.appliedOn))}</time>
                  </TableCell>
                  <TableCell className={`${TD} w-32`}>
                    <Badge tone={STAGE_COLOR[app.stage].tone}>{STAGE_LABEL[app.stage]}</Badge>
                  </TableCell>
                </ClickableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <ButtonLink href="/applications" variant="secondary" size="sm">
            View All Applications
          </ButtonLink>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
