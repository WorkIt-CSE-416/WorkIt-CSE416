import type { ComponentType } from "react";

import { AwardIcon, BookmarkIcon, BriefcaseIcon, CalendarIcon } from "@/components/icons";
import type { BadgeTone } from "@/components/ui/badge";

import type { EventKind } from "./tracker";

/**
 * One colour per stage of a search, for every screen that shows one (the
 * Applications board, grid, list and detail panel, and the Dashboard's Up
 * Next) so a colour means the same stage wherever it appears:
 *
 *   saved         grey    not applied yet
 *   applied       violet  the brand: in, and waiting
 *   interviewing  amber   the expensive, nerve-racking step
 *   offer         green   finished well
 *
 * There was a fifth, Heard Back in blue, drawn only by the Dashboard's
 * pipeline funnel; it went with the funnel. Add a stage here when a screen
 * needs one, and give it a colour no other stage or status holds.
 *
 * Each stage carries every form the screens need, as literal class names so
 * Tailwind sees them: a solid fill (the disc behind a stage's white glyph: a
 * board column header, an Up Next row), a tint and the text that reads on
 * that, a panel (the board column that holds a stage's cards: its tint and a
 * faint border in the same hue), and the <Badge> tone.
 *
 * EVERY FILL CARRIES A WHITE GLYPH, at 3:1 or better, so a stage's icon is
 * drawn the same way on every stage. That rules out three lighter colours:
 * grey is --color-ink-meta, not --color-ink-subtle (white on it is 2.95:1);
 * amber is --color-warning-strong, not --color-warning-fill (2.1:1, which is
 * why Interviewing once had a black icon among white ones); green is
 * --color-positive-ink, not --color-positive (2.8:1).
 */
export type StageKey = "saved" | "applied" | "interviewing" | "offer";

/** The stages in the order a search moves through them: the board's columns
 *  left to right, and the Applications filter's chips. */
export const STAGE_ORDER: StageKey[] = ["saved", "applied", "interviewing", "offer"];

/** Each stage's name, wherever one is printed: a column heading, a badge, a
 *  filter chip. */
export const STAGE_LABEL: Record<StageKey, string> = {
  saved: "Saved",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
};

/** Each stage's glyph, wherever the stage is labelled: a board column's
 *  header and an Up Next row. */
export const STAGE_ICON: Record<StageKey, ComponentType<{ className?: string }>> = {
  saved: BookmarkIcon,
  applied: BriefcaseIcon,
  interviewing: CalendarIcon,
  offer: AwardIcon,
};

export const STAGE_COLOR: Record<
  StageKey,
  {
    fill: string;
    tint: string;
    onTint: string;
    panel: string;
    tone: BadgeTone;
  }
> = {
  saved: {
    fill: "bg-ink-meta",
    tint: "bg-inert-tint",
    onTint: "text-ink-meta",
    panel: "bg-app border-border-subtle",
    tone: "inert",
  },
  applied: {
    fill: "bg-brand",
    tint: "bg-brand-tint",
    onTint: "text-brand-ink",
    panel: "bg-brand-tint border-brand/20",
    tone: "brand",
  },
  interviewing: {
    fill: "bg-warning-strong",
    tint: "bg-warning-tint",
    onTint: "text-warning",
    panel: "bg-warning-tint border-warning-fill/40",
    tone: "warning",
  },
  offer: {
    fill: "bg-positive-ink",
    tint: "bg-positive-tint",
    onTint: "text-positive-ink",
    panel: "bg-positive-tint border-positive/30",
    tone: "positive",
  },
};

/**
 * Which stage's colour and glyph each kind of dated entry wears, on every
 * screen that lists them: the Dashboard's Up Next, the detail panel's
 * timeline, the Calendar. An interview is Interviewing's amber calendar
 * wherever it appears, and the day an application went in is Applied's violet
 * briefcase. A deadline is a saved job's closing date, so it is Saved's grey
 * bookmark, not danger red: red means rejected. A follow-up is a nudge on
 * something already sent, so it is Applied's violet too.
 *
 * It maps kinds, not the application's own stage, so an offer-stage job's
 * past interviews still read as interviews.
 */
export const KIND_STAGE: Record<EventKind, StageKey> = {
  applied: "applied",
  interview: "interviewing",
  offer: "offer",
  deadline: "saved",
  "follow-up": "applied",
};
