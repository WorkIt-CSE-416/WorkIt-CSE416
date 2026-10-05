import type { BadgeTone } from "@/components/ui/badge";
import type { CardAccent } from "@/components/ui/card";

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
 * Tailwind sees them: a solid fill (a badge, a dot, a bar) and the glyph that
 * reads on it, a tint and the text that reads on that, a card's top edge, the
 * <Badge> tone, and the raw colour for SVG.
 *
 * Amber is --color-warning-fill with ink on it, not white: the text amber
 * renders brown as a fill, and white on the bright one is 2.1:1. Green is
 * --color-positive-ink, not --color-positive: white on the lighter green is
 * 2.8:1, under the 3:1 a glyph needs.
 */
export type StageKey = "saved" | "applied" | "heardBack" | "interviewing" | "offer";

export const STAGE_COLOR: Record<
  StageKey,
  {
    fill: string;
    onFill: string;
    tint: string;
    onTint: string;
    edge: CardAccent;
    tone: BadgeTone;
    css: string;
  }
> = {
  saved: {
    fill: "bg-ink-subtle",
    onFill: "text-white",
    tint: "bg-inert-tint",
    onTint: "text-ink-meta",
    edge: "inert",
    tone: "inert",
    css: "var(--color-ink-subtle)",
  },
  applied: {
    fill: "bg-brand",
    onFill: "text-white",
    tint: "bg-brand-tint",
    onTint: "text-brand-ink",
    edge: "brand",
    tone: "brand",
    css: "var(--color-brand)",
  },
  heardBack: {
    fill: "bg-advanced",
    onFill: "text-white",
    tint: "bg-advanced-tint",
    onTint: "text-advanced",
    edge: "advanced",
    tone: "advanced",
    css: "var(--color-advanced)",
  },
  interviewing: {
    fill: "bg-warning-fill",
    onFill: "text-ink",
    tint: "bg-warning-tint",
    onTint: "text-warning",
    edge: "warning",
    tone: "warning",
    css: "var(--color-warning-fill)",
  },
  offer: {
    fill: "bg-positive-ink",
    onFill: "text-white",
    tint: "bg-positive-tint",
    onTint: "text-positive-ink",
    edge: "positiveInk",
    tone: "positive",
    css: "var(--color-positive-ink)",
  },
};
