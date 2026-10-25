"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { cn } from "@/lib/cn";

import { buildCity, STRIP_HEIGHT, STRIP_TOP, STRIP_WIDTH, type City } from "./city-model";
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
 * The hero's animated city (city-model.ts). One SVG of about a thousand
 * small pieces, drawn only after hydration: rendered on the server it would
 * add hundreds of KB of path data to the page. The job tags are HTML over
 * the SVG, placed in percent of the strip so they track it as it scales,
 * and shown only where they fit (placeCards). Styles and animations are the
 * .hero-city rules in landing.css.
 */
export function HeroCity() {
  // Null on the server and until the first effect, so the city still draws
  // only after hydration, and a phone never builds the wide one first.
  const phone = useMediaQuery(PHONE_QUERY);
  const rootRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Record<string, number | null>>({});

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

  return (
    <div ref={rootRef} className="hero-city" aria-hidden="true">
      <svg viewBox={`0 ${STRIP_TOP} ${STRIP_WIDTH} ${STRIP_HEIGHT}`}>
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

        {city.pieces.map((piece, i) => (
          <g
            // The model is fixed, so a piece's index is a stable key.
            key={i}
            className={cn(`tone-${piece.tone}`, piece.mode)}
            style={vars({ opacity: piece.op, "--md": piece.delay })}
          >
            {piece.l && <path className="l" d={piece.l} />}
            {piece.r && <path className="r" d={piece.r} />}
            {piece.t && <path className="t" d={piece.t} />}
            {piece.fl && <path className="fl" d={piece.fl} />}
            {piece.pi && <path className="pi" d={piece.pi} />}
            {piece.e && <path className="e" d={piece.e} />}
            {piece.hi && <path className="hi" d={piece.hi} />}
            {piece.sp && <path className="sp" d={piece.sp} />}
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
