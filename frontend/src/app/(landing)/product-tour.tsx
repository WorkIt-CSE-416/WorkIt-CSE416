"use client";

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
import { backdrop as featureBackdrop, FEATURES } from "./features/catalog";
import { FeatureIcon } from "./features/feature-icon";
import { Fit } from "./fit";
import { useMediaQuery } from "./hooks";
import { useTabFlight } from "./bridge";
import { TOUR_TABS, type TourTab } from "./tour-tabs";
import MatchingVisual from "./matching-visual";
import ResumeVisual from "./resume-visual";
import { SoonChip, TOUR_COVER_VH } from "./layout-parts";
import { scrollPageTo } from "./smooth-scroll";
import UpdatesVisual from "./updates-visual";

/**
 * Each stop's tab, animation and feature page. A stop's colours are its
 * page's (features/catalog.ts), so the tour and the feature pages match:
 * the advanced blue for resumes, then violet for matching, positive green
 * and the match pink, each stop its own product within the palette. The
 * order is `features` in feature-data.ts; a stop keeps its colour.
 */
const VISUALS: Record<FeatureId, ComponentType> = {
  resumes: ResumeVisual,
  matching: MatchingVisual,
  "auto-apply": AutoApplyVisual,
  updates: UpdatesVisual,
};
const STOPS = Object.fromEntries(
  TOUR_TABS.map((tab) => [tab.id, { ...tab, Visual: VISUALS[tab.id] }]),
) as Record<FeatureId, TourTab & { Visual: ComponentType }>;

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
  const coverRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  // After the last stop the card stays pinned while the hiring-systems
  // section slides up over it (`TOUR_COVER_VH`); with reduced motion that
  // section is still, so no pin is kept for it.
  const cover = reduceMotion ? 0 : TOUR_COVER_VH;
  const stopsVh = (features.length - 1) * STOP_VH;

  // 0 when the section's top meets the screen's top, 1 when its bottom
  // meets the screen's bottom: the stretch where the card is pinned. The
  // stops share all of it but the cover.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  useMotionValueEvent(scrollYProgress, "change", (progress) => {
    const stops = Math.min(1, (progress * (stopsVh + cover)) / stopsVh);
    setIndex(Math.min(features.length - 1, Math.max(0, Math.floor(stops * features.length))));
  });

  // As the next section covers it, the card sinks back: smaller, and
  // shaded by a layer over it (a filter on the card would stop its glass
  // blurring). Transform strings and opacity over a plain offset, so the
  // browser runs both.
  const { scrollYProgress: covered } = useScroll({
    target: coverRef,
    offset: ["start end", "start start"],
  });
  const recede = useTransform(covered, [0, 1], ["scale(1)", "scale(0.94)"]);
  const shade = useTransform(covered, [0, 1], [0, 0.22]);
  // Gone by the time it is covered: once its pin ends it scrolls away
  // behind the next section, and showed in the strip above that section's
  // panel and in its side gutters.
  const fadeOut = useTransform(covered, [0.8, 1], [1, 0]);

  // The panel grows into place as it scrolls up to the top.
  const { scrollYProgress: entry } = useScroll({
    target: ref,
    offset: ["start end", "start start"],
  });
  // A transform string, not `scale`: motion runs only `transform` (with
  // opacity, filter and clipPath) as the browser's own scroll animation, so
  // `scale` repainted the whole panel on every frame of its entry.
  const grow = useTransform(entry, [0, 1], ["scale(0.9)", "scale(1)"]);

  const jumpTo = (stop: number) => {
    const section = ref.current;
    if (!section) return;
    const top = section.getBoundingClientRect().top + window.scrollY;
    const span = section.offsetHeight - window.innerHeight * (1 + cover / 100);
    // The middle of the stop's stretch, so a small scroll does not leave it.
    // Through Lenis while it runs (smooth-scroll.tsx): a native smooth
    // scroll under it fought its glide.
    scrollPageTo(top + ((stop + 0.5) / features.length) * span, { instant: !!reduceMotion });
  };

  // The tabs fly in from the bridge's four steps (bridge.tsx).
  const flight = useTabFlight(entry, !reduceMotion);

  const active = features[index];
  const { Visual } = STOPS[active.id];

  return (
    <div
      ref={ref}
      data-tour-pin=""
      className="relative hidden lg:block"
      style={{ height: `calc(100dvh + ${stopsVh + cover}vh)` }}
    >
      {/* The cover's stretch: its top is the next section's top. It has
          the stretch's height, not none: the browser's view timeline of a
          box with no height stood at its end, so the tour vanished the
          moment the cover began and left the screen blank. */}
      <div
        ref={coverRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0"
        style={{ height: `${cover}vh` }}
      />
      {/* The card takes whatever height is left inside the panel's padding,
          so the switcher and the card keep their room at any window height.
          A fixed height from the window's (100dvh minus the chrome) left the
          panel 8px to spare: the switcher sat on its top edge and the card
          ran into its bottom one. */}
      <motion.div
        className="sticky top-0 flex h-dvh flex-col px-6 pt-24 pb-6"
        style={reduceMotion ? undefined : { transform: recede, opacity: fadeOut }}
      >
        <motion.div
          style={{ transform: reduceMotion ? "none" : grow }}
          // Tighter on a short window (a laptop's), so the stories keep
          // their design size: at a 790px window Resumes was drawn at 0.9,
          // its smallest text 8px.
          // Not clipped itself: the tabs fly in from above it. Its
          // backdrops are clipped to its corners instead.
          className="relative isolate flex min-h-0 flex-1 flex-col items-center justify-center gap-5 rounded-[3rem] px-10 py-6 xl:px-14 [@media(max-height:50rem)]:gap-3 [@media(max-height:50rem)]:py-4"
        >
          {/* One backdrop per stop, crossfading, so the colour shift is smooth. */}
          <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden rounded-[3rem]">
            {features.map((feature, i) => (
              <div
                key={feature.id}
                className="absolute inset-0 transition-opacity duration-700 ease-out motion-reduce:transition-none"
                style={{ background: backdrop(feature.id), opacity: i === index ? 1 : 0 }}
              />
            ))}
          </div>

          {/* Labelled tabs in one pill, so the row reads as the tour's steps
              rather than as loose dots above the card. */}
          <div
            role="tablist"
            aria-label="Features"
            // tour-tabs: hidden until the tabs take off from the bridge, and
            // bare while they fly (landing.css).
            className="tour-tabs flex shrink-0 gap-1 rounded-full bg-white/50 p-1 ring-1 ring-white/70"
          >
            {features.map((feature, i) => {
              const { icon: Icon, label, glow } = STOPS[feature.id];
              const selected = i === index;
              const pose = flight[i];
              return (
                <motion.button
                  key={feature.id}
                  style={{ x: pose.x, y: pose.y, scale: pose.scale, transformOrigin: "0 0" }}
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
                  {/* While it flies in it still looks like the bridge's step
                      it left: white, with the step's colour ring. */}
                  {!selected && (
                    <motion.span
                      aria-hidden="true"
                      className="absolute inset-0 -z-10 rounded-full bg-white shadow-md ring-1 ring-slate-900/5"
                      style={{ opacity: pose.fill }}
                    />
                  )}
                  <motion.span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-full"
                    style={{ opacity: pose.ring, boxShadow: `0 0 0 2px ${glow}` }}
                  />
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </motion.button>
              );
            })}
          </div>

          <div
            id="tour-panel"
            role="tabpanel"
            aria-labelledby={`tour-tab-${active.id}`}
            className="grid [max-height:52rem] min-h-0 w-full max-w-[76rem] flex-1 grid-cols-[5fr_8fr] grid-rows-[minmax(0,1fr)] gap-8 rounded-[2rem] bg-white p-5 shadow-xl shadow-slate-900/5 [@media(max-height:50rem)]:p-3"
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
                className="self-center pl-4"
              >
                <StopCopy id={active.id} />
              </motion.div>
            </AnimatePresence>

            <div
              ref={boxRef}
              className="relative isolate flex h-full min-h-0 items-center justify-center overflow-hidden rounded-[1.5rem] p-4 [@media(max-height:50rem)]:p-2"
            >
              {/* Its colour crossfades with the panel's, one layer per stop:
                  set as one gradient it changed in a single frame while the
                  panel around it faded. Siblings of the story, never its
                  ancestors, so the scene titles' glass still blurs them. */}
              {features.map((feature, i) => (
                <div
                  key={feature.id}
                  aria-hidden="true"
                  className="absolute inset-0 -z-10 transition-opacity duration-700 ease-out motion-reduce:transition-none"
                  style={{ background: backdrop(feature.id), opacity: i === index ? 1 : 0 }}
                />
              ))}
              <AnimatePresence mode="wait">
                <motion.div
                  key={active.id}
                  className="flex w-full justify-center"
                  initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
                  // The filter comes off once the blur-in ends: a filter,
                  // even blur(0px), draws the stop on a surface of its own,
                  // which washed out the Auto Apply camera's big layer and
                  // is a backdrop root that stops the glass blurring.
                  animate={{
                    opacity: 1,
                    y: 0,
                    filter: "blur(0px)",
                    transitionEnd: { filter: "none" },
                  }}
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
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-20 rounded-[3rem] bg-[#0d1220]"
            style={{ opacity: reduceMotion ? 0 : shade }}
          />
        </motion.div>
      </motion.div>
    </div>
  );
}

/**
 * Below lg the stops are one row that swipes sideways, a stop at a time,
 * the next one peeking in at the edge, with a dot per stop under it.
 * Stacked, the four stops took 3,290px of a 390px phone, almost a third of
 * the home page (KAN-368). Each story plays only while its stop is on
 * screen (story.tsx), so the stops off to the side stay still.
 */
function StackedTour() {
  const rowRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const onScroll = () => {
    const row = rowRef.current;
    const first = row?.firstElementChild as HTMLElement | null;
    if (!row || !first) return;
    const pitch = first.offsetWidth + parseFloat(getComputedStyle(row).columnGap || "0");
    setCurrent(Math.min(features.length - 1, Math.max(0, Math.round(row.scrollLeft / pitch))));
  };
  const show = (index: number) => {
    const slide = rowRef.current?.children[index] as HTMLElement | undefined;
    slide?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  };
  return (
    <div className="lg:hidden" role="region" aria-roledescription="carousel" aria-label="Features">
      <div
        ref={rowRef}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory scroll-px-2 [scrollbar-width:none] gap-2 overflow-x-auto overscroll-x-contain px-2 sm:scroll-px-6 sm:gap-4 sm:px-6 [&::-webkit-scrollbar]:hidden"
      >
        {features.map((feature, i) => {
          const { Visual } = STOPS[feature.id];
          return (
            <div
              key={feature.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${features.length}`}
              className="w-[90%] shrink-0 snap-center overflow-hidden rounded-[2rem] p-2 sm:w-[80%] sm:p-4"
              style={{ background: backdrop(feature.id) }}
            >
              <div className="rounded-[1.5rem] bg-white p-6">
                <StopCopy id={feature.id} />
              </div>
              <div className="flex justify-center py-6">
                <Fit>
                  <Visual />
                </Fit>
              </div>
            </div>
          );
        })}
      </div>
      {/* A dot per stop; each 44px tall to tap, drawn 8px. */}
      <div className="mt-2 flex justify-center">
        {features.map((feature, i) => (
          <button
            key={feature.id}
            type="button"
            onClick={() => show(i)}
            aria-label={`Show ${feature.title}`}
            aria-current={i === current}
            className="grid size-11 place-items-center"
          >
            <span
              className={cn(
                "h-2 rounded-full transition-all duration-300",
                i === current ? "bg-landing-brand-600 w-5" : "w-2 bg-slate-300",
              )}
            />
          </button>
        ))}
      </div>
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
        {feature.soon && <SoonChip />}
      </p>
      <h2 className="text-ink mt-4 text-3xl leading-tight font-semibold tracking-tight text-balance">
        {feature.title}
      </h2>
      <p className="text-ink-meta mt-3 text-pretty">{feature.description}</p>
      {/* One link per stop, to its feature page. A "Try it free" beside it
          made two calls to action for one paragraph; the header and the
          hero already ask for the sign-up. */}
      <div className="mt-6 text-sm font-medium">
        {/* The ::after widens what a tap reaches to about 48px, with the
            underlined link drawn as before: alone it was 23px tall. */}
        <Link
          href={href}
          className="group text-ink relative inline-flex items-center gap-1.5 border-b border-current pb-0.5 after:absolute after:-inset-3 after:content-['']"
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
