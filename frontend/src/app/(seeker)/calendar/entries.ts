import { format, parseISO } from "date-fns";

import { KIND_STAGE, STAGE_COLOR, STAGE_ICON } from "../stage-colors";
import { isAllDay, localDay, type EventKind, type TrackerEvent } from "../tracker";

/**
 * What the three Calendar views share about an entry: its kind's name and
 * colour, the day it sits on, its time and its accessible name. Browser only,
 * like the views: every one of these reads the viewer's own zone.
 */

/** Each kind's name, for the legend. Title Case: a legend is a label. */
export const KIND_LABEL: Record<EventKind, string> = {
  applied: "Applied",
  "follow-up": "Follow-Up",
  interview: "Interview",
  offer: "Offer",
  deadline: "Deadline",
};

/** The legend's order: a search's own order, then the deadlines that
 *  bound it. */
export const LEGEND_ORDER: EventKind[] = ["applied", "follow-up", "interview", "offer", "deadline"];

/** The colours and glyph an entry wears: its kind's stage (KIND_STAGE). */
export function lookOf(kind: EventKind) {
  const stage = KIND_STAGE[kind];
  return { ...STAGE_COLOR[stage], Icon: STAGE_ICON[stage] };
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

/** The day an entry falls on, written out: "Wednesday, October 7". Each
 *  view adds it after an entry's visible text, for a screen reader moving
 *  link to link, which hears no column or heading above it. The visible
 *  text stays first, so a voice user can say what they see (WCAG 2.5.3). */
export function longDay(at: string) {
  return format(isAllDay(at) ? parseISO(at) : new Date(at), "EEEE, MMMM d");
}
