import type { ComponentType } from "react";

import { AwardIcon, BookmarkIcon, BriefcaseIcon, CalendarIcon, MailIcon } from "@/components/icons";
import type { BadgeTone } from "@/components/ui/badge";

/**
 * One colour per stage of a search, for every screen that shows one — the
 * Applications board, grid and list, and the Dashboard's pipeline — so a
 * colour means the same stage wherever it appears:
 *
 *   saved         grey    not applied yet, so not in the pipeline at all
 *   applied       violet  the brand: in, and waiting
 *   heard back    blue    a reply (no board column; the Dashboard's funnel)
 *   interviewing  amber   the expensive, nerve-racking step
 *   offer         green   finished well
 *
 * Each stage carries every form the screens need, as literal class names so
 * Tailwind sees them: a solid fill (a badge, a bar) and the glyph that reads
 * on it, a tint and the text that reads on that, a panel (the board column
 * that holds a stage's cards: its tint and a faint border in the same hue),
 * the <Badge> tone, and the raw colour for SVG.
 *
 * Amber is --color-warning-fill with ink on it, not white: the text amber
 * renders brown as a fill, and white on the bright one is 2.1:1. Green is
 * --color-positive-ink, not --color-positive: white on the lighter green is
 * 2.8:1, under the 3:1 a glyph needs.
 */
export type StageKey = "saved" | "applied" | "heardBack" | "interviewing" | "offer";

/** Each stage's glyph, beside its name wherever the stage is labelled: a
 *  board column's header and a Dashboard pipeline badge. */
export const STAGE_ICON: Record<StageKey, ComponentType<{ className?: string }>> = {
  saved: BookmarkIcon,
  applied: BriefcaseIcon,
  heardBack: MailIcon,
  interviewing: CalendarIcon,
  offer: AwardIcon,
};

export const STAGE_COLOR: Record<
  StageKey,
  {
    fill: string;
    onFill: string;
    tint: string;
    onTint: string;
    panel: string;
    tone: BadgeTone;
    css: string;
  }
> = {
  saved: {
    fill: "bg-ink-subtle",
    onFill: "text-white",
    tint: "bg-inert-tint",
    onTint: "text-ink-meta",
    panel: "bg-app border-border-subtle",
    tone: "inert",
    css: "var(--color-ink-subtle)",
  },
  applied: {
    fill: "bg-brand",
    onFill: "text-white",
    tint: "bg-brand-tint",
    onTint: "text-brand-ink",
    panel: "bg-brand-tint border-brand/20",
    tone: "brand",
    css: "var(--color-brand)",
  },
  heardBack: {
    fill: "bg-advanced",
    onFill: "text-white",
    tint: "bg-advanced-tint",
    onTint: "text-advanced",
    panel: "bg-advanced-tint border-advanced/20",
    tone: "advanced",
    css: "var(--color-advanced)",
  },
  interviewing: {
    fill: "bg-warning-fill",
    onFill: "text-ink",
    tint: "bg-warning-tint",
    onTint: "text-warning",
    panel: "bg-warning-tint border-warning-fill/40",
    tone: "warning",
    css: "var(--color-warning-fill)",
  },
  offer: {
    fill: "bg-positive-ink",
    onFill: "text-white",
    tint: "bg-positive-tint",
    onTint: "text-positive-ink",
    panel: "bg-positive-tint border-positive/30",
    tone: "positive",
    css: "var(--color-positive-ink)",
  },
};
