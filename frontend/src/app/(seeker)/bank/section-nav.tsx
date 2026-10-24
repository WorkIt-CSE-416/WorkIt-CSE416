"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";

import { cn } from "@/lib/cn";

import { SEEKER_BLEED, SEEKER_GUTTER } from "../gutter";

/** How long a click's glide may run before its link is parked, for a
 *  browser with no `scrollend`, which parks it as the glide ends. */
const GLIDE_MS = 1500;

/**
 * The bank's sections as one row of links (KAN-349): a click glides the page
 * to that section's card, and the link of the section in view is lit, so a
 * student with a long bank can jump from Education to Skills and see where
 * they are. Each link carries how many items the section shows under the
 * current resume pick.
 *
 * It sticks to the top of the shell's <main>, the one thing that scrolls,
 * drawn as the Jobs page's FeedHeader is: the panel's white across the
 * page's gutters (SEEKER_BLEED), so the cards vanish under it, and a
 * hairline under it once the cards scroll beneath. The section cards'
 * `scroll-mt-16` leaves room for it, so a jump (or Scout's scroll) lands a
 * card's heading just under the row, not behind it.
 *
 * One row at every width, so its height (and the cards' scroll margin) never
 * changes: where the links do not fit, the row scrolls sideways, fades at the
 * end with more links past it, and keeps the lit link in view. The links
 * look like the design kit's index (a brand tint on the current one), the
 * way the left panel marks where you are.
 *
 * The lit section is the last one whose top has reached the view's top
 * third, or the last section once the page is at its foot, since a short
 * Skills card never reaches the top. A click lights its link at once and
 * holds it through the glide and until the student scrolls on: lit by the
 * scroll, the links in between flickered, and a click on Certifications,
 * whose card cannot reach the top, ended with Skills lit.
 */
export function SectionNav({
  sections,
}: {
  sections: readonly { id: string; label: string; count: number }[];
}) {
  const navRef = useRef<HTMLElement>(null);
  const rowRef = useRef<HTMLUListElement>(null);
  const [current, setCurrent] = useState(sections[0]?.id);
  const [stuck, setStuck] = useState(false);
  // Whether links run past the row's start or end, which then fades out.
  const [more, setMore] = useState({ start: false, end: false });
  // The clicked section, lit whatever the scroll says: `at` is null while
  // the glide runs, then where it ended, until the page moves from there.
  const held = useRef<{ id: string; at: number | null } | null>(null);
  // Stops waiting for the last click's glide to end.
  const stopWaiting = useRef(() => {});
  const ids = sections.map((s) => s.id).join(",");

  useEffect(() => {
    const nav = navRef.current;
    const scroller = nav?.closest("main");
    if (!nav || !scroller) return;

    const check = () => {
      // Measured from inside the <main>'s border, where a sticky top counts from.
      const top = scroller.getBoundingClientRect().top + scroller.clientTop;
      setStuck(scroller.scrollTop > 0 && nav.getBoundingClientRect().top - top <= 0.5);
      if (held.current) {
        const { id, at } = held.current;
        if (at === null || Math.abs(scroller.scrollTop - at) <= 2) return setCurrent(id);
        held.current = null;
      }
      const list = ids.split(",");
      const atFoot = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      let lit = list[0];
      for (const id of list) {
        const card = document.getElementById(`section-${id}`);
        if (!card) continue;
        // A card counts once its top is in the view's top third, or where a
        // jump lands it (its scroll margin, with 1px of slack) if lower.
        const landing = top + parseFloat(getComputedStyle(card).scrollMarginTop) + 1;
        const line = Math.max(landing, top + scroller.clientHeight / 3);
        if (card.getBoundingClientRect().top <= line) lit = id;
      }
      setCurrent(atFoot && scroller.scrollTop > 0 ? list[list.length - 1] : lit);
    };
    check();
    scroller.addEventListener("scroll", check, { passive: true });
    return () => scroller.removeEventListener("scroll", check);
  }, [ids]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const edges = () =>
      setMore({
        start: row.scrollLeft > 1,
        end: row.scrollLeft + row.clientWidth < row.scrollWidth - 1,
      });
    // Fires once on observe too, so this is also the first measure.
    const resize = new ResizeObserver(edges);
    resize.observe(row);
    row.addEventListener("scroll", edges, { passive: true });
    return () => {
      resize.disconnect();
      row.removeEventListener("scroll", edges);
    };
  }, []);

  // On a phone the row scrolls sideways: bring the lit link into it. Only
  // the row moves; scrollIntoView would stop the page's own glide.
  useEffect(() => {
    const row = rowRef.current;
    const link = row?.querySelector<HTMLElement>(`[data-section="${current}"]`);
    if (!row || !link) return;
    const left = link.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + link.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollTo({ left: left - 8 });
    }
  }, [current]);

  function jump(event: MouseEvent<HTMLAnchorElement>, id: string) {
    const card = document.getElementById(`section-${id}`);
    const scroller = navRef.current?.closest("main");
    if (!card || !scroller) return;
    event.preventDefault();
    stopWaiting.current();
    setCurrent(id);
    held.current = { id, at: null };
    const park = () => {
      stopWaiting.current();
      if (held.current?.id === id) held.current.at = scroller.scrollTop;
    };
    const timer = setTimeout(park, GLIDE_MS);
    scroller.addEventListener("scrollend", park);
    stopWaiting.current = () => {
      clearTimeout(timer);
      scroller.removeEventListener("scrollend", park);
      stopWaiting.current = () => {};
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }

  return (
    <nav
      ref={navRef}
      aria-label="Experience Sections"
      data-stuck={stuck || undefined}
      className={cn(
        "bg-panel sticky top-0 z-10 -my-2 py-2",
        "after:bg-border-subtle after:absolute after:inset-x-0 after:bottom-0 after:h-px after:opacity-0 after:transition-opacity after:duration-200 data-stuck:after:opacity-100",
        SEEKER_BLEED,
        SEEKER_GUTTER,
      )}
    >
      <ul
        ref={rowRef}
        role="list"
        // A touch screen swipes the row, so it needs no bar; a mouse
        // needs one, with room under the links.
        className="scrollbar-quiet flex gap-1 overflow-x-auto pb-1 pointer-coarse:[scrollbar-width:none] pointer-coarse:pb-0"
        style={{ maskImage: fade(more) }}
      >
        {sections.map(({ id, label, count }) => {
          const lit = id === current;
          return (
            <li key={id} className="shrink-0">
              <a
                href={`#section-${id}`}
                data-section={id}
                aria-current={lit ? "location" : undefined}
                onClick={(e) => jump(e, id)}
                className={cn(
                  "text-label focus-visible:ring-brand-ring rounded-control flex items-center gap-1.5 px-2.5 py-1.5 whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
                  lit ? "bg-brand-tint text-brand" : "text-ink-meta hover:bg-well hover:text-ink",
                )}
              >
                {label}
                <span className="font-normal tabular-nums">
                  {count}
                  <span className="sr-only"> {count === 1 ? "item" : "items"}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The row's mask: 32px of fade at each end with more links past it. */
function fade({ start, end }: { start: boolean; end: boolean }) {
  if (!start && !end) return undefined;
  const from = start ? "transparent, black 32px" : "black";
  const to = end ? "black calc(100% - 32px), transparent" : "black";
  return `linear-gradient(to right, ${from}, ${to})`;
}
