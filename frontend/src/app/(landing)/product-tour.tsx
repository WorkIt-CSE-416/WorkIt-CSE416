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
import { useRef, useState, type ComponentType } from "react";

import { cn } from "@/lib/cn";

import AutoApplyVisual from "./auto-apply-visual";
import { features, type FeatureId } from "./feature-data";
import { backdrop as featureBackdrop, FEATURES, type FeatureSlug } from "./features/catalog";
import { FeatureIcon } from "./features/feature-icon";
import { Fit } from "./fit";
import { useMediaQuery } from "./hooks";
import MatchingVisual from "./matching-visual";
import ResumeVisual from "./resume-visual";
import UpdatesVisual from "./updates-visual";

/**
 * Each stop's tab, animation and feature page. A stop's colours are its
 * page's (features/catalog.ts), so the tour and the feature pages match:
 * the advanced blue for resumes, then violet for matching, positive green
 * and the match pink, each stop its own product within the palette. The
 * order is `features` in feature-data.ts; a stop keeps its colour.
 */
const STOPS: Record<
  FeatureId,
  { label: string; icon: LucideIcon; Visual: ComponentType; page: FeatureSlug }
> = {
  matching: { label: "Matching", icon: Target, Visual: MatchingVisual, page: "matching" },
  resumes: { label: "Resumes", icon: FileText, Visual: ResumeVisual, page: "resumes" },
  "auto-apply": {
    label: "Auto Apply",
    // The app's own Auto Apply glyph (the Jobs page's filters, the sidebar).
    icon: Zap,
    Visual: AutoApplyVisual,
    page: "auto-apply",
  },
  // The Application Tracker's page shows this stop's animation.
  updates: { label: "Updates", icon: Bell, Visual: UpdatesVisual, page: "tracker" },
};

/** A stop's soft, two-blob gradient over its tint. */
function backdrop(id: FeatureId) {
  return featureBackdrop(FEATURES[STOPS[id].page]);
}

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

/** A stop's label chip, title, description and links. */
function StopCopy({ id }: { id: FeatureId }) {
  const feature = features.find((item) => item.id === id) ?? features[0];
  const { icon: Icon, label, page } = STOPS[id];
  const { glow, href, name } = FEATURES[page];
  return (
    <>
      <p className="text-ink inline-flex items-center gap-2 text-sm font-medium">
        <FeatureIcon feature={{ icon: Icon, glow }} />
        {label}
      </p>
      <h2 className="text-ink mt-4 text-3xl font-semibold tracking-tight text-balance">
        {feature.title}
      </h2>
      <p className="text-ink-meta mt-3 text-pretty">{feature.description}</p>
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-medium">
        <Link
          href="/signup"
          className="text-ink inline-flex items-center gap-1.5 border-b border-current pb-0.5"
        >
          Try it free <span aria-hidden="true">→</span>
        </Link>
        <Link
          href={href}
          className="group text-ink-meta hover:text-ink inline-flex items-center gap-1.5 border-b border-transparent pb-0.5 transition-colors duration-200 hover:border-current"
        >
          Learn more<span className="sr-only"> about {name}</span>
          <span
            aria-hidden="true"
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          >
            →
          </span>
        </Link>
      </div>
    </>
  );
}
