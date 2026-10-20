import { FileIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { cn } from "@/lib/cn";
import type { SentResume } from "@/lib/sent-resume-actions";

import type { JobListing } from "../../jobs/listings";
import { MatchRail } from "../../jobs/match-rail";
import { LocalDate } from "../../local-time";
import { STAGE_COLOR, STAGE_ICON, STAGE_LABEL } from "../../stage-colors";
import { sortKey, type Application, type TimelineStep } from "../../tracker";
import { Timeline } from "../timeline";
import { ViewResumeButton } from "../view-resume";

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
  const StageIcon = STAGE_ICON[app.stage];

  return (
    <>
      {/* ONE TINTED CARD for the seeker's record, holding rounded white
          boxes: the status and timeline on the left with the day counts
          under them, one box each, and the match in a box of its own on the
          right (side by side from 576px of card, stacked under it). The
          boxes are the app's rounded cards on white, so the figures stand
          off the tint; ruled, square cells read as a spreadsheet. It
          replaced three loose sections that read as clutter.

          TINTED BY ITS STAGE (the board column's panel: violet for Applied,
          grey for Saved), so it reads as the seeker's record, not a second
          white card under the job's own header. */}
      <Card
        as="section"
        padding="lg"
        aria-label="Your Application"
        className={cn("@container mt-6", STAGE_COLOR[app.stage].panel)}
      >
        {/* Stretched, not top-aligned: the match box runs the full height of the
            left side, so it never stops short and leaves an empty corner. */}
        <div className="flex flex-col gap-4 @xl:flex-row">
          <div className="min-w-0 flex-1">
            {/* The stage as the board's column headers drew it: its glyph on
                a solid disc, then its name. A badge's fill is the card's own
                tint, so a badge vanished into it. */}
            <div className="flex flex-wrap items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-white",
                  STAGE_COLOR[app.stage].fill,
                )}
              >
                <StageIcon className="size-3.5" />
              </span>
              <span className={cn("text-label font-semibold", STAGE_COLOR[app.stage].onTint)}>
                {STAGE_LABEL[app.stage]}
              </span>
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

            {/* The counts: a figure over its words, a rounded white box
                each. justify-end puts the figure at the top (the column is
                reversed), so the figures line up when one label wraps. */}
            <dl className={cn("mt-5 grid gap-3", COLUMNS[stats.length])}>
              {stats.map(({ label, days }) => (
                // The figure first to the eye, the words first to a screen
                // reader (a <dt> leads its <dd>).
                <Card
                  key={label}
                  padding="md"
                  elevated={false}
                  className="flex flex-col-reverse justify-end"
                >
                  <dt className="text-note text-ink-meta mt-0.5">{label}</dt>
                  <dd className="text-title text-ink font-bold tabular-nums">{days}</dd>
                </Card>
              ))}
            </dl>
          </div>

          {app.match != null && (
            <MatchRail
              score={app.match}
              highlights={app.highlights ?? []}
              standalone
              // A rounded white box on the tinted card, like the counts, its
              // ring and reasons centred in the stretched height.
              className="bg-panel @xl:justify-center"
            />
          )}
        </div>
      </Card>

      <Section title="What You Sent">
        {sent.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2">
            {sent.map((resume) => (
              <li key={resume.id} className="text-body text-ink flex flex-wrap items-center gap-2">
                <ViewResumeButton resume={resume} />
                <Badge tone="inert">{resume.format.toUpperCase()}</Badge>
                {resume.rebuilt && <Badge tone="inert">Rebuilt</Badge>}
                <span className="text-note text-ink-meta">
                  Sent <LocalDate at={resume.created_at} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          // A placeholder in the upload dropzone's dashed outline: the slot a
          // sent resume fills, rather than a paragraph about why it's empty.
          <div className="border-border-strong bg-well rounded-card mt-3 flex flex-col items-center gap-2 border border-dashed px-4 py-7">
            <FileIcon className="text-ink-meta size-5" />
            <p className="text-body text-ink-meta">No resume sent yet</p>
          </div>
        )}
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
