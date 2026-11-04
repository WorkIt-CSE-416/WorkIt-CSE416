"use client";

import * as React from "react";
import { useReducedMotion } from "motion/react";

import { LOGO_WORD } from "@/components/logo";
import { cn } from "@/lib/cn";

import { useArrived, useMediaQuery } from "./hooks";

/**
 * The footer's closing mark: "workit", the logo's own word outline, set
 * large and filled with rows of tiny job titles, the ones the page has
 * shown, with the followed application's in violet (`titles` and
 * `followed`, read by footer.tsx on the server: imported here, the three
 * data files they come from loaded on every marketing page). From lg up,
 * once the word is well on screen, the rows slide in from alternate
 * sides, middle rows first, and settle into the word, so the page's
 * postings end as the name. They
 * play in time (CSS transitions): scrubbed by the scroll they rested half
 * slid whenever the reader stopped (scene-time.ts). Below lg and with
 * reduced motion they sit in place. Decorative: the footer's logo already
 * names the product.
 *
 * The rows are HTML under a CSS mask of the outline, moved by `transform`
 * and `opacity` only, so the browser runs them on its own layer. They were
 * SVG text under a clip path, which the browser never moves on its own
 * layer: the whole full-width word, some 12,000 glyphs, repainted on every
 * frame.
 */

// Tailwind's lg breakpoint: animated from here up.
const DESKTOP_QUERY = "(min-width: 64rem)";
/** The word's ink box inside the logo's 289 × 91 box. */
const VIEW = { x: 0, y: 3, w: 289, h: 77 };
/** Each row's height and type size, in the logo's units. */
const ROW_H = 2.7;
const FONT = 2.15;
const ROWS = Math.ceil(VIEW.h / ROW_H);

/** The outline as a mask, stretched over the box (which keeps its ratio). */
const MASK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}" preserveAspectRatio="none"><path d="${LOGO_WORD.d}"/></svg>`,
)}")`;
/** A row's slide, in the logo's units, as a share of the box's width (a
 * row is as wide as the box). */
const slide = (units: number) => `translateX(${(units / VIEW.w) * 100}%)`;
/** Where every row rests: what it shows below lg and with reduced motion. */
const REST = slide(-30);

/** A row's titles: the list turned by a step per row, long enough to fill
 * the word with room to slide. */
function rowTitles(titles: readonly string[], row: number) {
  const turned = [...titles.slice((row * 7) % titles.length), ...titles];
  const list: string[] = [];
  let length = 0;
  for (const title of [...turned, ...turned]) {
    if (length > 420) break;
    list.push(title);
    length += title.length + 3;
  }
  return list;
}

/**
 * A row's track: its titles twice, as runs of plain text, with only the
 * followed title in an element of its own. A span per title made the
 * wordmark about 950 of the 1,400 elements on a legal page, each styled,
 * laid out and hydrated on every marketing page. `nowrap` collapses the
 * spaces round each dot across the runs as it did across the spans.
 */
function track(titles: string[], followed: string) {
  const parts: React.ReactNode[] = [];
  let run = "";
  for (const title of [...titles, ...titles]) {
    if (title !== followed) {
      run += `${title}  ·  `;
      continue;
    }
    if (run) parts.push(run);
    run = "";
    parts.push(
      <span key={parts.length} className="text-landing-brand-200 font-semibold">
        {`${title}  ·  `}
      </span>,
    );
  }
  if (run) parts.push(run);
  return parts;
}

export function FooterWordmark({
  titles,
  followed,
}: {
  titles: readonly string[];
  followed: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const reduceMotion = useReducedMotion();
  const moving = isDesktop === true && !reduceMotion;
  // In once 60% of the word shows, a point every window reaches (a line a
  // third up the screen was out of reach on a tall one, and the word stayed
  // empty); out only once it is wholly below the screen.
  const arrived = useArrived(ref, moving, { margin: "0px", threshold: 0.6 });
  const rows = React.useMemo(
    () => Array.from({ length: ROWS }, (_, i) => track(rowTitles(titles, i), followed)),
    [titles, followed],
  );

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="select-none"
      // The rows drift only while the word is on screen (landing.css).
      data-paused={arrived ? undefined : ""}
    >
      {/* The letters' body, faint, so the word reads between the rows. */}
      <div
        className="@container relative w-full overflow-hidden bg-white/5 font-medium"
        style={{
          aspectRatio: `${VIEW.w} / ${VIEW.h}`,
          maskImage: MASK,
          WebkitMaskImage: MASK,
          maskSize: "100% 100%",
          WebkitMaskSize: "100% 100%",
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          fontSize: `${(FONT / VIEW.w) * 100}cqw`,
          lineHeight: ROW_H / FONT,
        }}
      >
        {rows.map((parts, i) => (
          <Row key={i} index={i} parts={parts} arrived={arrived} moving={moving} />
        ))}
      </div>
    </div>
  );
}

function Row({
  index,
  parts,
  arrived,
  moving,
}: {
  index: number;
  parts: React.ReactNode[];
  arrived: boolean;
  moving: boolean;
}) {
  // Alternate rows come from alternate sides, a little apart, so the word
  // fills from the middle rows outward.
  const side = index % 2 ? 1 : -1;
  const delay = (Math.abs(index - ROWS / 2) / ROWS) * 0.9;
  const resting = !moving || arrived;

  return (
    <div
      className={cn("absolute left-0 w-full whitespace-nowrap", moving && "will-change-transform")}
      style={{
        top: `${((index * ROW_H) / VIEW.h) * 100}%`,
        transform: resting ? REST : slide(side * 90 - 30),
        opacity: resting ? 1 : 0.15,
        transition: moving
          ? `transform 1.6s cubic-bezier(0.22, 1, 0.36, 1) ${delay}s, opacity 1.2s ease-out ${delay}s`
          : undefined,
      }}
    >
      {/* Once settled, the row keeps drifting slowly, alternate rows the
          other way, so the word never stands still (`.wordmark-drift`): a
          track of the titles twice, moved by half its width, loops with
          no seam. The followed application's title, in the brand's pale
          violet and a weight up, can be found among the rest. */}
      <div
        className={cn("w-max text-white/60", moving && "wordmark-drift")}
        style={{ animationDirection: index % 2 ? "reverse" : undefined }}
      >
        {parts}
      </div>
    </div>
  );
}
