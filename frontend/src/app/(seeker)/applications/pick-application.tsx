"use client";

import { useState } from "react";

import { CompanyLogo } from "@/components/company-logo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { SearchField } from "@/components/ui/search-field";

import { STAGE_COLOR, STAGE_LABEL } from "../stage-colors";
import type { Application } from "../tracker";

/** What a row of the modal reads of an application. */
export type PickableApplication = Pick<
  Application,
  "id" | "role" | "company" | "logoUrl" | "stage" | "appliedOn"
>;

const APPLIED = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** The Applications list's head and fact cells (../applications/list.tsx). */
const TH = "px-4 text-note text-ink-meta font-medium";
const TD = "px-4 text-note text-ink";

/**
 * CHOOSE APPLICATION, THE ONE WAY TO PICK AN APPLICATION (KAN-427,
 * KAN-429): a view of the Applications Tracker in a modal, never a
 * dropdown of "Company · Role" lines, which hid where each application
 * stood and cut long titles short. The Inbox opens it for an email that
 * matched no application, and Create Event for the application an event is
 * on (./create-event.tsx); a new place that picks an application opens it
 * too, as every resume pick opens `ResumeLists` (../jobs/resume-picker.tsx). The same rows the Tracker's list draws (the company's logo over
 * the role and company, the stage's pill, the day it went in), the latest
 * sent first and saved jobs last, with a search over role and company.
 *
 * A row's click picks it and closes the modal; the caller saves (the
 * Inbox's status banner's Confirm, ../inbox/reading-pane.tsx).
 *
 * NEVER A MODAL OVER A MODAL. Where the pick is part of a dialog already
 * open (Create Event), that dialog shows `ApplicationTable` as a step of
 * its own instead of opening this one over it: two stacked dialogs read as
 * a second page with no way back but its own close. Each row is a button, so the keyboard picks one
 * the same way. The dialog only opens after a click, so the applied day is
 * the viewer's own clock with no server text to match.
 */
export function PickApplication({
  open,
  jobs,
  picked,
  description,
  onPick,
  onClose,
}: {
  open: boolean;
  jobs: PickableApplication[];
  /** What the pick is for: "Pick the application this email is about." */
  description: string;
  picked: string;
  onPick: (jobId: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-subtitle font-semibold">Choose Application</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <ApplicationTable jobs={jobs} picked={picked} onPick={onPick} />
      </DialogContent>
    </Dialog>
  );
}

/** The modal's body, for a dialog that holds the pick as a step of its own
 *  (./create-event.tsx): the search over role and company, then the
 *  Tracker's rows, latest sent first. */
export function ApplicationTable({
  jobs,
  picked,
  onPick,
}: {
  jobs: PickableApplication[];
  picked: string;
  onPick: (jobId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase();
  const shown = jobs
    .filter((job) => !words || `${job.role} ${job.company}`.toLowerCase().includes(words))
    .sort((a, b) => (b.appliedOn ?? "").localeCompare(a.appliedOn ?? ""));

  return (
    <>
      <SearchField
        id="pick-application-search"
        label="Search applications"
        placeholder="Search by role or company"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="border-border-subtle rounded-card min-h-0 flex-1 overflow-y-auto border">
        {shown.length === 0 ? (
          <p className="text-body text-ink-meta p-6">No applications match.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={TH}>Role</TableHead>
                <TableHead className={TH}>Status</TableHead>
                <TableHead className={TH}>Applied</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((job) => (
                <TableRow
                  key={job.id}
                  aria-selected={job.id === picked}
                  className="hover:bg-hover aria-selected:bg-brand-tint cursor-pointer"
                  onClick={() => onPick(job.id)}
                >
                  <TableCell className={`${TD} max-w-0 py-3`}>
                    <div className="flex min-w-0 items-center gap-3">
                      <CompanyLogo
                        name={job.company}
                        src={job.logoUrl}
                        className="text-meta size-9 shrink-0 rounded-full"
                      />
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onPick(job.id);
                          }}
                          className="text-label text-ink hover:text-brand focus-visible:ring-brand-ring block max-w-full truncate rounded-xs text-left font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                        >
                          {job.role}
                        </button>
                        <p className="text-note text-ink-meta truncate">{job.company}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className={`${TD} w-32`}>
                    <Badge tone={STAGE_COLOR[job.stage].tone}>{STAGE_LABEL[job.stage]}</Badge>
                  </TableCell>
                  <TableCell className={`${TD} w-24 whitespace-nowrap`}>
                    {job.appliedOn ? (
                      <time dateTime={job.appliedOn}>
                        {APPLIED.format(new Date(job.appliedOn))}
                      </time>
                    ) : (
                      <span className="text-ink-meta">Not yet</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
