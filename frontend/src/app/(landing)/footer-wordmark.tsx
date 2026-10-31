"use client";

import * as React from "react";
import { useReducedMotion } from "motion/react";

import { LOGO_WORD } from "@/components/logo";
import { cn } from "@/lib/cn";

import { stages } from "./board-data";
import { streams } from "./data";
import { followedJob, matchingFeature } from "./feature-data";
import { useArrived, useMediaQuery } from "./hooks";

/**
 * The footer's closing mark: "workit", the logo's own word outline, set
 * large and filled with rows of tiny job titles, the ones the page has
 * shown (the board's, Matching's and the hiring-systems stream's), with
 * the followed application's in violet. From lg up, once the word is well
 * on screen, the rows slide in from alternate sides, middle rows first,
 * and settle into the word, so the page's postings end as the name. They
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

const TITLES = [
  ...new Set([
    ...stages.flatMap((stage) => stage.jobs.map((job) => job.title)),
    ...matchingFeature.jobs.map((job) => job.title),
    ...Object.values(streams).flatMap((list) => list.map((posting) => posting.title)),
  ]),
];

/** A row's titles: the list turned by a step per row, long enough to fill
 * the word with room to slide. */
function rowTitles(row: number) {
  const turned = [...TITLES.slice((row * 7) % TITLES.length), ...TITLES];
  const list: string[] = [];
  let length = 0;
  for (const title of [...turned, ...turned]) {
    if (length > 420) break;
    list.push(title);
    length += title.length + 3;
  }
  return list;
}

export function FooterWordmark() {
  const ref = React.useRef<HTMLDivElement>(null);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const reduceMotion = useReducedMotion();
  const moving = isDesktop === true && !reduceMotion;
  // In once 60% of the word shows, a point every window reaches (a line a
  // third up the screen was out of reach on a tall one, and the word stayed
  // empty); out only once it is wholly below the screen.
  const arrived = useArrived(ref, moving, { margin: "0px", threshold: 0.6 });
  const rows = React.useMemo(() => Array.from({ length: ROWS }, (_, i) => rowTitles(i)), []);

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
        {rows.map((titles, i) => (
          <Row key={i} index={i} titles={titles} arrived={arrived} moving={moving} />
        ))}
      </div>
    </div>
  );
}

function Row({
  index,
  titles,
  arrived,
  moving,
}: {
  index: number;
  titles: string[];
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
        className={cn("w-max", moving && "wordmark-drift")}
        style={{ animationDirection: index % 2 ? "reverse" : undefined }}
      >
        {[...titles, ...titles].map((title, k) => (
          <span
            key={k}
            className={
              title === followedJob.title ? "text-landing-brand-200 font-semibold" : "text-white/60"
            }
          >
            {title}
            {"  ·  "}
          </span>
        ))}
      </div>
    </div>
  );
}
