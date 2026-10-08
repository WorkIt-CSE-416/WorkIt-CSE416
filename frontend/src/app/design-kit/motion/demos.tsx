"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { addTransitionType, startTransition, useState, ViewTransition } from "react";

import { BellIcon, CloseIcon } from "@/components/icons";
import { ShallowLink, useShallowParams } from "@/components/shallow-routing";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SegmentedToggle } from "@/components/ui/segmented-control";
import { cn } from "@/lib/cn";

import type { ANIMATIONS } from "../data";

/**
 * The Motion page's live specimens. Client components because each one
 * replays: a curve on Play, an animation by remounting its specimen, a view
 * transition by changing state inside a transition the way a navigation
 * does. Each draws the thing the token is used for, at its real size, so the
 * kit shows the motion where it lives rather than on a grey square.
 */

/** A dot crossing a track on the curve. 800ms, slower than any real use, so
 *  the shape of the curve can be read. */
export function EasingDemo({ cls }: { cls: string }) {
  const [across, setAcross] = useState(false);

  return (
    <>
      <span aria-hidden="true" className="bg-well relative block h-8 w-56 rounded-full">
        <span
          className={cn(
            "bg-brand absolute top-1 left-1 size-6 rounded-full transition-transform duration-800",
            cls,
            across && "translate-x-48",
          )}
        />
      </span>
      <Button variant="secondary" size="sm" onClick={() => setAcross((on) => !on)}>
        Play
      </Button>
    </>
  );
}

type Demo = (typeof ANIMATIONS)[number]["demo"];

/** The ring at 75%, drawn as the match rail draws it. */
const RADIUS = 27;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function Specimen({ cls, demo }: { cls: string; demo: Demo }) {
  switch (demo) {
    case "card":
      return (
        <span
          className={cn(
            "bg-panel border-border-subtle rounded-card shadow-panel block h-12 w-24 border",
            cls,
          )}
        />
      );
    case "cross":
      return (
        <span className="bg-brand-tint text-brand-ink text-note inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-medium">
          Applied
          <span className={cn("flex", cls)}>
            <CloseIcon className="size-3" />
          </span>
        </span>
      );
    case "row":
      return <span className={cn("bg-hover rounded-control block h-8 w-56", cls)} />;
    case "rail":
      return <span className={cn("bg-border block h-16 w-0.5 origin-top", cls)} />;
    case "bar":
      return (
        <span className="bg-well block h-2.5 w-56 overflow-hidden rounded-full">
          <span className={cn("bg-positive block h-full w-2/3 origin-left rounded-full", cls)} />
        </span>
      );
    case "ring":
      return (
        <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
          <circle
            cx="32"
            cy="32"
            r={RADIUS}
            fill="none"
            strokeWidth="5"
            className="stroke-border-strong"
          />
          <circle
            cx="32"
            cy="32"
            r={RADIUS}
            fill="none"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${CIRCUMFERENCE * 0.75} ${CIRCUMFERENCE}`}
            className={cn("stroke-brand", cls)}
          />
        </svg>
      );
    case "ping":
      return (
        <span aria-hidden="true" className="relative flex size-2.5">
          <span className={cn("bg-brand absolute inset-0 rounded-full", cls)} />
          <span className="bg-brand relative size-2.5 rounded-full" />
        </span>
      );
    case "dots":
      // Looping, so it needs no Replay; staggered as Scout's are.
      return (
        <span className="bg-surface flex h-10 items-center gap-1 rounded-2xl rounded-bl-md px-4">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className={cn("bg-ink-subtle size-1.5 rounded-full", cls)}
              style={{ animationDelay: `${dot * 150}ms` }}
            />
          ))}
        </span>
      );
    case "bell":
      // Hover-driven like the bar's, so it needs no Replay.
      return (
        <IconButton
          label="Notifications"
          className="group/bell bg-app hover:bg-selected size-10 rounded-full"
        >
          <BellIcon className="group-hover/bell:animate-swing size-4 origin-[50%_15%]" />
        </IconButton>
      );
  }
}

/** An animation's specimen, remounted on Replay so it plays again. */
export function AnimationDemo({ cls, demo }: { cls: string; demo: Demo }) {
  const [run, setRun] = useState(0);

  return (
    <>
      <Specimen key={run} cls={cls} demo={demo} />
      {demo === "bell" ? (
        <span className="text-note text-ink-meta">Point at it</span>
      ) : demo === "dots" ? (
        <span className="text-note text-ink-meta">Loops while Scout thinks</span>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setRun((n) => n + 1)}>
          Replay
        </Button>
      )}
    </>
  );
}

const MONTHS = ["August 2026", "September 2026", "October 2026", "November 2026", "December 2026"];

/** The Calendar's step, on its own: the arrows tag their transition with a
 *  direction, as the Calendar's links do with `transitionTypes`, and the
 *  keyed title slides the way it went. */
export function StepDemo() {
  const [month, setMonth] = useState(2);

  const step = (to: number, type: "nav-back" | "nav-forward") =>
    startTransition(() => {
      addTransitionType(type);
      setMonth(to);
    });

  return (
    <>
      <IconButton
        label="Previous month"
        variant="outline"
        className="size-8 rounded-full"
        disabled={month === 0}
        onClick={() => step(month - 1, "nav-back")}
      >
        <ChevronLeft className="size-4" />
      </IconButton>
      <span className="w-36 overflow-hidden text-center">
        <ViewTransition
          key={month}
          enter={{ "nav-forward": "step-forward", "nav-back": "step-back", default: "none" }}
          exit={{ "nav-forward": "step-forward", "nav-back": "step-back", default: "none" }}
          default="none"
        >
          <span className="text-label text-ink inline-block">{MONTHS[month]}</span>
        </ViewTransition>
      </span>
      <IconButton
        label="Next month"
        variant="outline"
        className="size-8 rounded-full"
        disabled={month === MONTHS.length - 1}
        onClick={() => step(month + 1, "nav-forward")}
      >
        <ChevronRight className="size-4" />
      </IconButton>
    </>
  );
}

const STAGES = ["Saved", "Applied", "Interviewing", "Offer"];

/** Four items keyed by name, rotated in a transition: each glides to its
 *  new place, as a sorted or filtered Applications view does. */
export function ReflowDemo() {
  const [order, setOrder] = useState(STAGES);

  return (
    <>
      <ul className="flex flex-wrap gap-2">
        {order.map((stage) => (
          <ViewTransition key={stage} update="reflow" default="none">
            <li className="bg-app text-note text-ink rounded-control px-3 py-1.5 font-medium">
              {stage}
            </li>
          </ViewTransition>
        ))}
      </ul>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => startTransition(() => setOrder(([first, ...rest]) => [...rest, first]))}
      >
        Rotate
      </Button>
    </>
  );
}

/** Two links that move `?pick=` in place: the readout crossfades the moment
 *  one is clicked, and the address bar follows a frame later. The page
 *  wraps this in <ShallowRouting>, as the seeker layout wraps its pages. */
export function ShallowDemo() {
  const pick = useShallowParams().get("pick") ?? "one";

  return (
    <>
      {["one", "two"].map((option) => (
        <ShallowLink
          key={option}
          href={option === "one" ? "/design-kit/motion" : `/design-kit/motion?pick=${option}`}
          scroll={false}
          className="text-label text-brand hover:text-brand-hover rounded-xs font-medium capitalize transition-colors duration-150"
        >
          {option}
        </ShallowLink>
      ))}
      <ViewTransition key={pick} enter="swap-enter" exit="swap-exit" default="none">
        <code className="text-note text-ink font-mono">?pick={pick}</code>
      </ViewTransition>
    </>
  );
}

/** <AnimatedNumber> counting between three figures. */
export function CountDemo() {
  const [value, setValue] = useState("18");

  return (
    <>
      <span className="text-display text-ink w-20">
        <AnimatedNumber value={Number(value)} />
      </span>
      <SegmentedToggle
        label="Figure"
        value={value}
        onValueChange={setValue}
        options={["5", "18", "214"].map((figure) => ({ value: figure, label: figure }))}
      />
    </>
  );
}
