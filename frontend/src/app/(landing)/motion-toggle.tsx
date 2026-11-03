"use client";

import { PauseIcon, PlayIcon } from "@phosphor-icons/react/ssr";
import { useEffect } from "react";

import { cn } from "@/lib/cn";

import { restoreMotionPaused, setMotionPaused, useMotionPaused } from "./motion-pause";

/**
 * Pause Animations, or Play Animations once paused (motion-pause.ts): in
 * the footer and the phone menu, so every marketing page has one. Either
 * copy puts back a pause kept from an earlier visit. Hidden with reduced
 * motion, where nothing loops to pause.
 */
export function MotionToggle({ className }: { className?: string }) {
  const paused = useMotionPaused();
  useEffect(() => restoreMotionPaused(), []);
  const Icon = paused ? PlayIcon : PauseIcon;
  return (
    <button
      type="button"
      onClick={() => setMotionPaused(!paused)}
      className={cn("inline-flex items-center gap-2 motion-reduce:hidden", className)}
    >
      <Icon aria-hidden="true" weight="fill" className="size-4 shrink-0" />
      {paused ? "Play Animations" : "Pause Animations"}
    </button>
  );
}
