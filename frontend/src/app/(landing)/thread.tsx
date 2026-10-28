"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarBlankIcon } from "@phosphor-icons/react/ssr";
import { FileCheckIcon } from "@/components/custom-icons";

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
 * the tailored application, and it rides the applications route stop by
 * stop to the offer. `FollowedCard` draws it the same way everywhere. A
 * `Flight` carried it from one section to the next as the page scrolled;
 * it went once the statement looped on its own, since its finale was
 * rarely on screen as the reader moved on, and the card flew out of
 * nowhere.
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
  const FooterIcon = stage === "saved" ? FileCheckIcon : at.footerIcon;
  // The new words come in as the old ones finish going: `popLayout` runs
  // both at once, and without the delay two lines of different length
  // showed through each other at every landing.
  const swap = {
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4, transition: { duration: 0.12 } },
    transition: { duration: 0.25, delay: 0.12, ease: GLIDE },
  };

  return (
    <div
      aria-hidden="true"
      className={cn("gloss-card text-ink rounded-2xl p-5", className)}
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
          <span className="text-ink-muted block text-xs">{followedJob.company}</span>
        </span>
      </div>

      <div className="bg-surface mt-3 flex gap-2.5 rounded-xl p-3 ring-1 ring-slate-900/5 ring-inset">
        <CalendarBlankIcon aria-hidden className="text-ink-meta mt-0.5 size-3.5 shrink-0" />
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={stage} {...swap}>
            <p className="text-xs font-semibold text-pretty">Next: {next.label}</p>
            <p className="text-ink-muted mt-0.5 text-[11px]">{next.when}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="text-ink-muted mt-3 flex items-center gap-2 border-t border-slate-900/5 pt-3 text-[11px]">
        <FooterIcon aria-hidden className="size-3.5 shrink-0" />
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={stage} {...swap}>
            {footer}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}
