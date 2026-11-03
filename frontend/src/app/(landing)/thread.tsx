"use client";

import * as React from "react";
import { FileCheckIcon } from "@/components/custom-icons";

import { cn } from "@/lib/cn";

import { stages } from "./board-data";
import { FaviconLogo } from "./favicon-logo";
import { followedJob } from "./feature-data";
import { scoreTone } from "./score-tone";

/**
 * The thread below the product tour: the application the tour followed
 * (`followedJob`, Stripe). The statement ends on it, as this card, and the
 * applications section takes it from there, drawn large (applications.tsx). A
 * `Flight` carried it from one section to the next as the page scrolled; it
 * went once the statement looped on its own, since its finale was rarely on
 * screen as the reader moved on, and the card flew out of nowhere.
 *
 * It shows only what the tracker keeps. A next step and a deadline were drawn
 * here, and neither is built.
 */

/** The card's width before any scaling, in px: the board's w-72. */
const CARD_WIDTH = 288;

/** The followed application, saved with its tailored resume, solid white so it
 * stands out. */
export function FollowedCard({ className, style, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  const saved = stages[0];
  const StageIcon = saved.icon;

  return (
    <div
      aria-hidden="true"
      className={cn("gloss-card text-ink rounded-2xl p-5", className)}
      style={{ width: CARD_WIDTH, ...style }}
      {...rest}
    >
      <div className="flex h-[22px] items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
            saved.chipClass,
          )}
        >
          <StageIcon className={cn("size-3", saved.iconClass)} />
          {saved.cardLabel}
        </span>
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

      <div className="text-ink-muted mt-3 flex items-center gap-2 border-t border-slate-900/5 pt-3 text-[11px]">
        <FileCheckIcon aria-hidden className="size-3.5 shrink-0" />
        Resume tailored to this posting
      </div>
    </div>
  );
}
