"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { CompanyLogo } from "@/components/company-logo";
import { CloseIcon } from "@/components/icons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { SectionHeading } from "@/components/ui/section-heading";
import { SelectField } from "@/components/ui/select-field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

import { When } from "../local-time";
import type { StageKey } from "../stage-colors";
import { acceptUpdate, dismissUpdate } from "./actions";
import { acceptEffect, EmailKindPill } from "./email-kinds";
import type { Update } from "./tracked";

/**
 * Email Updates (KAN-413, docs/email_tracker.md, "Where it lives"): what the
 * email tracker read from Gmail, waiting for the student, as a table at the
 * top of the Applications Tracker, framed as Auto Apply's Live Activity
 * table is. It shows only while an email waits.
 *
 * ONE ROW PER EMAIL, TWO ACTIONS. Each row names the job, the email (its
 * subject and summary), its kind as a pill with what accepting does under
 * it ("Moves to Interviewing"), and the date it names. Accept puts it on
 * the application (the API moves the stage forward only, as Add Event
 * does); the cross dismisses it. An email that matched no application shows
 * a job picker in its Job cell, and Accept waits for a pick. A first
 * version was a card per email with Move to Interviewing, Not Right and
 * Wrong Job?; the user found the buttons confusing and asked for a table
 * with pills. Every decision refreshes the page, so the list and the
 * application's Emails agree.
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
const TD = "text-note text-ink px-4 py-3 align-top";

export function UpdatesTable({
  updates,
  applications,
}: {
  updates: Update[];
  applications: UpdateTarget[];
}) {
  if (updates.length === 0) return null;
  const byId = new Map(applications.map((app) => [app.id, app]));

  return (
    <section aria-labelledby="email-updates" className="mt-6">
      <SectionHeading id="email-updates">Email Updates ({updates.length})</SectionHeading>
      <p className="text-meta text-ink-meta mt-1">
        Replies about your applications. Accept one to add it to its application.
      </p>
      <Card padding="none" className="mt-3 overflow-x-auto">
        <Table className="min-w-[48rem] table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn(TH, "w-[30%]")}>Job</TableHead>
              <TableHead className={cn(TH, "w-[32%]")}>Email</TableHead>
              <TableHead className={cn(TH, "w-[18%]")}>Type</TableHead>
              <TableHead className={cn(TH, "w-[12%]")}>Date</TableHead>
              <TableHead className={cn(TH, "w-[8rem]")}>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {updates.map((update) => (
              <UpdateRow
                key={update.id}
                update={update}
                target={update.jobId ? byId.get(update.jobId) : undefined}
                applications={applications}
              />
            ))}
          </TableBody>
        </Table>
      </Card>
    </section>
  );
}

function UpdateRow({
  update,
  target,
  applications,
}: {
  update: Update;
  target: UpdateTarget | undefined;
  applications: UpdateTarget[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  // An email that matched no application waits for a pick.
  const [pick, setPick] = useState("");
  const job = target ?? applications.find((app) => app.id === pick);

  function decide(run: () => Promise<{ error: string | null }>, failed: string) {
    start(async () => {
      const { error } = await run();
      if (error) {
        toast.show({ message: `${failed} ${error}` });
        return;
      }
      router.refresh();
    });
  }

  return (
    <TableRow className={cn("hover:bg-transparent", pending && "opacity-50")}>
      <TableCell className={TD}>
        {target ? (
          <div className="flex min-w-0 items-center gap-3">
            <CompanyLogo
              name={target.company}
              src={target.logoUrl}
              className="text-meta size-8 shrink-0 rounded"
            />
            <div className="min-w-0">
              <p className="text-label text-ink truncate font-semibold" title={target.role}>
                {target.role}
              </p>
              <p className="text-note text-ink-meta truncate">{target.company}</p>
            </div>
          </div>
        ) : (
          <SelectField
            id={`pick-${update.id}`}
            label="Job"
            hideLabel
            placeholder="Pick a Job"
            value={pick}
            onValueChange={setPick}
            options={applications.map((app) => ({
              value: app.id,
              label: `${app.company} · ${app.role}`,
            }))}
          />
        )}
      </TableCell>
      <TableCell className={TD}>
        <p className="text-label text-ink truncate font-semibold" title={update.title}>
          {update.title}
        </p>
        {update.note && (
          <p className="text-note text-ink-meta line-clamp-2" title={update.note}>
            {update.note}
          </p>
        )}
      </TableCell>
      <TableCell className={TD}>
        <EmailKindPill kind={update.emailKind} />
        <p className="text-note text-ink-meta mt-1">{acceptEffect(update.emailKind, job?.stage)}</p>
      </TableCell>
      <TableCell className={cn(TD, !update.at && "text-ink-meta")}>
        {update.at ? <When at={update.at} /> : "None"}
      </TableCell>
      <TableCell className={TD}>
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            disabled={pending || !job}
            onClick={() =>
              decide(() => acceptUpdate(update.id, target ? null : pick), "Couldn't add the email.")
            }
          >
            Accept
          </Button>
          <IconButton
            label={`Dismiss ${update.title}`}
            tooltip="Dismiss"
            disabled={pending}
            onClick={() => decide(() => dismissUpdate(update.id), "Couldn't dismiss it.")}
          >
            <CloseIcon className="size-4" />
          </IconButton>
        </div>
      </TableCell>
    </TableRow>
  );
}
