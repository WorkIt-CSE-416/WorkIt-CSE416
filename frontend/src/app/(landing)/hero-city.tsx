"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { cn } from "@/lib/cn";

import {
  buildCity,
  STRIP_HEIGHT,
  STRIP_TOP,
  STRIP_WIDTH,
  type City,
  type Piece,
} from "./city-model";
import { useMediaQuery } from "./hooks";
import { scoreTone } from "./score-tone";

// Below Tailwind's sm a phone gets its own, larger city (city-model.ts,
// buildCity's `phone`, and the width in landing.css).
const PHONE_QUERY = "(width < 40rem)";

// Each build once per page load: the model is deterministic, so every
// render draws the same city.
const cached = new Map<boolean, City>();
const getCity = (phone: boolean) => {
  let city = cached.get(phone);
  if (!city) cached.set(phone, (city = buildCity({ phone })));
  return city;
};

const vars = (values: Record<string, string | number>) => values as CSSProperties;

const VIEW_BOX = `0 ${STRIP_TOP} ${STRIP_WIDTH} ${STRIP_HEIGHT}`;

/**
 * The buildings' look: their colours and line weights. One source for both
 * kinds of layer below: written into each still image, which landing.css
 * cannot reach (an image is a document of its own), and into the page
 * under `.hero-city` for the live layers. The live-only parts (the ground
 * grid, streaks, pools and wireframes) and every animation stay in
 * landing.css.
 */
const LOOK: [selector: string, rules: string][] = [
  [
    "",
    "--top:#fff;--left:#e1d9f6;--right:#eee9fd;--edge:rgb(76 39 163/.17);--hi:rgb(109 63 216/.32);--floor:rgb(76 39 163/.09);--pier:rgb(76 39 163/.16);--spire:#aaa4b8;--holo:#6d3fd8",
  ],
  [".tone-stone", "--top:#fffdf9;--left:#e6dee9;--right:#f3eef4"],
  [".tone-peri", "--top:#f8f8ff;--left:#d6d8f5;--right:#e7e9fd"],
  [".tone-glass", "--top:#f5f4fb;--left:#d6d2ea;--right:#e7e4f4"],
  [".tone-deep", "--top:#f3f0f5;--left:#d8d1df;--right:#e7e2ec"],
  [".t", "fill:var(--top)"],
  [".l", "fill:var(--left)"],
  [".r", "fill:var(--right)"],
  [".fl", "fill:none;stroke:var(--floor);stroke-width:.8"],
  [".pi", "fill:none;stroke:var(--pier);stroke-width:1"],
  [".e", "fill:none;stroke:var(--edge);stroke-width:1;stroke-linejoin:round"],
  [".hi", "fill:none;stroke:var(--hi);stroke-width:1"],
  [".sp", "fill:none;stroke:var(--spire);stroke-width:1.4;stroke-linecap:round"],
];
const lookCss = (scope: string) =>
  LOOK.map(([selector, rules]) => `${scope}${selector ? ` ${selector}` : ""}{${rules}}`).join("");

/** A building's solid parts, back to front. */
const SOLID = ["l", "r", "t", "fl", "pi", "e", "hi", "sp"] as const;

/** Still pieces as one SVG document, for an image. */
function stillSvg(pieces: Piece[]) {
  const body = pieces
    .map(
      (piece) =>
        `<g class="tone-${piece.tone}"${piece.op < 1 ? ` opacity="${piece.op}"` : ""}>${SOLID.map(
          (part) => (piece[part] ? `<path class="${part}" d="${piece[part]}"/>` : ""),
        ).join("")}</g>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW_BOX}"><style>${lookCss("svg")}</style>${body}</svg>`;
}

/**
 * The city as layers, back to front: runs of still pieces, each drawn as
 * one image, and between them the pieces that move (the towers that turn
 * into wireframes, and the pulsing wireframes), live. Split where they move
 * in the draw order, so every building in front of a tower stays in front.
 * One SVG of some 5,700 paths made every repaint of the page slow (Chrome
 * re-layers the page's whole paint each frame, about 12ms on an M1 while
 * the city was within reach of the screen); an image is one item to it,
 * whatever it draws (KAN-368). Blob URLs, made once per build and kept for
 * the page's life, like the build.
 */
type Layer = { still: string } | { live: { piece: Piece; index: number }[] };
const layersCache = new Map<boolean, Layer[]>();
function getLayers(phone: boolean) {
  const known = layersCache.get(phone);
  if (known) return known;
  const layers: Layer[] = [];
  let still: Piece[] = [];
  let live: { piece: Piece; index: number }[] = [];
  const flush = () => {
    if (still.length) {
      const blob = new Blob([stillSvg(still)], { type: "image/svg+xml" });
      layers.push({ still: URL.createObjectURL(blob) });
    }
    if (live.length) layers.push({ live });
    still = [];
    live = [];
  };
  getCity(phone).pieces.forEach((piece, index) => {
    if (piece.mode) {
      if (still.length) flush();
      live.push({ piece, index });
    } else {
      if (live.length) flush();
      still.push(piece);
    }
  });
  flush();
  layersCache.set(phone, layers);
  return layers;
}

/** Room kept between a job card and the panel's sides, and the text. */
const EDGE = 16;
const TEXT_GAP = 10;

/**
 * Where each job card can show: its horizontal nudge in px to stay inside
 * the panel, or null when it cannot fit (its tower is cropped off, or the
 * card would cover the text). Measured in the browser, since what fits
 * depends on the window: the strip keeps its 1600px scale from lg up and is
 * cropped at the sides, while the text keeps its own size. The text is the
 * panel's [data-hero-text] line boxes and its [data-hero-box] children.
 */
function placeCards(root: HTMLElement, panel: HTMLElement) {
  const pr = panel.getBoundingClientRect();
  const cr = root.getBoundingClientRect();
  const text: DOMRect[] = [];
  // Each run of text on its own: a block child's box spans the full width,
  // which once hid every card beside the headline.
  panel.querySelectorAll<HTMLElement>("[data-hero-text]").forEach((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      text.push(...Array.from(range.getClientRects()));
    }
  });
  panel
    .querySelectorAll<HTMLElement>("[data-hero-box] > *")
    .forEach((el) => text.push(el.getBoundingClientRect()));

  const placement: Record<string, number | null> = {};
  root.querySelectorAll<HTMLElement>("[data-tag]").forEach((el) => {
    const card = el.querySelector<HTMLElement>("[data-card]");
    const company = el.dataset.tag;
    if (!card || !company) return;
    // The card's anchor is the tower's tip; it sits above it, centred.
    const ax = cr.left + (parseFloat(el.style.left) / 100) * cr.width;
    const ay = cr.top + (parseFloat(el.style.top) / 100) * cr.height;
    const w = card.offsetWidth;
    const bottom = ay - (el.offsetHeight - card.offsetHeight);
    const top = bottom - card.offsetHeight;
    const wanted = ax - w / 2;
    const left = Math.min(Math.max(wanted, pr.left + EDGE), pr.right - EDGE - w);
    const dx = left - wanted;
    const towerShown = ax > pr.left + EDGE && ax < pr.right - EDGE && top > pr.top + EDGE;
    // A nudge past half the card would leave the connector beside it.
    const connected = Math.abs(dx) <= w / 2 - 16;
    const clearOfText = text.every(
      (t) =>
        left + w + TEXT_GAP <= t.left ||
        left - TEXT_GAP >= t.right ||
        bottom + TEXT_GAP <= t.top ||
        top - TEXT_GAP >= t.bottom,
    );
    placement[company] = towerShown && connected && clearOfText ? Math.round(dx) : null;
  });
  return placement;
}

/**
 * The hero's animated city (city-model.ts): the ground, then the layers of
 * `getLayers`, drawn only after hydration: rendered on the server it would
 * add hundreds of KB of path data to the page. It shows once its images
 * have loaded, so the towers never stand alone on bare ground. The job tags
 * are HTML over it, placed in percent of the strip so they track it as it
 * scales, and shown only where they fit (placeCards). Styles and animations
 * are `LOOK` and the .hero-city rules in landing.css.
 */
export function HeroCity() {
  // Null on the server and until the first effect, so the city still draws
  // only after hydration, and a phone never builds the wide one first.
  const phone = useMediaQuery(PHONE_QUERY);
  const rootRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Record<string, number | null>>({});
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    const root = rootRef.current;
    const panel = root?.parentElement;
    if (!root || !panel) return;
    const place = () => setPlacement(placeCards(root, panel));
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    // The window too: the text can rewrap without the panel resizing.
    window.addEventListener("resize", place);
    // Again once the text has finished rising into place.
    const settle = window.setTimeout(place, 1000);
    // Its loops stop while it is off screen (landing.css).
    const seen = new IntersectionObserver(([entry]) =>
      root.toggleAttribute("data-paused", !entry.isIntersecting),
    );
    seen.observe(root);
    return () => {
      seen.disconnect();
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.clearTimeout(settle);
    };
  }, [phone]);

  if (phone === null) return null;
  const city = getCity(phone);
  const layers = getLayers(phone);
  const ready = layers.every((layer) => !("still" in layer) || loaded.has(layer.still));

  return (
    <div ref={rootRef} className="hero-city" data-ready={ready ? "" : undefined} aria-hidden="true">
      <style>{lookCss(".hero-city")}</style>
      <svg viewBox={VIEW_BOX}>
        <defs>
          {/* The ground fades out towards the text above it. */}
          <linearGradient
            id="hero-city-fade"
            x1="0"
            y1="50"
            x2="0"
            y2="240"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="1" />
          </linearGradient>
          <mask
            id="hero-city-ground"
            maskUnits="userSpaceOnUse"
            x="0"
            y={STRIP_TOP}
            width={STRIP_WIDTH}
            height={STRIP_HEIGHT}
          >
            <rect
              y={STRIP_TOP}
              width={STRIP_WIDTH}
              height={STRIP_HEIGHT}
              fill="url(#hero-city-fade)"
            />
          </mask>
          <radialGradient id="hero-city-pool">
            <stop offset="0" stopColor="#6d3fd8" stopOpacity="0.5" />
            <stop offset="1" stopColor="#6d3fd8" stopOpacity="0" />
          </radialGradient>
          {/* The wireframes' glow, for every live layer below. */}
          <filter id="hero-city-glow" x="-60%" y="-10%" width="220%" height="120%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g mask="url(#hero-city-ground)">
          <path className="grid" d={city.grid} />
          {city.streaks.map((d, i) => (
            <path
              key={d}
              className="streak"
              d={d}
              pathLength={1000}
              style={vars({ "--sd": `${-i * 2.25}s` })}
            />
          ))}
        </g>

        {city.glows.map((glow) => (
          <ellipse
            key={glow.delay}
            className="pool"
            cx={glow.x}
            cy={glow.y}
            rx="60"
            ry="22"
            fill="url(#hero-city-pool)"
            style={vars({ "--md": glow.delay })}
          />
        ))}
      </svg>

      {layers.map((layer) =>
        "still" in layer ? (
          // eslint-disable-next-line @next/next/no-img-element -- a blob URL of an SVG made in the browser, which next/image cannot load
          <img
            key={layer.still}
            src={layer.still}
            alt=""
            draggable={false}
            onLoad={() => setLoaded((had) => new Set(had).add(layer.still))}
          />
        ) : (
          <svg key={layer.live[0].index} viewBox={VIEW_BOX}>
            {layer.live.map(({ piece, index }) => (
              <g
                // The model is fixed, so a piece's index is a stable key.
                key={index}
                className={cn(`tone-${piece.tone}`, piece.mode)}
                style={vars({ opacity: piece.op, "--md": piece.delay })}
              >
                {SOLID.map((part) =>
                  piece[part] ? <path key={part} className={part} d={piece[part]} /> : null,
                )}
                {piece.we && (
                  <g className="wire" filter="url(#hero-city-glow)">
                    <path className="wf" d={piece.wf} />
                    <path className="wl" d={piece.wl} />
                    <path className="we" d={piece.we} pathLength={1} />
                  </g>
                )}
              </g>
            ))}
          </svg>
        ),
      )}

      {/* Hidden (but still measured) where a card does not fit. Until the
          first measurement, none shows. */}
      {city.tags.map((tag) => (
        <div
          key={tag.company}
          data-tag={tag.company}
          className={cn("tag", typeof placement[tag.company] !== "number" && "invisible")}
          style={vars({
            left: `${(tag.x / STRIP_WIDTH) * 100}%`,
            top: `${((tag.y - STRIP_TOP) / STRIP_HEIGHT) * 100}%`,
            "--md": tag.delay,
          })}
        >
          <div className="flex flex-col items-center">
            <div
              data-card
              style={{ transform: `translateX(${placement[tag.company] ?? 0}px)` }}
              className="glass-card text-ink flex items-center gap-2.5 rounded-xl py-2 pr-2.5 pl-2 whitespace-nowrap"
            >
              {/* The company's own logo, from the favicon service the
                  hiring-system tiles use. */}
              <span className="flex size-[26px] items-center justify-center rounded-[7px] bg-white shadow-[inset_0_0_0_1px_rgba(76,39,163,0.12)]">
                <Image
                  src={`https://www.google.com/s2/favicons?domain=${tag.domain}&sz=64`}
                  alt=""
                  unoptimized
                  width={18}
                  height={18}
                  className="size-[18px] rounded-[4px]"
                />
              </span>
              <span className="flex flex-col text-left">
                <span className="text-xs font-semibold">{tag.title}</span>
                <span className="text-ink-muted text-[11px]">{tag.company}</span>
              </span>
              <span
                className={cn(
                  "rounded-md px-[7px] py-0.5 text-[11px] font-bold shadow-[inset_0_1px_0_rgb(255_255_255/0.8)] ring-1 ring-inset",
                  scoreTone(tag.score),
                )}
              >
                {tag.score}%
              </span>
            </div>
            <span className="h-[22px] w-px bg-linear-to-b from-[#6d3fd8] to-transparent" />
            <span className="size-[5px] rounded-full bg-[#6d3fd8]" />
          </div>
        </div>
      ))}
    </div>
  );
}
