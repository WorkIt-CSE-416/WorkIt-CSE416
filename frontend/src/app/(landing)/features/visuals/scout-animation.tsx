"use client";

// Phosphor's X itself, not icons.tsx's CloseIcon: icons.tsx loads whole
// (frontend/CLAUDE.md, Icons).
import { XIcon } from "@phosphor-icons/react/ssr";
import { motion } from "motion/react";
import type { ReactNode } from "react";

import { GLIDE } from "../../story";
import { ANSWER, Bubble, Composer, DraftCard, QUESTION, ScoutMark, StageCard } from "./scout";

/**
 * The Scout page's hero: Fill With Scout's panel, playing one exchange
 * once. The stage card, Scout's question, the student's answer, then the
 * entry Scout drafts from it, and it holds there. It never loops, so it
 * stops within five seconds and needs no pause control (WCAG 2.2.2). The
 * page's `MotionConfig reducedMotion="user"` makes its rises instant.
 */
export default function ScoutAnimation() {
  return (
    <div aria-hidden="true" className="flex w-[520px] shrink-0 justify-center py-4">
      <div className="gloss-card flex w-[400px] flex-col gap-3 rounded-3xl p-4">
        <div className="flex items-center gap-2">
          <ScoutMark />
          <p className="text-ink flex-1 text-[14px] font-semibold">Scout</p>
          <XIcon aria-hidden className="text-ink-meta size-4" />
        </div>
        <Rise at={0.2}>
          <StageCard />
        </Rise>
        <div className="flex min-h-[280px] flex-col gap-2.5">
          <Rise at={0.7} className="flex items-end gap-2">
            <ScoutMark />
            <Bubble>{QUESTION}</Bubble>
          </Rise>
          <Rise at={1.8} className="flex flex-col">
            <Bubble mine>{ANSWER}</Bubble>
          </Rise>
          <Rise at={2.9} className="flex items-start gap-2">
            <ScoutMark />
            <div className="min-w-0 flex-1">
              <DraftCard />
            </div>
          </Rise>
        </div>
        <Composer />
      </div>
    </div>
  );
}

/** One part rising in at `at` seconds, as a chat bubble arrives. */
function Rise({
  at,
  className,
  children,
}: {
  at: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: at, duration: 0.45, ease: GLIDE }}
    >
      {children}
    </motion.div>
  );
}
