"use client";

import * as React from "react";
import {
  animate,
  cancelFrame,
  frame,
  useMotionValue,
  useMotionValueEvent,
  type FrameData,
  type MotionValue,
} from "motion/react";

/**
 * The home page's scenes move on their own; the scroll only cues them. A
 * scene's poses read a timeline from 0 to 1, split into phases. Once the
 * scroll reaches a phase's cue, the scene plays the whole phase in time and
 * rests at its end, however far the reader went: scrubbed by the scroll
 * itself, a scene stopped half way through a move whenever the reader
 * stopped scrolling (a paper ball hung in the air, the card sat between two
 * stops), which the team disliked. Scrolling back plays it back to the end
 * of the phase before. A phase that should keep moving while it rests (the
 * hiring systems' ring of coins, the postings in the pipe) runs its own
 * loop on `useLoopClock`.
 */

/** Once the scroll reaches `at`, the scene plays to `to` on its timeline. */
export type Cue = { at: number; to: number };

/** How far short of a cue the scroll must go back before the scene plays
 * back, so a reader resting on the cue's line does not set it going to and
 * fro. */
const BACK = 0.02;

/**
 * The scene's timeline: it plays to the last cue the scroll has reached,
 * at `rate` (timeline per second), and no slower than `longest` seconds for
 * a whole jump, so a fast scroll through several cues does not leave the
 * scene far behind. Before the first cue it rests at 0.
 */
export function useSceneTime(
  progress: MotionValue<number>,
  cues: readonly Cue[],
  { rate, longest = 2.4 }: { rate: number; longest?: number },
): MotionValue<number> {
  const [first] = React.useState(() => cueAt(progress.get(), cues, -1));
  const cue = React.useRef(first);
  const time = useMotionValue(timeOf(first, cues));
  const playing = React.useRef<ReturnType<typeof animate> | null>(null);

  useMotionValueEvent(progress, "change", (p) => {
    const next = cueAt(p, cues, cue.current);
    if (next === cue.current) return;
    cue.current = next;
    const target = timeOf(next, cues);
    playing.current?.stop();
    playing.current = animate(time, target, {
      duration: Math.min(longest, Math.abs(target - time.get()) / rate),
      ease: "linear",
    });
  });
  React.useEffect(() => () => playing.current?.stop(), []);
  return time;
}

/** The last cue the scroll has reached, holding the current one until the
 * scroll is `BACK` short of it. */
function cueAt(p: number, cues: readonly Cue[], current: number) {
  let reached = -1;
  cues.forEach((cue, i) => {
    if (p >= cue.at) reached = i;
  });
  if (reached < current && p >= cues[current].at - BACK) return current;
  return reached;
}

function timeOf(cue: number, cues: readonly Cue[]) {
  return cue < 0 ? 0 : cues[cue].to;
}

/** Seconds that pass only while `running`: a resting phase's loop, which
 * its caller stops off screen and in a hidden tab. */
export function useLoopClock(running: boolean): MotionValue<number> {
  const clock = useMotionValue(0);
  React.useEffect(() => {
    if (!running) return;
    // A long frame (a tab coming back) counts as one ordinary one.
    const tick = ({ delta }: FrameData) => clock.set(clock.get() + Math.min(delta, 50) / 1000);
    frame.update(tick, true);
    return () => cancelFrame(tick);
  }, [running, clock]);
  return clock;
}
