import { differenceInCalendarDays, format, getYear, parseISO } from "date-fns";
import type { ComponentType } from "react";

import type { StageKey } from "./stage-colors";

/**
 * The application tracker's shape, and what the seeker pages work out from
 * it: the Applications board, grid and list, the Dashboard's Next Up and Up
 * Next, and the detail panel's timeline. The data itself is still a fixture
 * (./applications/data.ts); this is the shape its API will return.
 *
 * EVERY DATE IS AN ISO STRING, in one of two forms. A full instant
 * ("2026-10-07T18:00:00.000Z") is something at a time, like an interview. A
 * bare date ("2026-10-14") is something due on a day, like a closing date or
 * the day an application went in. The length tells them apart, as it does in
 * components/job-detail/closes-on.tsx.
 *
 * WHICH DAY AN INSTANT FALLS ON DEPENDS ON THE VIEWER, so only the browser
 * can say "Tomorrow, 2:00 PM". `describeWhen` and `localDay` read the
 * browser's zone and run there only (see ./local-time.tsx). The server can
 * still order things and say what is coming up, since an instant is the same
 * moment everywhere, and it prints a bare date the same way everywhere.
 */

/** What a dated entry is. Each kind wears one stage's colour and glyph
 *  (KIND_STAGE in ./stage-colors.ts), so a calendar entry and a board column
 *  never disagree about what amber means. */
export type EventKind = "applied" | "interview" | "offer" | "deadline" | "follow-up";

/** Something dated on one application. The applied date is not stored here:
 *  it is `appliedOn`, and `eventsOf` adds it. */
export type ApplicationEvent = {
  kind: Exclude<EventKind, "applied">;
  /** "Technical Interview", "Application Closes", "Respond By". */
  title: string;
  /** An instant for something at a time, a bare date for something due on a day. */
  at: string;
};

export type Application = {
  /** Stable across renders and in the URL: the detail panel is ?app=<id>. */
  id: string;
  role: string;
  company: string;
  /** Stand-in for the company logo; see the note in ./applications/icons.tsx. */
  Icon: ComponentType<{ className?: string }>;
  stage: StageKey;
  /** Where it stands within its stage, in the employer's words: "Round 3". */
  status?: string;
  /** What the seeker would write to remind themselves what the role is. */
  summary: string;
  /** 0-100, read in the bands in @/lib/match. */
  match: number;
  /** The day it was saved: the first entry on its timeline. */
  savedOn: string;
  /** The day it was sent, or null while it is only saved. */
  appliedOn: string | null;
  /** Interviews, deadlines, offers and follow-ups, past and still to come. */
  events: ApplicationEvent[];
  /** A filled button, for the one card whose action cannot wait. */
  cta?: string;
};

/** One dated thing with whose it is: a calendar entry, an Up Next row, a
 *  step on a timeline. Plain data, so it can cross into a client component. */
export type TrackerEvent = {
  id: string;
  applicationId: string;
  role: string;
  company: string;
  kind: EventKind;
  title: string;
  at: string;
};

/** A bare date is due on a day rather than at a time. */
export function isAllDay(at: string) {
  return at.length === 10;
}

/** For ordering only. A day-only entry sorts at the start of its day in UTC,
 *  which puts it ahead of that day's interviews almost everywhere. */
export function sortKey(at: string) {
  return Date.parse(isAllDay(at) ? `${at}T00:00:00Z` : at);
}

function bySortKey(a: { at: string }, b: { at: string }) {
  return sortKey(a.at) - sortKey(b.at);
}

/**
 * Whether `at` is still ahead of `now`. A day-only entry stays ahead until its
 * day has ended everywhere, at midnight in UTC-12, because the server has no
 * zone to end it in. A closing date therefore reads as upcoming all of its
 * day for every viewer, and lingers into the next morning only in the east.
 */
export function isUpcoming(at: string, now: Date) {
  return (isAllDay(at) ? Date.parse(`${at}T23:59:59-12:00`) : Date.parse(at)) >= now.getTime();
}

/** Everything dated on one application, oldest first: the day it went in,
 *  then its own events. */
export function eventsOf(app: Application): TrackerEvent[] {
  const applied = app.appliedOn
    ? [{ id: `${app.id}-applied`, kind: "applied" as const, title: "Applied", at: app.appliedOn }]
    : [];
  const own = app.events.map((event, i) => ({ ...event, id: `${app.id}-${i}` }));

  return [...applied, ...own]
    .map((event) => ({ ...event, applicationId: app.id, role: app.role, company: app.company }))
    .sort(bySortKey);
}

/** Every application's dated entries in one list, oldest first. */
export function allEvents(apps: Application[]): TrackerEvent[] {
  return apps.flatMap(eventsOf).sort(bySortKey);
}

/** What an application is waiting on: its first entry still ahead. The
 *  applied date never is; it is history by the time it exists. */
export function nextEvent(app: Application, now: Date): TrackerEvent | undefined {
  return eventsOf(app).find((event) => event.kind !== "applied" && isUpcoming(event.at, now));
}

/** One step on an application's timeline, in the detail panel. */
export type TimelineStep = {
  id: string;
  /** "saved" is the day it was saved; the rest are its tracker events. */
  kind: EventKind | "saved";
  title: string;
  at: string;
  /** Behind, the one it is waiting on, or further ahead. Worked out on the
   *  server against the request's time, so the panel hydrates to the same
   *  marks it rendered with. */
  state: "done" | "next" | "later";
};

/** An application from the day it was saved to its last scheduled step. */
export function timelineOf(app: Application, now: Date): TimelineStep[] {
  const next = nextEvent(app, now);
  const steps = [
    { id: `${app.id}-saved`, kind: "saved" as const, title: "Saved", at: app.savedOn },
    ...eventsOf(app).map(({ id, kind, title, at }) => ({ id, kind, title, at })),
  ];

  return steps.map((step) => ({
    ...step,
    state:
      step.id === next?.id
        ? "next"
        : step.kind !== "saved" && step.kind !== "applied" && isUpcoming(step.at, now)
          ? "later"
          : "done",
  }));
}

/** Every entry still ahead, across applications, soonest first. */
export function upcomingEvents(apps: Application[], now: Date): TrackerEvent[] {
  return allEvents(apps).filter((event) => event.kind !== "applied" && isUpcoming(event.at, now));
}

const UTC_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** "Sep 28", for a bare date. The same on the server and in the browser:
 *  a date has no zone, so it is read in UTC, where it was written. */
export function shortDay(day: string) {
  return UTC_DAY.format(new Date(`${day}T00:00:00Z`));
}

/** A card's one backward-looking fact: when it went in, or, for a job not
 *  applied to yet, when it was saved. It never names the stage, "Sent Sep
 *  28" rather than "Applied Sep 28": the grid prints it beside the stage's
 *  badge, and the board under the stage's column heading. */
export function sinceLabel(app: Application) {
  return app.appliedOn ? `Sent ${shortDay(app.appliedOn)}` : `Added ${shortDay(app.savedOn)}`;
}

/** The most the server can say about `at` with no zone to read it in: its
 *  UTC date. The browser swaps in `describeWhen` after hydration. */
export function describeWhenOnServer(at: string) {
  return shortDay(at.slice(0, 10));
}

/**
 * `at` in the viewer's own zone, relative to `now`: "Today, 2:00 PM",
 * "Tomorrow", "Thursday, 9:00 AM", then "Oct 17, 11:30 AM" a week or more
 * out, with the year only when it is not this one. Browser only.
 */
export function describeWhen(at: string, now: Date) {
  const date = isAllDay(at) ? parseISO(at) : new Date(at);
  const days = differenceInCalendarDays(date, now);

  let day: string;
  if (days === 0) day = "Today";
  else if (days === 1) day = "Tomorrow";
  else if (days === -1) day = "Yesterday";
  else if (days > 1 && days < 7) day = format(date, "EEEE");
  else day = format(date, getYear(date) === getYear(now) ? "MMM d" : "MMM d, yyyy");

  return isAllDay(at) ? day : `${day}, ${format(date, "h:mm a")}`;
}

/** The viewer's calendar day for `at`, as "YYYY-MM-DD". Browser only. */
export function localDay(at: string) {
  return isAllDay(at) ? at : format(new Date(at), "yyyy-MM-dd");
}
