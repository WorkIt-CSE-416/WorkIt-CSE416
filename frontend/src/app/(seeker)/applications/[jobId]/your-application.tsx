import { MessageSquareText } from "lucide-react";
import type { ReactNode } from "react";

import { FileIcon } from "@/components/icons";
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
import { SentResumeRow } from "../view-resume";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The strip's columns from 448px of card, by how many cards it has: a
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
 * flush on the right, the next-step cards along the foot), then what the
 * seeker sent, from what the API already keeps. No new table: the stage and
 * its dates are the application's row, the resumes are the sent resumes
 * linked to the job posting.
 *
 * TWO CARDS, FACTS ONLY (KAN-286), worked out on the server against the
 * request's time (`getNow`). First whether the posting is still open, then
 * how long: since the seeker applied, or, for a saved job, since the
 * posting went up (the sooner they apply, the fewer applicants are ahead).
 * They replaced counts that read 0 for every Apply ("save to apply": Apply
 * saves and applies at once) or told the student only about the past
 * ("posted before you applied"). A suggested follow-up day was tried and
 * dropped: any fixed number of days is a guess. The total applicant count
 * would fit here, but no hiring system WorkIt reads publishes it.
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
  const cards: { label: string; value: string | number }[] = [];
  // Every live application has `open`; the type leaves it optional.
  if (app.open != null) {
    cards.push(
      app.open
        ? {
            label: app.appliedOn ? "Still taking applications" : "Apply while it's open",
            value: "Open",
          }
        : {
            label: app.appliedOn ? "No longer taking applications" : "You can no longer apply",
            value: "Closed",
          },
    );
  }
  if (app.appliedOn) {
    const days = daysBetween(app.appliedOn, now);
    cards.push({
      label: days === 1 ? "Day since you applied" : "Days since you applied",
      value: days,
    });
  } else if (job?.posted_at) {
    const days = daysBetween(job.posted_at, now);
    cards.push({
      label: days === 1 ? "Day since it was posted" : "Days since it was posted",
      value: days,
    });
  }
  const StageIcon = STAGE_ICON[app.stage];

  return (
    <>
      {/* ONE TINTED CARD for the seeker's record, holding rounded white
          boxes: the status and timeline on the left with the two cards
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
            </div>
            <h2 className="text-title text-ink mt-3 font-bold">
              {app.appliedOn ? "Waiting to Hear Back" : "Not Applied Yet"}
            </h2>
            {/* No applied date here: the days-since card and the timeline
                both carry it. */}
            <p className="text-body text-ink-meta mt-1">
              {!app.appliedOn && (
                <>
                  You saved it on <LocalDate at={app.savedOn} />
                  {" · "}
                </>
              )}
              {app.resume ? <>Sent {app.resume}</> : "No resume sent through WorkIt"}
            </p>

            <Timeline steps={timeline(app, sent)} horizontal className="mt-5" />

            {/* The cards: a figure over its words, a rounded white
                box each. justify-end puts the figure at the top (the column
                is reversed), so the figures line up when one label wraps.
                A closed posting says so here only, not in a badge too. */}
            <dl className={cn("mt-5 grid gap-3", COLUMNS[cards.length])}>
              {cards.map(({ label, value }) => (
                // The figure first to the eye, the words first to a screen
                // reader (a <dt> leads its <dd>).
                <Card
                  key={label}
                  padding="md"
                  elevated={false}
                  className="flex flex-col-reverse justify-end"
                >
                  <dt className="text-note text-ink-meta mt-0.5">{label}</dt>
                  <dd className="text-title text-ink font-bold tabular-nums">{value}</dd>
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

      {/* WHAT YOU SENT (KAN-317): the resume as the Resumes view draws its
          rows, then the answers the application asked for. Answers are not
          stored yet; the dashed slot holds their place so the section's
          shape does not change when they arrive. Both empty slots are the
          upload dropzone's dashed outline, as the empty resume list's was. */}
      <Section title="What You Sent">
        <h3 className="text-label text-ink mt-3 font-semibold">Resume</h3>
        {sent.length > 0 ? (
          <ul>
            {sent.map((resume) => (
              <SentResumeRow
                key={resume.id}
                resume={resume}
                appliedWith={app.sentResume?.id === resume.id}
              />
            ))}
          </ul>
        ) : (
          <EmptySlot icon={<FileIcon className="text-ink-meta size-5" />}>
            No resume sent yet
          </EmptySlot>
        )}

        <h3 className="text-label text-ink mt-5 font-semibold">Answers</h3>
        <EmptySlot icon={<MessageSquareText aria-hidden className="text-ink-meta size-5" />}>
          Your answers to this application&apos;s questions will show here.
        </EmptySlot>
      </Section>
    </>
  );
}

/** An empty slot in the upload dropzone's dashed outline: the place a sent
 *  resume or the answers fill, rather than a paragraph about why it's
 *  empty. */
function EmptySlot({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="border-border-strong bg-well rounded-card mt-2 flex flex-col items-center gap-2 border border-dashed px-4 py-7">
      {icon}
      <p className="text-body text-ink-meta text-center">{children}</p>
    </div>
  );
}

/** Steps closer than this came from one action: "Did You Apply?"'s Yes
 *  saves the job, sends the resume and applies within a second or two. */
const ONE_ACTION_MS = 2 * 60 * 1000;

/** The order of steps from one action, whatever their milliseconds say. */
const RANK: Partial<Record<TimelineStep["kind"], number>> = { saved: 0, sent: 1, applied: 2 };

/**
 * Saved, each resume sent, then applied, oldest first. All behind it: the
 * tracker stores nothing still to come (../../tracker.ts).
 *
 * WHAT ONE ACTION WROTE IS ONE STEP (KAN-317). Apply writes the save, the
 * sent resume and the application within a second, in no fixed order, so
 * sorting by the millisecond once drew Sent, Saved, Applied, all at 3:02
 * PM: a resume sent before the job was saved. Now a resume sent with the
 * application is the Applied step's note, and a save from the same click
 * is left out, since the student never saved the job first. Steps further
 * apart keep their own dot; a tie still sorts Saved, Sent, Applied.
 */
function timeline(app: Application, sent: SentResume[]): TimelineStep[] {
  const applied = app.appliedOn ? sortKey(app.appliedOn) : null;
  const withApplying = (at: string) =>
    applied != null && Math.abs(sortKey(at) - applied) <= ONE_ACTION_MS;

  const steps: TimelineStep[] = [];
  if (!withApplying(app.savedOn)) {
    steps.push({ id: "saved", kind: "saved", title: "Saved", at: app.savedOn, state: "done" });
  }
  const alone = sent.filter((resume) => !withApplying(resume.created_at));
  for (const resume of alone) {
    steps.push({
      id: resume.id,
      kind: "sent",
      title: "Sent a Resume",
      at: resume.created_at,
      state: "done",
    });
  }
  if (app.appliedOn) {
    steps.push({
      id: "applied",
      kind: "applied",
      title: "Applied",
      at: app.appliedOn,
      // What You Sent, under this card, names the resume.
      note: alone.length < sent.length ? "Resume sent" : undefined,
      state: "done",
    });
  }
  return steps.sort(
    (a, b) => sortKey(a.at) - sortKey(b.at) || (RANK[a.kind] ?? 0) - (RANK[b.kind] ?? 0),
  );
}
