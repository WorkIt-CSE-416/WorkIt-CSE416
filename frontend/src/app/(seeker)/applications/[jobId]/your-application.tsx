import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { cn } from "@/lib/cn";
import type { SentResume } from "@/lib/sent-resume-actions";

import type { JobListing } from "../../jobs/listings";
import { MatchRail } from "../../jobs/match-rail";
import { LocalDate } from "../../local-time";
import { STAGE_COLOR, STAGE_LABEL } from "../../stage-colors";
import { sortKey, type Application, type TimelineStep } from "../../tracker";
import { Timeline } from "../timeline";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The strip's columns from 448px of card, by how many counts it has: a
 *  literal class each, so Tailwind sees them. */
const COLUMNS: Record<number, string> = {
  1: "@md:grid-cols-1",
  2: "@md:grid-cols-2",
  3: "@md:grid-cols-3",
};

/** Days from `from` to `to`, rounded, never below 0. Counted in elapsed
 *  time, not calendar days, so the server needs no time zone to say it.
 *  Rounded rather than cut, as the header's "Posted 8 days ago" is: cut,
 *  an application sent 47 hours ago read as waiting 1 day. */
function daysBetween(from: string, to: string | Date) {
  const end = typeof to === "string" ? sortKey(to) : to.getTime();
  return Math.max(0, Math.round((end - sortKey(from)) / DAY_MS));
}

/**
 * The Your Application tab (KAN-256): one card, built as the Jobs page card
 * is (the status, the facts and the timeline on the left, the match rail
 * flush on the right, the day counts as a ruled strip along the foot), then
 * what the seeker sent, from what the API already keeps. No new
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
    stats.push({ label: "Days waiting to hear back", days: daysBetween(app.appliedOn, now) });
    stats.push({ label: "Days from save to apply", days: daysBetween(app.savedOn, app.appliedOn) });
    if (job?.posted_at) {
      stats.push({
        label: "Days posted before you applied",
        days: daysBetween(job.posted_at, app.appliedOn),
      });
    }
  } else {
    stats.push({ label: "Days since you saved it", days: daysBetween(app.savedOn, now) });
    if (job?.posted_at) {
      stats.push({ label: "Days since it was posted", days: daysBetween(job.posted_at, now) });
    }
  }
  const closed = app.open === false;

  return (
    <>
      {/* ONE CARD, built as the Jobs page card is: the body on the left, the
          match rail flush on the right edge (side by side from 576px of
          card, stacked under it), and the day counts as one ruled strip
          along the body's foot. It replaced three loose sections (facts, a
          floating match box, three stat boxes) that read as clutter. */}
      <Card
        as="section"
        padding="none"
        aria-label="Your Application"
        className="@container mt-6 overflow-hidden"
      >
        <div className="flex flex-col @xl:flex-row">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={STAGE_COLOR[app.stage].tone}>{STAGE_LABEL[app.stage]}</Badge>
                {closed && <Badge tone="inert">Posting Closed</Badge>}
              </div>
              <h2 className="text-title text-ink mt-3 font-bold">
                {app.appliedOn ? "Waiting to Hear Back" : "Not Applied Yet"}
              </h2>
              <p className="text-body text-ink-meta mt-1">
                {app.appliedOn ? (
                  <>
                    You applied on <LocalDate at={app.appliedOn} />
                  </>
                ) : (
                  <>
                    You saved it on <LocalDate at={app.savedOn} />
                  </>
                )}
                {" · "}
                {app.resume ? <>Sent {app.resume}</> : "No resume sent through WorkIt"}
              </p>

              <Timeline steps={timeline(app, sent)} horizontal className="mt-5" />
            </div>

            {/* The counts: a figure over its words, one column each, ruled
                apart, so they read as one row of numbers rather than boxes. */}
            <dl
              className={cn(
                "border-border-subtle divide-border-subtle mt-auto grid divide-y border-t @md:divide-x @md:divide-y-0",
                COLUMNS[stats.length],
              )}
            >
              {stats.map(({ label, days }) => (
                // The figure first to the eye, the words first to a screen
                // reader (a <dt> leads its <dd>).
                <div key={label} className="flex flex-col-reverse px-5 py-4">
                  <dt className="text-note text-ink-meta mt-0.5">{label}</dt>
                  <dd className="text-title text-ink font-bold tabular-nums">{days}</dd>
                </div>
              ))}
            </dl>
          </div>

          {app.match != null ? (
            <MatchRail score={app.match} highlights={app.highlights ?? []} />
          ) : null}
        </div>
      </Card>

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
