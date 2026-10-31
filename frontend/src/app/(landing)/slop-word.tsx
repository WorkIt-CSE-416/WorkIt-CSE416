"use client";

import * as React from "react";

/**
 * "Slop" in the statement's headline, drawn as AI slop: an oversaturated
 * magenta-to-cyan gradient with a pink glow, a gloss that sweeps across,
 * sparkles that twinkle, and goo that drips off the letters (KAN-368). It
 * replaced a red spell-checker wave the team found too plain. The word is
 * still text for screen readers and copying; the drawing is hidden from
 * them.
 *
 * Drawn at the headline's size: the SVG's 64-unit type is 1em, so it
 * scales with the clamp. The drips are blurred into the letters (`goo`),
 * and each stretches and falls back on a loop (`.slop-*` in landing.css),
 * shorter where the headline has less room under it (`--reach`). They
 * stop while the statement is off screen (`data-paused`) and with reduced
 * motion.
 */

/** Each drip: where it leaves the letter (x, top), its width and full
 * length, in the SVG's units, and its delay. Under S, l, o and p. */
const DRIPS = [
  { x: 15, top: 54, w: 9, len: 62, delay: "0s" },
  { x: 44, top: 54, w: 7, len: 44, delay: "-1.3s" },
  { x: 72, top: 56, w: 10, len: 78, delay: "-0.6s" },
  { x: 106, top: 72, w: 8, len: 52, delay: "-2.2s" },
] as const;

/** Four-point sparkles: centre, outer radius, delay. */
const SPARKS = [
  { x: 138, y: 7, r: 13, delay: "0s" },
  { x: -10, y: 38, r: 8, delay: "-0.7s" },
  { x: 92, y: -6, r: 8, delay: "-1.2s" },
] as const;

const sparkle = (x: number, y: number, r: number) => {
  const k = r * 0.23;
  return `M${x} ${y - r}L${x + k} ${y - k}L${x + r} ${y}L${x + k} ${y + k}L${x} ${y + r}L${x - k} ${y + k}L${x - r} ${y}L${x - k} ${y - k}Z`;
};

export function SlopWord() {
  // One set of ids per mount; React's own has characters url(#…) refuses.
  const id = `slop${React.useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const word = (
    <text x="0" y="61" fontSize="64" fontWeight="800" letterSpacing="-2">
      Slop
    </text>
  );
  return (
    <span className="slop-goo">
      <span className="sr-only">Slop</span>
      <svg aria-hidden="true" viewBox="0 0 141 69" className="slop-goo-art">
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff4fd8" />
            <stop offset="0.5" stopColor="#7b5cff" />
            <stop offset="1" stopColor="#3ef0ff" />
          </linearGradient>
          <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.85" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <filter id={`${id}-goo`} x="-20%" y="-20%" width="140%" height="260%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3.2" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
          <filter id={`${id}-glow`} x="-30%" y="-30%" width="160%" height="280%">
            <feDropShadow dx="0" dy="0" stdDeviation="7" floodColor="#ff4fd8" floodOpacity="0.65" />
          </filter>
          <clipPath id={`${id}-clip`}>{word}</clipPath>
        </defs>
        <g filter={`url(#${id}-glow)`}>
          <g filter={`url(#${id}-goo)`} fill={`url(#${id}-fill)`}>
            {word}
            {DRIPS.map((d) => (
              <g key={d.x} style={{ "--d": d.delay, "--len": d.len } as React.CSSProperties}>
                <rect
                  className="slop-drip"
                  x={d.x}
                  y={d.top}
                  width={d.w}
                  height={d.len}
                  rx={d.w / 2}
                />
                <circle
                  className="slop-bulb"
                  cx={d.x + d.w / 2}
                  cy={d.top + d.len}
                  r={d.w * 0.82}
                />
              </g>
            ))}
          </g>
        </g>
        <g clipPath={`url(#${id}-clip)`}>
          <rect
            className="slop-shine"
            x="-40"
            y="-10"
            width="40"
            height="90"
            fill={`url(#${id}-shine)`}
            transform="skewX(-20)"
          />
        </g>
        <g fill="#ffffff" stroke="#ff4fd8" strokeWidth="1">
          {SPARKS.map((s) => (
            <path
              key={s.x}
              className="slop-spark"
              style={{ "--d": s.delay } as React.CSSProperties}
              d={sparkle(s.x, s.y, s.r)}
            />
          ))}
        </g>
      </svg>
    </span>
  );
}
