import { useEffect, useId, useState, type ReactNode } from "react";

import { ChevronDownIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

/**
 * The grouped resume list (KAN-404) that the Resumes page and every resume
 * picker dialog draw (KAN-406): the student's resumes in one scroll, under
 * a heading per type, in the Type filter's order. Each screen draws its own
 * cards inside it: the Resumes page's carry the star, Rename, Download and
 * Delete; a picker's carry a radio.
 */

/** The groups, top to bottom, named as the Resumes page's Type filter is. */
export const RESUME_TYPES = [
  { value: "uploaded", label: "Uploaded" },
  { value: "generated", label: "Generated" },
  { value: "tailored", label: "Tailored" },
] as const;

export type ResumeType = (typeof RESUME_TYPES)[number]["value"];

/** The search's words, lowercased. */
export function searchWords(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Whether every word is in the text: "acme intern" finds "Intern at Acme". */
export function matches(text: string, words: string[]): boolean {
  const lower = text.toLowerCase();
  return words.every((word) => lower.includes(word));
}

/** A sticky heading (39px: pt-3, the 23px badge, pb-1), five cards of 52px
 *  each with its 8px top margin (`RESUME_ROW`), and the list's 12px foot:
 *  351px. A card, heading or gap that changes size changes this too. A list
 *  of fewer cards stops short of it. */
const FIVE_ROWS = "max-h-[calc(2.4375rem+5*3.75rem+0.75rem)]";

/** `fill`'s cap: the room `useFillPage` measured, never under `FIVE_ROWS`,
 *  which also holds until it has measured (the server's render). */
const FILL_PAGE = "max-h-[max(calc(2.4375rem+5*3.75rem+0.75rem),var(--fill-height,0px))]";

/**
 * The list's one scroll, five cards high under a heading, not the shared
 * `max-h-scroll-box` (320px) that Top Matches uses: with the group
 * headings, 320px showed three and a half. Never a scroll box per group:
 * nested, the wheel and a finger get caught in the inner box. With `fill`
 * (the Resumes page, KAN-434) it runs down to the foot of the page
 * instead: five cards left half a laptop screen empty under it.
 */
export function ResumeScroll({
  label,
  fill = false,
  children,
}: {
  label?: string;
  fill?: boolean;
  children: ReactNode;
}) {
  const fit = useFillPage(fill);
  return (
    // pb-3: the last card's room. A group's heading opens with its own top
    // padding, which also leaves a card's lift under the pointer room the
    // scroll would clip.
    <ul
      ref={fill ? fit : undefined}
      role="list"
      aria-label={label}
      className={cn(fill ? FILL_PAGE : FIVE_ROWS, "flex flex-col overflow-y-auto px-3 pb-3")}
    >
      {children}
    </ul>
  );
}

/**
 * The room under the list, as `--fill-height` on it: the page's scroll
 * area (`main`) below the list's top, less the page's 24px foot (`py-6`)
 * and the card's 1px border. The top is measured from the start of the
 * page, not the window, so the cap holds still while the page scrolls: a
 * cap that grew as the list's top rose would grow the page with it. Read
 * again when `main` resizes (the window) or the page does (an upload's
 * note above the list).
 */
function useFillPage(on: boolean) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const page = el?.closest("main");
    if (!on || !el || !page) return;
    const fit = () => {
      const top =
        el.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop;
      el.style.setProperty("--fill-height", `${Math.round(page.clientHeight - top - 25)}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(page);
    if (page.firstElementChild) observer.observe(page.firstElementChild);
    return () => observer.disconnect();
  }, [on, el]);
  return setEl;
}

/**
 * One group of the list (KAN-404), as Notion's Group by draws one: a
 * heading with the group's name in a pill (`Badge`, brand, the same for
 * every group) and how many of its resumes the search and the filters
 * leave, then its cards. The heading is a button that folds the group away
 * and back (`aria-expanded`), and it sticks to the top of the scrolling
 * list while its cards scroll under it, until the next group's heading
 * pushes it off, on the panel's own white so the cards scrolling under it
 * do not show through. It sits on z-20, over the cards' own z-10 (their
 * icons, lifted over the stretched link): on the same z-10 the icons came
 * later and painted over the heading as they scrolled under it. The name
 * was grey capitals in the sidebar's caption style at first, which read
 * faint beside the grey cards.
 */
export function ResumeGroup({
  label,
  count,
  open,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="bg-panel text-note text-ink-meta hover:text-ink focus-visible:ring-brand-ring sticky top-0 z-20 flex w-full items-center gap-2 rounded-xs pt-3 pb-1 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
      >
        <ChevronDownIcon
          className={cn("size-3.5 transition-transform duration-150", !open && "-rotate-90")}
        />
        <Badge>{label}</Badge>
        <span className="tabular-nums">{count}</span>
      </button>
      <ul id={id} role="list" hidden={!open}>
        {children}
      </ul>
    </li>
  );
}
