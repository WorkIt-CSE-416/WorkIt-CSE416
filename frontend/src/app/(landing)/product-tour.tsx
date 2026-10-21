"use client";

import { Bell, FileText, Target, Zap, type LucideIcon } from "lucide-react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from "react";

import { cn } from "@/lib/cn";

import AutoApplyVisual from "./auto-apply-visual";
import { features, type FeatureId } from "./feature-data";
import { useMediaQuery } from "./hooks";
import MatchingVisual from "./matching-visual";
import ResumeVisual from "./resume-visual";
import UpdatesVisual from "./updates-visual";

/**
 * Each stop's tab and colours. The colours are the app's own: the advanced
 * blue for resumes, then violet for matching, positive green and the match
 * pink, so each stop reads as its own product while staying in the palette.
 * The order is `features` in feature-data.ts; a stop keeps its colour.
 */
const STOPS: Record<
  FeatureId,
  { label: string; icon: LucideIcon; Visual: ComponentType; tint: string; glow: string }
> = {
  matching: {
    label: "Matching",
    icon: Target,
    Visual: MatchingVisual,
    tint: "var(--color-brand-tint)",
    glow: "var(--color-brand)",
  },
  resumes: {
    label: "Resumes",
    icon: FileText,
    Visual: ResumeVisual,
    tint: "var(--color-advanced-tint)",
    glow: "var(--color-advanced)",
  },
  "auto-apply": {
    label: "Auto Apply",
    // The app's own Auto Apply glyph (the Jobs page's filters, the sidebar).
    icon: Zap,
    Visual: AutoApplyVisual,
    tint: "var(--color-positive-tint)",
    glow: "var(--color-positive)",
  },
  updates: {
    label: "Updates",
    icon: Bell,
    Visual: UpdatesVisual,
    tint: "var(--color-danger-tint)",
    glow: "var(--color-match-good)",
  },
};

/** A stop's soft, two-blob gradient over its tint. */
function backdrop(id: FeatureId) {
  const { tint, glow } = STOPS[id];
  const blob = (amount: number) => `color-mix(in oklab, ${glow} ${amount}%, transparent)`;
  return `radial-gradient(55% 65% at 12% 18%, ${blob(38)}, transparent), radial-gradient(50% 60% at 88% 85%, ${blob(30)}, transparent), radial-gradient(40% 50% at 70% 10%, white, transparent), ${tint}`;
}

/** How far `Fit` may scale a pinned stop's visual up: the stories are drawn
 * at 520px wide, small type included, so past this their 10px labels read
 * as display type. */
const MAX_FIT = 1.5;

// Tailwind's lg breakpoint: pinned from here up, stacked below it.
const DESKTOP_QUERY = "(min-width: 64rem)";
/** How much page each stop takes to scroll past while pinned, in vh. */
const STOP_VH = 80;

/**
 * The product tour under the hero, after Calendly's: from lg up the section
 * pins to the screen and scrolling steps through the four features, the
 * gradient behind the card changing colour with each. The tabs jump to a
 * stop. Below lg, where a pinned card would not fit the screen, the stops
 * stack as rounded panels. Copy and animations are the feature carousel's
 * (feature-data.ts and the *-visual files).
 */
export function ProductTour() {
  // Null until mounted: both layouts render and CSS shows the right one,
  // so nothing shifts on hydration.
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  return (
    // reducedMotion="user": the animations' transforms are instant for
    // visitors who prefer reduced motion.
    <MotionConfig reducedMotion="user">
      <section id="features" aria-label="What WorkIt does">
        {isDesktop !== false && <PinnedTour />}
        {isDesktop !== true && <StackedTour />}
      </section>
    </MotionConfig>
  );
}

/**
 * Scales a visual to fit: to the height and width of `box` (the pinned
 * visual area, minus its padding), up to `MAX_FIT`, or down to its own
 * width when there is no box (the stacked stops). So a tall visual such as
 * the resume card fits a short laptop screen instead of losing its top and
 * bottom to the area's overflow clip, and on a big screen the stories fill
 * their area instead of floating small in the middle of it (the team found
 * them too small at 1x). A transform from the top, with the space it
 * frees or takes evened out by the bottom margin, so the content keeps its
 * own layout. The stacked stops never scale up.
 */
function Fit({ box, children }: { box?: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const area = box?.current ?? el.parentElement;
    if (!area) return;
    const measure = () => {
      const style = getComputedStyle(area);
      const roomW =
        area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const roomH = box
        ? area.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
        : Infinity;
      // offsetWidth and offsetHeight ignore the transform, so these are the
      // unscaled sizes. The child's width, not the wrapper's: the wrapper
      // stretches to the area, while a wide visual overflows it.
      const child = el.firstElementChild as HTMLElement | null;
      const w = child?.offsetWidth ?? 0;
      const h = el.offsetHeight;
      setHeight(h);
      setFit(w > 0 && h > 0 ? Math.min(box ? MAX_FIT : 1, roomW / w, roomH / h) : 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(area);
    return () => observer.disconnect();
  }, [box]);

  return (
    <div
      ref={ref}
      className="flex w-full justify-center"
      style={
        fit !== 1
          ? {
              transform: `scale(${fit})`,
              transformOrigin: "top center",
              marginBottom: -height * (1 - fit),
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

function PinnedTour() {
  const ref = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);

  // 0 when the section's top meets the screen's top, 1 when its bottom
  // meets the screen's bottom: the stretch where the card is pinned.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  useMotionValueEvent(scrollYProgress, "change", (progress) => {
    setIndex(Math.min(features.length - 1, Math.max(0, Math.floor(progress * features.length))));
  });

  // The panel grows into place as it scrolls up to the top.
  const { scrollYProgress: entry } = useScroll({
    target: ref,
    offset: ["start end", "start start"],
  });
  const scale = useTransform(entry, [0, 1], reduceMotion ? [1, 1] : [0.9, 1]);

  const jumpTo = (stop: number) => {
    const section = ref.current;
    if (!section) return;
    const top = section.getBoundingClientRect().top + window.scrollY;
    const span = section.offsetHeight - window.innerHeight;
    // The middle of the stop's stretch, so a small scroll does not leave it.
    window.scrollTo({
      top: top + ((stop + 0.5) / features.length) * span,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  };

  const active = features[index];
  const { Visual } = STOPS[active.id];

  return (
    <div
      ref={ref}
      className="hidden lg:block"
      style={{ height: `calc(100dvh + ${(features.length - 1) * STOP_VH}vh)` }}
    >
      <div className="sticky top-0 flex h-dvh flex-col px-6 pt-22 pb-6">
        <motion.div
          style={{ scale }}
          className="relative isolate flex flex-1 flex-col items-center justify-center overflow-hidden rounded-[3rem] px-8"
        >
          {/* One backdrop per stop, crossfading, so the colour shift is smooth. */}
          {features.map((feature, i) => (
            <div
              key={feature.id}
              aria-hidden="true"
              className="absolute inset-0 -z-10 transition-opacity duration-700 ease-out motion-reduce:transition-none"
              style={{ background: backdrop(feature.id), opacity: i === index ? 1 : 0 }}
            />
          ))}

          {/* Labelled tabs in one pill, so the row reads as the tour's steps
              rather than as loose dots above the card. */}
          <div
            role="tablist"
            aria-label="Features"
            className="flex gap-1 rounded-full bg-white/50 p-1 ring-1 ring-white/70"
          >
            {features.map((feature, i) => {
              const { icon: Icon, label } = STOPS[feature.id];
              const selected = i === index;
              return (
                <button
                  key={feature.id}
                  type="button"
                  role="tab"
                  id={`tour-tab-${feature.id}`}
                  aria-selected={selected}
                  aria-controls="tour-panel"
                  onClick={() => jumpTo(i)}
                  className={cn(
                    "relative flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors duration-300",
                    selected ? "text-ink" : "text-ink-meta hover:text-ink",
                  )}
                >
                  {/* The white fill slides between tabs. */}
                  {selected && (
                    <motion.span
                      layoutId="tour-tab-fill"
                      aria-hidden="true"
                      className="absolute inset-0 -z-10 rounded-full bg-white shadow-md"
                    />
                  )}
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </button>
              );
            })}
          </div>

          <div
            id="tour-panel"
            role="tabpanel"
            aria-labelledby={`tour-tab-${active.id}`}
            className="mt-4 grid w-full max-w-[76rem] grid-cols-[5fr_8fr] items-center gap-8 rounded-[2rem] bg-white p-5 shadow-xl shadow-slate-900/5"
          >
            {/* No initial={false} on these: it blocks the first animation of
                every motion element inside, so the Matching rows sat still at
                their end value until a tab switch remounted them. The first
                stop's fade-in runs below the fold instead, unseen. */}
            <AnimatePresence mode="wait">
              <motion.div
                key={active.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="pl-4"
              >
                <StopCopy id={active.id} />
              </motion.div>
            </AnimatePresence>

            <div
              ref={boxRef}
              className="relative flex h-[clamp(20rem,calc(100dvh-13.5rem),50rem)] items-center justify-center overflow-hidden rounded-[1.5rem] p-4"
              style={{ background: backdrop(active.id) }}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={active.id}
                  className="flex w-full justify-center"
                  initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -12, filter: "blur(6px)" }}
                  transition={{ duration: reduceMotion ? 0 : 0.35, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Fit box={boxRef}>
                    <Visual />
                  </Fit>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function StackedTour() {
  return (
    <div className="space-y-2 px-2 sm:space-y-4 sm:px-6 lg:hidden">
      {features.map((feature) => {
        const { Visual } = STOPS[feature.id];
        return (
          <div
            key={feature.id}
            className="overflow-hidden rounded-[2rem] p-2 sm:p-4"
            style={{ background: backdrop(feature.id) }}
          >
            <div className="rounded-[1.5rem] bg-white p-6">
              <StopCopy id={feature.id} />
            </div>
            <div className="flex justify-center px-2 py-8">
              <Fit>
                <Visual />
              </Fit>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A stop's label chip, title, description and link. */
function StopCopy({ id }: { id: FeatureId }) {
  const feature = features.find((item) => item.id === id) ?? features[0];
  const { icon: Icon, label, glow } = STOPS[id];
  return (
    <>
      <p className="text-ink inline-flex items-center gap-2 text-sm font-medium">
        <span
          className="flex size-6 items-center justify-center rounded-md text-white"
          style={{ background: glow }}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
        {label}
      </p>
      <h2 className="text-ink mt-4 text-3xl font-semibold tracking-tight text-balance">
        {feature.title}
      </h2>
      <p className="text-ink-meta mt-3 text-pretty">{feature.description}</p>
      <Link
        href="/signup"
        className="text-ink mt-6 inline-flex items-center gap-1.5 border-b border-current pb-0.5 text-sm font-medium"
      >
        Try it free <span aria-hidden="true">→</span>
      </Link>
    </>
  );
}
