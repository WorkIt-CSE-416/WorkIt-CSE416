import type { ComponentType } from "react";

import { AwardIcon, BookmarkIcon, BriefcaseIcon, CalendarIcon } from "@/components/icons";
import type { BadgeTone } from "@/components/ui/badge";

/**
 * One colour per stage of a search, for every screen that shows one (the
 * Applications board, grid and list, and the Dashboard's Up Next) so a
 * colour means the same stage wherever it appears:
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
