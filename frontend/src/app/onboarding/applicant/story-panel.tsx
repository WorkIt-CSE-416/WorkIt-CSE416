"use client";

import { useEffect, useState, type ReactNode, type Ref } from "react";

import { SparkleIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/cn";

import { Showcase } from "./showcase";

/**
 * Onboarding's left half: the step's question in large type over a lavender
 * wash, as the page's heading, with Scout at the panel's foot. The fields
 * answer it on the right, under the step rail. From `lg` a moving showcase
 * fills the room between the question and Scout (./showcase), and Scout types
 * a short tip in a chat bubble on every step, to make the wait between
 * questions feel alive. Below `lg` the panel is a band across the top holding
 * the logo and the question alone, so the first field is not a screen away;
 * the showcase also hides whenever the panel is too short to hold it.
 *
 * THE QUESTION AND SCOUT STAND APART (KAN-259). They were one block, Scout's
 * bubble 28px over the question, and the bubble asked the question again in
 * other words, so it was not clear who was asking. Now the question sits under
 * the logo as the page's h1, and Scout sits at the foot with a tip the
 * question does not already give. With the showcase hidden, the room between
 * them stays empty rather than pulling the question down to the foot.
 *
 * The question is focused on every step change (./onboarding-form), so a
 * screen reader reads the new one out. tabIndex -1 lets it take focus without
 * joining the tab order, and it draws no ring, since nothing can be done to it.
 *
 * From `lg` it fills the window's height and never scrolls: the screen is one
 * window tall and only the fields' column scrolls (./onboarding-form).
 *
 * The wash is the brand violet mixed thin over --color-brand-tint, so it
 * follows the palette rather than adding hexes of its own.
 */
const WASH = [
  "radial-gradient(55% 45% at 15% 90%, color-mix(in oklab, var(--color-brand) 22%, transparent), transparent 70%)",
  "radial-gradient(45% 40% at 90% 10%, color-mix(in oklab, var(--color-brand) 14%, transparent), transparent 70%)",
  "linear-gradient(160deg, var(--color-brand-tint), var(--color-frame))",
].join(", ");

export function StoryPanel({
  step,
  question,
  line,
  headingRef,
}: {
  step: number;
  question: ReactNode;
  /** What Scout types in its bubble on this step. */
  line: string;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  return (
    <aside style={{ background: WASH }} className="overflow-hidden px-6 lg:flex-[5] lg:px-12">
      <div className="flex flex-col gap-6 py-8 lg:h-full lg:gap-10 lg:py-10">
        <Logo size="card" className="self-start lg:h-10" />

        {/* Keyed on the step so each new question fades in. */}
        <h1
          key={step}
          ref={headingRef}
          tabIndex={-1}
          className="animate-fade text-display lg:text-hero text-ink max-w-xl font-normal outline-none [&_strong]:font-bold"
        >
          {question}
        </h1>

        <Showcase className="hidden min-h-0 flex-1 lg:block" />

        <div className="hidden items-start gap-2.5 lg:flex">
          <span className="bg-panel shadow-card flex size-14 shrink-0 items-center justify-center rounded-full">
            <SparkleIcon className="text-brand size-7" />
          </span>
          <div>
            <p className="text-title text-ink font-semibold">Scout</p>
            <p className="text-body text-ink-meta">Your WorkIt job assistant</p>
            {/* Keyed on the step so Scout types afresh each time. */}
            <ScoutBubble key={step} line={line} />
          </div>
        </div>
      </div>
    </aside>
  );
}

/** How long Scout "types" before its line appears. */
const TYPING_MS = 900;

/** Scout's line for the step: three dots that bob for a beat, then the line
 *  in a chat bubble. aria-hidden, since the tip repeats what the fields
 *  already say (the "Optional" beside a field, the boxes that take several)
 *  and the dots would announce nothing. Under reduced motion it skips the
 *  dots. */
function ScoutBubble({ line }: { line: string }) {
  const [typing, setTyping] = useState(true);
  useEffect(() => {
    const wait = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : TYPING_MS;
    const timer = setTimeout(() => setTyping(false), wait);
    return () => clearTimeout(timer);
  }, []);

  // THE BUBBLE'S ROOM IS HELD FROM THE START. An invisible copy of the
  // finished bubble sits in the same grid cell and sets the size, and the
  // real one grows from three dots to the line inside it. When the dots
  // simply became the line, the bubble grew a line taller, which pushed
  // Scout up 20px and took the height from the showcase above, so the
  // showcase shrank as Scout finished typing.
  return (
    <div aria-hidden className="mt-3 grid max-w-sm *:[grid-area:1/1]">
      <span className={cn(BUBBLE, "invisible")}>{line}</span>
      <span className={cn(BUBBLE, "animate-pop origin-top-left self-start justify-self-start")}>
        {typing ? (
          <span className="flex h-5 items-center gap-1">
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className="bg-ink-subtle animate-typing size-1.5 rounded-full"
                style={{ animationDelay: `${dot * 150}ms` }}
              />
            ))}
          </span>
        ) : (
          <span className="animate-fade block">{line}</span>
        )}
      </span>
    </div>
  );
}

const BUBBLE =
  "bg-panel shadow-card text-body text-ink-muted block rounded-2xl rounded-tl-md px-4 py-2.5";
