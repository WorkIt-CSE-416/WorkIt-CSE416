"use client";

import * as React from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";

import { LOGO_WORD } from "@/components/logo";

import { stages } from "./board-data";
import { streams } from "./data";
import { followedJob, matchingFeature } from "./feature-data";
import { useMediaQuery } from "./hooks";

/**
 * The footer's closing mark: "workit", the logo's own word outline, set
 * large and filled with rows of tiny job titles, the ones the page has
 * shown (the board's, Matching's and the hiring-systems stream's), with
 * the followed application's in violet. From lg up the rows slide in from
 * alternate sides as the footer comes up and settle into the word, so the
 * page's postings end as the name; below lg and with reduced motion they
 * sit in place. Decorative: the footer's logo already names the product.
 */

// Tailwind's lg breakpoint: animated from here up.
const DESKTOP_QUERY = "(min-width: 64rem)";
/** The word's ink box inside the logo's 289 × 91 box. */
const VIEW = { x: 0, y: 3, w: 289, h: 77 };
/** Each row's height and type size, in the logo's units. */
const ROW_H = 2.7;
const FONT = 2.15;
const ROWS = Math.ceil(VIEW.h / ROW_H);

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

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const out = (t: number) => 1 - Math.pow(1 - t, 3);

export function FooterWordmark() {
  const ref = React.useRef<HTMLDivElement>(null);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const reduceMotion = useReducedMotion();
  const moving = isDesktop === true && !reduceMotion;
  // 0 as the word's top meets the screen's foot, 1 once its foot is in.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end end"] });
  // Settled: what the rows show below lg and with reduced motion.
  const settled = useMotionValue(1);
  const rows = React.useMemo(() => Array.from({ length: ROWS }, (_, i) => rowTitles(i)), []);

  return (
    <div ref={ref} aria-hidden="true" className="select-none">
      <svg
        viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
        className="block h-auto w-full overflow-visible"
      >
        <defs>
          <clipPath id="footer-wordmark">
            <path d={LOGO_WORD.d} />
          </clipPath>
        </defs>
        {/* The letters' body, faint, so the word reads between the rows. */}
        <path d={LOGO_WORD.d} fill="white" fillOpacity={0.05} />
        <g clipPath="url(#footer-wordmark)" fontSize={FONT} fontWeight={500}>
          {rows.map((titles, i) => (
            <Row key={i} index={i} titles={titles} p={moving ? scrollYProgress : settled} />
          ))}
        </g>
      </svg>
    </div>
  );
}

function Row({ index, titles, p }: { index: number; titles: string[]; p: MotionValue<number> }) {
  // Alternate rows come from alternate sides, a little apart, so the word
  // fills from the middle rows outward.
  const side = index % 2 ? 1 : -1;
  const from = Math.abs(index - ROWS / 2) / ROWS;
  const at = (v: number) => out(clamp((v - from * 0.5) / 0.5));
  const x = useTransform(p, (v) => side * 90 * (1 - at(v)) - 30);
  const opacity = useTransform(p, (v) => 0.15 + 0.85 * at(v));

  return (
    <motion.text y={VIEW.y + (index + 0.8) * ROW_H} style={{ x, opacity }}>
      {titles.map((title, k) => (
        <tspan
          key={k}
          fill={title === followedJob.title ? "#b9a3f5" : "white"}
          fillOpacity={title === followedJob.title ? 0.95 : 0.6}
        >
          {title}
          {"  ·  "}
        </tspan>
      ))}
    </motion.text>
  );
}
