import { format, parseISO } from "date-fns";

import { KIND_ICON, KIND_STAGE, STAGE_COLOR } from "../stage-colors";
import { isAllDay, localDay, type EventKind, type TrackerEvent } from "../tracker";

/** What the helpers below read of an entry. */
type Entry = Pick<TrackerEvent, "kind" | "at" | "endsAt" | "source" | "emailKind">;

/**
 * What the three Calendar views share about an entry: its kind's name and
 * colour, the day it sits on, its time and its accessible name. Browser only,
 * like the views: every one of these reads the viewer's own zone.
 */

/** Each kind's name, for the filter row. Title Case: a chip is a label. */
export const KIND_LABEL: Record<EventKind, string> = {
  applied: "Applied",
  "apply-by": "Apply By",
  closes: "Closes",
  interview: "Interview",
  assessment: "Assessment",
  offer: "Offer",
  rejection: "Rejection",
  "follow-up": "Follow-Up",
};

/** The filter row's order (KAN-429): what to act on first, the dates before
 *  applying, then a search's own order to its end. */
export const KIND_ORDER: EventKind[] = [
  "apply-by",
  "closes",
  "applied",
  "assessment",
  "interview",
  "offer",
  "rejection",
  "follow-up",
];

/** The colours and glyph an entry wears: its kind's stage colour
 *  (KIND_STAGE) and its own glyph (KIND_ICON), as Home and the timeline
 *  draw it. */
export function lookOf(kind: EventKind) {
  return { ...STAGE_COLOR[KIND_STAGE[kind]], Icon: KIND_ICON[kind] };
}

/** A local day as "YYYY-MM-DD", the key every view groups by. */
export function dayKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

/** Entries by the local day they fall on, each day's in time order (the
 *  list arrives sorted, and grouping keeps that order). */
export function groupByDay(events: TrackerEvent[]) {
  const byDay = new Map<string, TrackerEvent[]>();
  for (const event of events) {
    const key = localDay(event.at);
    byDay.set(key, [...(byDay.get(key) ?? []), event]);
  }
  return byDay;
}

/** "2 PM", "3:30 PM", or null for something due on a day. */
export function shortTime(at: string) {
  if (isAllDay(at)) return null;
  const date = new Date(at);
  return format(date, date.getMinutes() ? "h:mm a" : "h a");
}

/** Kinds drawn without a time even when stored as an instant: an applied
 *  day's instant is only when Applied was clicked, Apply By is a day, and a
 *  closing date is a deadline, not an appointment (KAN-429). */
const UNTIMED: ReadonlySet<EventKind> = new Set<EventKind>(["applied", "apply-by", "closes"]);

/** Whether an entry sits at a time: the Week's grid draws it as a
 *  block there, and the Month as a dot with its time. Everything else is
 *  all day: the grid's all-day row, and a filled bar in the Month. */
export function isTimed(event: Entry) {
  if (isAllDay(event.at) || UNTIMED.has(event.kind)) return false;
  // An email's instant is when it came, unless it names a time to be
  // somewhere: an offer or a rejection email lands on its day.
  return event.source !== "gmail" || EMAIL_TIMED.has(event.emailKind);
}

/** The email kinds whose `at` is a time the email names. */
const EMAIL_TIMED = new Set<TrackerEvent["emailKind"]>(["interview", "assessment"]);

/** Emails that only confirm or update leave the Calendar (KAN-429): they
 *  are records, kept on the application's timeline and in the Inbox, not
 *  dates. A confirmation sat on the grid at the minute it arrived, as if
 *  it were a meeting, beside the Applied entry it repeats. */
export function onCalendar(event: TrackerEvent) {
  return !(
    event.source === "gmail" &&
    (event.emailKind === "confirmation" || event.emailKind === "other")
  );
}

/** An entry's time as a chip prints it: a timed entry's start, or a
 *  closing date's cut-off ("Closes 11:59 PM"); else null. */
export function timeOf(event: Entry) {
  if (isTimed(event)) return shortTime(event.at);
  return event.kind === "closes" ? shortTime(event.at) : null;
}

/** A timed entry's start and end: "2 – 3 PM", "10:30 AM – 12 PM"; its
 *  start alone when it has no end. */
export function timeRange(event: { at: string; endsAt?: string | null }) {
  const start = shortTime(event.at) ?? "";
  if (!event.endsAt) return start;
  return `${start} – ${shortTime(event.endsAt) ?? ""}`;
}

/** An entry's time as its card prints it (./event-card.tsx): its range,
 *  a closing date's cut-off, or All Day. */
export function whenOf(event: Entry) {
  if (isTimed(event)) return timeRange(event);
  if (event.kind === "closes" && !isAllDay(event.at)) return `Closes ${shortTime(event.at)}`;
  return "All Day";
}

/** The day an entry falls on, written out: "Wednesday, October 7". Each
 *  view adds it after an entry's visible text, for a screen reader moving
 *  link to link, which hears no column or heading above it. The visible
 *  text stays first, so a voice user can say what they see (WCAG 2.5.3). */
export function longDay(at: string) {
  return format(isAllDay(at) ? parseISO(at) : new Date(at), "EEEE, MMMM d");
}
