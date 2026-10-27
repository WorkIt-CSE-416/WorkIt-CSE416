"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { CompanyLogo } from "@/components/company-logo";
import { MailIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SegmentedToggle } from "@/components/ui/segmented-control";
import { SelectField } from "@/components/ui/select-field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

import { When } from "../local-time";
import { STAGE_LABEL, type StageKey } from "../stage-colors";
import { acceptUpdate, dismissUpdate } from "./actions";
import type { Update } from "./tracked";

/**
 * The Updates strip (KAN-413, docs/email_tracker.md, "Where it lives"): what
 * the email tracker read from Gmail, waiting for the student, at the top of
 * the Applications Tracker. It shows only while something waits, so it never
 * takes room for nothing.
 *
 * TWO TABS. Updates are emails matched to an application, each with its
 * Accept (named for what it does: Move to Interviewing, or Add to Timeline
 * when the stage would not move), Not Right and Wrong Job?. Couldn't Match
 * holds the ones that matched none: Link to an Application or Dismiss.
 * Accepting goes through the API, which moves the stage forward only, as
 * Add Event does; this file only names the button. Every decision refreshes
 * the page, so the list, the badge and the application's page agree.
 */

/** The application a card names, as the tracker already holds it. */
export type UpdateTarget = {
  id: string;
  role: string;
  company: string;
  logoUrl: string | null;
  stage: StageKey;
};

/** What each kind of email is, on its card. */
const KIND_NAME: Record<Update["source"], string> = {
  interview: "Interview",
  assessment: "Assessment",
  offer: "Offer",
  rejection: "Rejection",
  confirmation: "Application Received",
  other: "Update",
};

/** The stage each kind moves an application to; the rest move none. */
const MOVES_TO: Partial<Record<Update["source"], StageKey>> = {
  interview: "interviewing",
  offer: "offer",
  rejection: "rejected",
};

/** How far along each stage is, as the API's `advance` ranks them. */
const RANK: Record<StageKey, number> = {
  saved: 0,
  applied: 1,
  interviewing: 2,
  offer: 3,
  rejected: 4,
};

/** Accept's words: the move it makes, or Add to Timeline when the
 *  application is already as far along or further. */
function acceptLabel(update: Update, stage: StageKey | undefined) {
  const target = MOVES_TO[update.source];
  return target && (stage == null || RANK[target] > RANK[stage])
    ? `Move to ${STAGE_LABEL[target]}`
    : "Add to Timeline";
}

export function UpdatesStrip({
  updates,
  applications,
}: {
  updates: Update[];
  applications: UpdateTarget[];
}) {
  const matched = updates.filter((u) => u.jobId != null);
  const unmatched = updates.filter((u) => u.jobId == null);
  const [tab, setTab] = useState(matched.length > 0 ? "matched" : "unmatched");
  const byId = new Map(applications.map((app) => [app.id, app]));
  const shown = tab === "matched" ? matched : unmatched;

  if (updates.length === 0) return null;

  return (
    <Card as="section" padding="md" aria-label="Updates" className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-subtitle text-ink flex items-center gap-2 font-semibold">
          <MailIcon className="text-ink-meta size-5" />
          Updates From Your Email
        </h2>
        <SegmentedToggle
          label="Updates"
          value={tab}
          onValueChange={setTab}
          options={[
            { value: "matched", label: `Updates (${matched.length})` },
            { value: "unmatched", label: `Couldn't Match (${unmatched.length})` },
          ]}
        />
      </div>
      {shown.length > 0 ? (
        <ul className="divide-border-subtle mt-3 divide-y">
          {shown.map((update) => (
            <UpdateCard
              key={update.id}
              update={update}
              target={update.jobId ? byId.get(update.jobId) : undefined}
              applications={applications}
            />
          ))}
        </ul>
      ) : (
        <p className="text-body text-ink-meta mt-3">
          {tab === "matched" ? "No updates waiting." : "Every email matched an application."}
        </p>
      )}
    </Card>
  );
}

function UpdateCard({
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
  // Wrong Job? (or Couldn't Match) opens the picker in place of the buttons.
  const [picking, setPicking] = useState(target == null);
  const [pick, setPick] = useState("");
  const picked = applications.find((app) => app.id === pick);

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
    <li
      className={cn("flex flex-col gap-3 py-4 sm:flex-row sm:items-start", pending && "opacity-50")}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {target ? (
          <CompanyLogo
            name={target.company}
            src={target.logoUrl}
            className="text-label rounded-control size-10 shrink-0"
          />
        ) : (
          <span className="bg-well rounded-control flex size-10 shrink-0 items-center justify-center">
            <MailIcon className="text-ink-meta size-5" />
          </span>
        )}
        <div className="min-w-0">
          <p className="text-label text-ink font-semibold">
            {target ? `${target.company} · ${target.role}` : update.title}
          </p>
          <p className="text-note text-ink-meta">
            {KIND_NAME[update.source]}
            {update.at && (
              <>
                {" · "}
                <When at={update.at} />
              </>
            )}
          </p>
          {target && <p className="text-body text-ink-muted mt-1 truncate">{update.title}</p>}
          {update.note && <p className="text-body text-ink-muted mt-1">{update.note}</p>}
        </div>
      </div>

      {picking ? (
        <div className="flex flex-wrap items-end gap-2">
          <SelectField
            id={`pick-${update.id}`}
            label="Application"
            hideLabel
            placeholder="Pick an Application"
            value={pick}
            onValueChange={setPick}
            options={applications.map((app) => ({
              value: app.id,
              label: `${app.company} · ${app.role}`,
            }))}
            className="w-64"
          />
          <Button
            size="sm"
            disabled={!pick || pending}
            onClick={() => decide(() => acceptUpdate(update.id, pick), "Couldn't add the update.")}
          >
            {acceptLabel(update, picked?.stage)}
          </Button>
          {target ? (
            <Button variant="secondary" size="sm" onClick={() => setPicking(false)}>
              Cancel
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => decide(() => dismissUpdate(update.id), "Couldn't dismiss it.")}
            >
              Dismiss
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() => decide(() => acceptUpdate(update.id, null), "Couldn't add the update.")}
          >
            {acceptLabel(update, target?.stage)}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => decide(() => dismissUpdate(update.id), "Couldn't dismiss it.")}
          >
            Not Right
          </Button>
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => setPicking(true)}>
            Wrong Job?
          </Button>
        </div>
      )}
    </li>
  );
}
