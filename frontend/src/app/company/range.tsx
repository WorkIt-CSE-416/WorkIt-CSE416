"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { APPLICATIONS_BY_DAY, type DayCount } from "./data";

/**
 * The window every FLOW number on the dashboard is measured over.
 *
 * ---------------------------------------------------------------------------
 * WHAT A DATE RANGE CAN AND CANNOT SCOPE
 *
 * This screen has two kinds of number, and the distinction decides what the
 * picker is allowed to touch:
 *
 *   FLOW — things that HAPPENED during a period. Applications received,
 *   offers accepted, interviews held. "Between June and September" is a
 *   sensible qualifier, and the answer changes when the window does. These
 *   read the range.
 *
 *   STOCK — the state of the world RIGHT NOW. How many roles are open, how
 *   many applications sit unreviewed, which stage each one is in, how long
 *   they have been waiting. "How many applications are in Screening between
 *   June and September" is not a question with an answer: they are in
 *   Screening today, or they are not. These must NOT read the range, because
 *   wiring them to it would produce a number that looks authoritative and
 *   means nothing.
 *
 * So the picker drives the Applications chart and the New applicants tile, and
 * deliberately leaves the ring, the role bars, the review queue, the stage
 * ages and the arrivals feed alone. Those cards say "right now" or "today" in
 * their own subtitles rather than carrying a badge each — the copy is cheaper
 * than the chrome and harder to ignore.
 *
 * There is a third category this app cannot serve yet. A stock metric CAN be
 * scoped by COHORT — "where are the applications RECEIVED in this window
 * sitting today" is meaningful, and it is what a real ATS does. It needs each
 * application to carry both a received date and a current stage; STATUS_BY_ROLE
 * is aggregate counts with no dates behind them, so there is nothing to filter.
 * See the note in ./page.tsx for what that would take.
 *
 * ---------------------------------------------------------------------------
 * ONE PIECE OF STATE, TWO CONTROLS
 *
 * The chart had its own 3 months / 30 days / 7 days toggle before this existed,
 * which would have made two controls for one fact — the classic dashboard bug,
 * where a header says one window and a card draws another. The toggle is still
 * there, but it now writes here rather than to its own state: it is a shortcut
 * for a preset, and the header button always shows what it did. Pick a custom
 * range in the calendar and no preset is pressed, which is the honest rendering
 * of "none of these".
 *
 * ---------------------------------------------------------------------------
 * ISO STRINGS ARE THE SOURCE OF TRUTH, Dates are a conversion at the edges.
 *
 * The fixtures are date-only ISO strings and the app formats them in UTC, for
 * the reason ./table.tsx's `formatDate` records: parsed as a Date and rendered
 * locally, a date-only value lands a day early for every viewer west of
 * Greenwich. react-day-picker, on the other hand, works in LOCAL Dates — it
 * builds them from calendar fields, so a day cell is local midnight.
 *
 * Mixing those two conventions is how a picker ends up one day off. So: the
 * range is stored as ISO strings, `toDate` converts to local midnight only for
 * the calendar, `toISO` reads local fields back, and display formatting always
 * goes from the ISO string with timeZone UTC. Never format a converted Date.
 * ------------------------------------------------------------------------- */

export type DateRange = { from: string; to: string };

/** The series is the only data there is, so it is also the pickable span. */
export const SERIES_START = APPLICATIONS_BY_DAY[0].date;
export const SERIES_END = APPLICATIONS_BY_DAY[APPLICATIONS_BY_DAY.length - 1].date;

/** Local calendar date to ISO day. The local field getters, NOT toISOString(),
 *  which converts to UTC first and can hand back the previous day. */
export function toISO(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}

/** ISO day to a Date at LOCAL midnight, which is what the calendar compares
 *  its cells against. Built from fields rather than parsed, because
 *  `new Date("2026-09-02")` is UTC midnight and would be the day before here. */
export function toDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);

  return new Date(year, month - 1, day);
}

export type Preset = { label: string; range: DateRange };

/* Local-date helpers for building the calendar-relative presets below. They
 * work in the same local-midnight space `toDate` produces — see the ISO note
 * at the top of this file. */
const shiftDays = (date: Date, by: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + by);

  return next;
};

/** Held inside the pickable span, so a preset that reaches past the fixture
 *  still matches the range it actually produces and reads as pressed. */
function clamp({ from, to }: DateRange): DateRange {
  return {
    from: from < SERIES_START ? SERIES_START : from,
    to: to > SERIES_END ? SERIES_END : to,
  };
}

/**
 * The windows the picker offers by name.
 *
 * ANCHORED TO THE END OF THE SERIES, NOT TO `new Date()`. Every fixture on this
 * screen stops on 2026-09-02, so "today" has to mean that day or the whole
 * dashboard would open on an empty window the moment the calendar rolls over.
 * The two coincide right now, which is exactly why it needs saying: swap in
 * real data and this line becomes `new Date()`, and nothing else here changes.
 *
 * A MIX OF ROLLING AND CALENDAR WINDOWS, deliberately. "Last 7 Days" is a
 * rolling span and "This Month" is a calendar one, and they answer different
 * questions — the first is "how have we been doing lately", the second is "how
 * are we doing against the month we report on". A list of only rolling spans
 * cannot answer the second.
 *
 * Every entry is clamped, so several of them are shorter than their name
 * suggests against a ninety-day fixture: This Year is really Jun 5 onward. That
 * is honest about the data rather than about the calendar.
 */
const TODAY = toDate(SERIES_END);

export const PRESETS: Preset[] = [
  { label: "Today", range: clamp({ from: SERIES_END, to: SERIES_END }) },
  {
    label: "Yesterday",
    range: clamp({ from: toISO(shiftDays(TODAY, -1)), to: toISO(shiftDays(TODAY, -1)) }),
  },
  /* Week starting Sunday, which is what the calendar's own header row shows. */
  {
    label: "This Week",
    range: clamp({ from: toISO(shiftDays(TODAY, -TODAY.getDay())), to: SERIES_END }),
  },
  { label: "Last 7 Days", range: clamp({ from: toISO(shiftDays(TODAY, -6)), to: SERIES_END }) },
  { label: "Last 28 Days", range: clamp({ from: toISO(shiftDays(TODAY, -27)), to: SERIES_END }) },
  {
    label: "This Month",
    range: clamp({
      from: toISO(new Date(TODAY.getFullYear(), TODAY.getMonth(), 1)),
      to: SERIES_END,
    }),
  },
  {
    label: "Last Month",
    range: clamp({
      from: toISO(new Date(TODAY.getFullYear(), TODAY.getMonth() - 1, 1)),
      /* Day 0 of this month is the last day of the previous one. */
      to: toISO(new Date(TODAY.getFullYear(), TODAY.getMonth(), 0)),
    }),
  },
  {
    label: "This Year",
    range: clamp({ from: toISO(new Date(TODAY.getFullYear(), 0, 1)), to: SERIES_END }),
  },
];

/**
 * Which entry of a preset list a range corresponds to, or null for a custom
 * span. Takes the list because there are two: the picker offers the eight above
 * and the chart's toggle offers three shorthands, and a window that matches one
 * list need not match the other — a 28-day range presses nothing on a toggle
 * that only knows 7, 30 and 90.
 */
export function matchPreset<T extends { range: DateRange }>(range: DateRange, list: T[]) {
  return list.find((p) => p.range.from === range.from && p.range.to === range.to) ?? null;
}

/**
 * The three the chart's toggle offers, and they are THREE OF THE EIGHT ABOVE
 * rather than a second list of their own.
 *
 * It used to be its own set of "last N days" spans, and the two lists drifted
 * on the very first window they disagreed about: the page opened on a 30-day
 * default, the toggle showed "30 days" pressed, and the picker showed nothing
 * selected because its nearest entry was 28. Two lists means every window is
 * either in both or looks broken in one.
 *
 * `short` exists because a toggle is three chips in a card header and cannot
 * carry "Last 28 Days" three times over. It is a display label for the same
 * window, not a different window — the `range` is the shared one, by reference.
 * "Max" for the widest, because clamped to a ninety-day fixture "This Year" is
 * simply all the data there is, and a toggle saying "This Year" beside "7 days"
 * invites the reader to think it is a longer span than the chart can draw.
 */
const TOGGLE_LABELS = ["Last 7 Days", "Last 28 Days", "This Year"] as const;
const SHORT: Record<(typeof TOGGLE_LABELS)[number], string> = {
  "Last 7 Days": "7 days",
  "Last 28 Days": "28 days",
  "This Year": "Max",
};

export const TOGGLE_PRESETS: (Preset & { short: string })[] = TOGGLE_LABELS.map((label) => {
  const preset = PRESETS.find((p) => p.label === label);

  /* A typo in TOGGLE_LABELS would otherwise render a toggle with a missing chip
   * and no clue why, so it fails at import instead. */
  if (!preset) throw new Error(`TOGGLE_LABELS names a preset that does not exist: ${label}`);

  return { ...preset, short: SHORT[label] };
});

/**
 * The window the dashboard opens on.
 *
 * Twenty-eight days rather than the full ninety, for two reasons that point the
 * same way. It is the span a recruiter means by "lately", and it is the widest
 * one with a comparable span behind it inside a ninety-day fixture — at ninety
 * there is no preceding ninety, so the New applicants tile would open with no
 * delta at all. It is a named preset rather than a day count so the picker
 * opens with that entry already highlighted.
 */
const DEFAULT_PRESET = TOGGLE_PRESETS[1];

/** Whole days in a range, counting both ends — a single day is 1, not 0. */
export function rangeLength(range: DateRange) {
  const ms = toDate(range.to).getTime() - toDate(range.from).getTime();

  return Math.round(ms / 86_400_000) + 1;
}

type RangeContextValue = {
  range: DateRange;
  setRange: (next: DateRange) => void;
  /** The days the range covers, in series order. */
  days: DayCount[];
  /** The equally long span immediately before it — empty when the series does
   *  not reach back that far, which is what suppresses a meaningless delta. */
  previousDays: DayCount[];
};

const RangeContext = createContext<RangeContextValue | null>(null);

export function useRange() {
  const value = useContext(RangeContext);

  if (!value) throw new Error("useRange must be used inside <RangeProvider>");

  return value;
}

export function RangeProvider({ children }: { children: ReactNode }) {
  const [range, setRangeState] = useState<DateRange>(DEFAULT_PRESET.range);

  /* Clamped to the series, because the calendar can only usefully offer dates
   * the fixture covers and a range beyond it would draw an empty chart that
   * looks like an outage rather than like a gap in the data. */
  const setRange = useCallback((next: DateRange) => {
    setRangeState({
      from: next.from < SERIES_START ? SERIES_START : next.from,
      to: next.to > SERIES_END ? SERIES_END : next.to,
    });
  }, []);

  const value = useMemo<RangeContextValue>(() => {
    /* ISO date strings sort and compare lexicographically, which is the whole
     * reason the fixtures store them that way — no parsing to filter a span. */
    const days = APPLICATIONS_BY_DAY.filter((d) => d.date >= range.from && d.date <= range.to);

    const start = APPLICATIONS_BY_DAY.findIndex((d) => d.date === days[0]?.date);
    const previousDays =
      start > 0 ? APPLICATIONS_BY_DAY.slice(Math.max(0, start - days.length), start) : [];

    return {
      range,
      setRange,
      days,
      /* A partial preceding span would understate the comparison and read as a
       * fall that never happened, so a short one counts as none at all. */
      previousDays: previousDays.length === days.length ? previousDays : [],
    };
  }, [range, setRange]);

  return <RangeContext.Provider value={value}>{children}</RangeContext.Provider>;
}

/** The range as one label — "Jun 5 – Sep 2, 2026", with the year said once.
 *  Formatted from the ISO strings in UTC; see the note at the top of the file. */
export function formatRange({ from, to }: DateRange) {
  const short = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

  const year = new Date(to).toLocaleDateString("en-US", { year: "numeric", timeZone: "UTC" });

  return from === to ? `${short(from)}, ${year}` : `${short(from)} – ${short(to)}, ${year}`;
}
