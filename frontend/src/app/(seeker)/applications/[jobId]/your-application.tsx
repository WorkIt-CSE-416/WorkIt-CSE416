import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import type { SentResume } from "@/lib/sent-resume-actions";

import type { JobListing } from "../../jobs/listings";
import { MatchRail } from "../../jobs/match-rail";
import { LocalDate } from "../../local-time";
import { STAGE_COLOR, STAGE_LABEL } from "../../stage-colors";
import { sortKey, type Application, type TimelineStep } from "../../tracker";
import { Timeline } from "../timeline";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days from `from` to `to`, rounded, never below 0. Counted in elapsed
 *  time, not calendar days, so the server needs no time zone to say it.
 *  Rounded rather than cut, as the header's "Posted 8 days ago" is: cut,
 *  an application sent 47 hours ago read as waiting 1 day. */
function daysBetween(from: string, to: string | Date) {
  const end = typeof to === "string" ? sortKey(to) : to.getTime();
  return Math.max(0, Math.round((end - sortKey(from)) / DAY_MS));
}

/**
 * The Your Application tab (KAN-256): At a Glance (the timeline across the
 * top with the stage, posting and resume under it, and the match in its own
 * card on the right), how long each step
 * took, and what the seeker sent, from what the API already keeps. No new
 * table: the stage and its dates are the application's row, the resumes are
 * the sent resumes linked to the job posting.
 *
 * WHAT IS NOT KEPT, SAID PLAINLY. Neither the Apply flow nor auto apply
 * stores the answers typed into the employer's form, so the tab says so
 * rather than leaving the seeker to wonder where they went.
 *
 * THE NUMBERS ARE ELAPSED DAYS, worked out on the server against the
 * request's time (`getNow`): how long the posting was up before the seeker
 * applied, how long from saving to applying, and how long they have been
 * waiting. Each shows only when both its dates exist.
 */
export function YourApplication({
  app,
  job,
  sent,
  now,
}: {
  app: Application;
  job: JobListing | null;
  /** The sent resumes linked to this job posting, newest first. */
  sent: SentResume[];
  now: Date;
}) {
  const stats: { label: string; days: number }[] = [];
  if (app.appliedOn) {
    stats.push({ label: "Days Waiting to Hear Back", days: daysBetween(app.appliedOn, now) });
    stats.push({ label: "Days From Save to Apply", days: daysBetween(app.savedOn, app.appliedOn) });
    if (job?.posted_at) {
      stats.push({
        label: "Days Posted Before You Applied",
        days: daysBetween(job.posted_at, app.appliedOn),
      });
    }
  } else {
    stats.push({ label: "Days Since You Saved It", days: daysBetween(app.savedOn, now) });
    if (job?.posted_at) {
      stats.push({ label: "Days Since It Was Posted", days: daysBetween(job.posted_at, now) });
    }
  }

  return (
    <>
      {/* The timeline across the top, then the facts in one row under it:
          one block, so where the application stands and how it got there
          read together. The dates live on the timeline, not in the facts. */}
      <Section title="At a Glance">
        {/* The timeline and the facts on the left, the match in a card of its
            own on the right, so the score stands out: the Jobs page card's
            rail, with the same reasons. Under the page's 672px they stack. */}
        <div className="mt-4 flex flex-col gap-5 @2xl/main:flex-row @2xl/main:items-start">
          <div className="min-w-0 flex-1">
            <Timeline steps={timeline(app, sent)} horizontal />
            <dl className="border-border-subtle mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-4 @xl/main:grid-cols-3">
              <Glance label="Stage">
                <Badge tone={STAGE_COLOR[app.stage].tone}>{STAGE_LABEL[app.stage]}</Badge>
              </Glance>
              <Glance label="Posting">{app.open === false ? "Closed" : "Open"}</Glance>
              <Glance label="Resume Sent">{app.resume ?? "Not sent"}</Glance>
              {/* No card without a score: the rail's placeholder says
                  "Score Coming Soon", which an empty bank is not. */}
              {app.match == null && <Glance label="Match">Not scored</Glance>}
            </dl>
          </div>
          {app.match != null && (
            <div className="shrink-0 @2xl/main:w-56">
              <MatchRail score={app.match} highlights={app.highlights ?? []} standalone />
            </div>
          )}
        </div>
      </Section>

      <Section title="Timing">
        <ul className="mt-3 grid gap-3 @xl/main:grid-cols-3">
          {stats.map(({ label, days }) => (
            <Card as="li" key={label} padding="sm" elevated={false}>
              <p className="text-heading text-ink tabular-nums">{days}</p>
              <p className="text-note text-ink-meta mt-1">{label}</p>
            </Card>
          ))}
        </ul>
      </Section>

      <Section title="What You Sent">
        {sent.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2">
            {sent.map((resume) => (
              <li key={resume.id} className="text-body text-ink flex flex-wrap items-center gap-2">
                <span className="font-medium">{resume.name}</span>
                <Badge tone="inert">{resume.format.toUpperCase()}</Badge>
                <span className="text-note text-ink-meta">
                  Sent <LocalDate at={resume.created_at} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-ink-meta mt-3">
            No resume went to this posting through WorkIt. Apply Now and auto apply keep the one
            they send.
          </p>
        )}
        <p className="text-note text-ink-meta mt-3">
          WorkIt doesn&apos;t keep the answers typed into the employer&apos;s form yet.
        </p>
      </Section>
    </>
  );
}

function Glance({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-note text-ink-meta">{label}</dt>
      <dd className="text-body text-ink mt-1 truncate">{children}</dd>
    </div>
  );
}

/** Saved, each resume sent, then applied, oldest first. All behind it: the
 *  tracker stores nothing still to come (../../tracker.ts). A sent resume
 *  wears Applied's violet, as the applied date does. */
function timeline(app: Application, sent: SentResume[]): TimelineStep[] {
  const steps: TimelineStep[] = [
    { id: "saved", kind: "saved", title: "Saved", at: app.savedOn, state: "done" },
    ...sent.map((resume) => ({
      id: resume.id,
      kind: "applied" as const,
      title: `Sent ${resume.name}`,
      at: resume.created_at,
      state: "done" as const,
    })),
  ];
  if (app.appliedOn) {
    steps.push({
      id: "applied",
      kind: "applied",
      title: "Applied",
      at: app.appliedOn,
      state: "done",
    });
  }
  return steps.sort((a, b) => sortKey(a.at) - sortKey(b.at));
}
