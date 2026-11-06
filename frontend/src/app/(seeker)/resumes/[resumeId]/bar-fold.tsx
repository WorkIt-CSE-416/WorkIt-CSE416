"use client";

import { useRef, useState, type ReactElement, type ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";

/**
 * How the slim bar folds as it narrows, after Google Docs' toolbar: one row,
 * never two. The bar is a container (`@container/bar`), so each step reads
 * the bar's own width, which the side panel and Tailor's columns change, not
 * the window's. The words go first, least needed first (Format Options,
 * Sections, the save status, Add Experiences, Fit to One Page, Download),
 * each control keeping its glyph, its name and a tooltip; then whole
 * controls leave the row for More at its end (zoom, then the panels, then
 * Add Experiences). Undo, Redo, Fit to One Page and Download never leave.
 * Cut From Resume, which only shows after a fit, leaves early, since no
 * step counts its room. Each step is the width the row needs (the bar's
 * content box, inside its padding) once the step before it has folded,
 * with a save status as long as "Saved, 1234 ms", measured on 2026-11-05;
 * a control added to the row, or a longer word, means measuring them
 * again. The status is the one part that shrinks, so a longer one is cut
 * short, never pushes a button past the bar. The bar wrapped to a second,
 * ragged row at about 800px until then. The bar with a line open (a
 * bullet's tools) does not fold yet.
 *
 * Classes are whole strings, so Tailwind finds them in this file.
 */
export const FOLD = {
  /** The word goes, the glyph stays: `sr-only` keeps the name. */
  formatWord: "@max-[69rem]/bar:sr-only",
  cutWord: "@max-[69rem]/bar:sr-only",
  sectionsWord: "@max-[62rem]/bar:sr-only",
  status: "@max-[58rem]/bar:sr-only",
  experiencesWord: "@max-[51.75rem]/bar:sr-only",
  fitWord: "@max-[44.5rem]/bar:sr-only",
  downloadWord: "@max-[38rem]/bar:sr-only",
  /** The control leaves the row; More lists it. */
  cutAway: "@max-[58rem]/bar:hidden",
  zoomAway: "@max-[33.5rem]/bar:hidden",
  panelsAway: "@max-[25.25rem]/bar:hidden",
  experiencesAway: "@max-[19rem]/bar:hidden",
  /** More shows once the first control has left. */
  more: "hidden @max-[33.5rem]/bar:flex",
  moreWithCut: "hidden @max-[58rem]/bar:flex",
  /** A skeleton's width once its control has folded to a glyph. */
  formatSkeleton: "@max-[69rem]/bar:w-9",
  sectionsSkeleton: "@max-[62rem]/bar:w-9",
} as const;

/** The phone editor's row (./phone.tsx) folds the same way, with nothing to
 *  move to More: Format's word first, then Zoom's, then Download's, so a
 *  390px phone keeps "Download" and a 375px one shows the three glyphs. It
 *  wrapped Format, Download and Zoom under Undo and Redo at 375px. */
export const PHONE_FOLD = {
  formatWord: "@max-[27.5rem]/bar:sr-only",
  zoomWord: "@max-[24.5rem]/bar:sr-only",
  downloadWord: "@max-[21.75rem]/bar:sr-only",
} as const;

/** `sr-only` draws the word 1px wide. */
const folded = (word: HTMLElement | null) => (word?.offsetWidth ?? 0) <= 1;

/**
 * A bar button whose word folds away (`fold`, one of `FOLD`'s word steps).
 * Its name is the word, as `aria-label` too, so a folded button keeps it. A
 * folded button names itself in a tooltip, since its glyph alone may not
 * say what it does; `hint`, what a `title` said before, shows over the
 * word as well. The tooltip opens only while the word is hidden when there
 * is no hint: over the word it said the same thing twice.
 *
 * `render` is the button itself, a `Button` or a menu's trigger, so the
 * tooltip adds no element to the row.
 */
export function FoldButton({
  label,
  icon,
  fold,
  hint,
  after,
  disabled,
  render,
}: {
  label: string;
  icon: ReactNode;
  fold: string;
  hint?: string;
  /** After the word: Download's caret. */
  after?: ReactNode;
  disabled?: boolean;
  render: ReactElement;
}) {
  const word = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [tip, setTip] = useState("");
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        const text = folded(word.current) ? (hint ? `${label}: ${hint}` : label) : (hint ?? "");
        // Kept while closing, so the tooltip fades out with its words
        if (next) setTip(text);
        setOpen(next && text !== "");
      }}
    >
      <TooltipTrigger disabled={disabled} aria-label={label} render={render}>
        {icon}{" "}
        <span ref={word} className={fold}>
          {label}
        </span>
        {after}
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}
