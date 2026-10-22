"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useMotionValueEvent,
  type MotionValue,
} from "motion/react";
import { Calendar, FileCheck2 } from "lucide-react";

import { cn } from "@/lib/cn";

import { followedStages, stages, type Stage } from "./board-data";
import { FaviconLogo } from "./favicon-logo";
import { followedJob } from "./feature-data";
import { scoreTone } from "./score-tone";
import { GLIDE } from "./story";

/**
 * The thread below the product tour: the application the tour followed
 * (`followedJob`, Stripe) carried from section to section, after Twain's
 * habit of handing one object down the page. The statement ends on it as
 * the tailored application, it rides the applications route stop by
 * stop, and it lands on the journey's Track card. `FollowedCard` draws it
 * the same way everywhere, and `Flight` carries it from one section to the
 * next as the page scrolls.
 */

/** The card's width before any scaling, in px: the board's w-72. */
export const CARD_WIDTH = 288;

/** The followed application as a tracker card at `stage`, solid white so
 * it stands out over the board's glass cards. The parts that change with
 * the stage cross-fade. */
export function FollowedCard({
  stage,
  className,
  style,
  ...rest
}: { stage: Stage["id"] } & React.HTMLAttributes<HTMLDivElement>) {
  const at = stages.find((s) => s.id === stage)!;
  const { next, footer } = followedStages[stage];
  const StageIcon = at.icon;
  const FooterIcon = stage === "saved" ? FileCheck2 : at.footerIcon;
  const swap = {
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4, transition: { duration: 0.12 } },
    transition: { duration: 0.25, ease: GLIDE },
  };

  return (
    <div
      aria-hidden="true"
      className={cn(
        "text-ink rounded-2xl bg-white p-5 shadow-[0_24px_48px_-20px_rgb(40_20_90/0.45)] ring-1 ring-slate-900/5",
        className,
      )}
      style={{ width: CARD_WIDTH, ...style }}
      {...rest}
    >
      <div className="flex h-[22px] items-center justify-between gap-2">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={stage}
            {...swap}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
              at.chipClass,
            )}
          >
            <StageIcon className={cn("size-3", at.iconClass)} />
            {at.cardLabel}
          </motion.span>
        </AnimatePresence>
        <span
          className={cn(
            "shrink-0 rounded-md px-[7px] py-0.5 text-[11px] font-bold shadow-[inset_0_1px_0_rgb(255_255_255/0.8)] ring-1 ring-inset",
            scoreTone(followedJob.score),
          )}
        >
          {followedJob.score}%
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2.5">
        <FaviconLogo domain={followedJob.domain} eager />
        <span className="min-w-0 flex-1">
          <span className="block text-sm/5 font-semibold">{followedJob.title}</span>
          <span className="text-ink-meta block text-xs">{followedJob.company}</span>
        </span>
      </div>

      <div className="bg-surface mt-3 flex gap-2.5 rounded-xl p-3 ring-1 ring-slate-900/5 ring-inset">
        <Calendar className="text-ink-meta mt-0.5 size-3.5 shrink-0" />
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={stage} {...swap}>
            <p className="text-xs font-semibold">Next: {next.label}</p>
            <p className="text-ink-meta mt-0.5 text-[11px]">{next.when}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="text-ink-meta mt-3 flex items-center gap-2 border-t border-slate-900/5 pt-3 text-[11px]">
        <FooterIcon className="size-3.5 shrink-0" />
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={stage} {...swap}>
            {footer}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * Its child, drawn at `CARD_WIDTH` and scaled to this box's width, so a
 * card in a narrow slot keeps its lines where they were and a flight can
 * land on it by scale alone.
 */
export function ScaledToWidth({
  children,
  className,
  ...rest
}: { children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  const outer = React.useRef<HTMLDivElement>(null);
  const inner = React.useRef<HTMLDivElement>(null);
  const [box, setBox] = React.useState({ scale: 1, height: 0 });
  React.useLayoutEffect(() => {
    const el = outer.current;
    const content = inner.current;
    if (!el || !content) return;
    const measure = () => {
      const scale = Math.min(1, el.offsetWidth / CARD_WIDTH);
      setBox({ scale, height: content.offsetHeight * scale });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={outer} className={className} style={{ height: box.height || undefined }} {...rest}>
      <div
        ref={inner}
        className="origin-top-left"
        style={{ width: CARD_WIDTH, transform: `scale(${box.scale})` }}
      >
        {children}
      </div>
    </div>
  );
}

const noSubscribe = () => () => {};
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Carries `children` (drawn at `CARD_WIDTH`) from the element marked
 * `data-thread-from={name}` to the one marked `data-thread-to={name}` while
 * `progress` runs from 0 to 1, as the page scrolls from one section into
 * the next. Both ends are measured every frame, since both move, and the
 * card scales from one's width to the other's. It marks `<html>` with
 * `data-thread-<name>` (idle, flying, landed), and landing.css hides each
 * end while the card is not there, so it is drawn once. With either end
 * missing (below lg, reduced motion) the attribute is absent and both
 * show, so mount it only with the pinned scenes.
 */
export function Flight({
  name,
  progress,
  children,
}: {
  name: string;
  progress: MotionValue<number>;
  children: React.ReactNode;
}) {
  const mounted = React.useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  const key = `thread${name[0].toUpperCase()}${name.slice(1)}`;
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const scale = useMotionValue(1);
  const opacity = useMotionValue(0);

  const place = React.useCallback(
    (p: number) => {
      const root = document.documentElement;
      const from = document.querySelector(`[data-thread-from="${name}"]`);
      const to = document.querySelector(`[data-thread-to="${name}"]`);
      if (!from || !to) {
        delete root.dataset[key];
        opacity.set(0);
        return;
      }
      const state = p <= 0.01 ? "idle" : p >= 0.985 ? "landed" : "flying";
      root.dataset[key] = state;
      opacity.set(state === "flying" ? 1 : 0);
      if (state !== "flying") return;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      // A lift in the middle, so the card arcs over the page rather than
      // sliding with it.
      const t = ease(clamp(p / 0.92));
      x.set(lerp(a.left, b.left, t));
      y.set(lerp(a.top, b.top, t) - Math.sin(Math.PI * t) * 36);
      scale.set(lerp(a.width, b.width, t) / CARD_WIDTH);
    },
    [key, name, opacity, scale, x, y],
  );
  useMotionValueEvent(progress, "change", place);
  React.useEffect(() => {
    place(progress.get());
    const onResize = () => place(progress.get());
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      delete document.documentElement.dataset[key];
    };
  }, [key, place, progress]);

  if (!mounted) return null;
  return createPortal(
    <motion.div
      aria-hidden="true"
      className="pointer-events-none fixed top-0 left-0 z-40 origin-top-left"
      style={{ x, y, scale, opacity }}
    >
      {children}
    </motion.div>,
    document.body,
  );
}
