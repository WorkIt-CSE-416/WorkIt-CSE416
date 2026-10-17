"use client";

import { useEffect, useState, type ReactNode } from "react";

import { SparkleIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/cn";

import { Showcase } from "./showcase";

/**
 * Onboarding's left half: Scout asks the step's question in large type over a
 * lavender wash, and the bars under it count the steps. The fields answer it
 * on the right. From `lg` a moving showcase fills the room above the
 * question (./showcase) and Scout types a short line in a chat bubble on
 * every step, to make the wait between questions feel alive. Both are
 * dropped below `lg`, and the showcase also whenever the panel is too short
 * to hold it.
 *
 * Below `lg` it is a band across the top rather than a column, since the
 * question is the step's only heading and a phone still needs it. From `lg`
 * it fills the window's height and never scrolls: the screen is one window
 * tall and only the fields' column scrolls (./onboarding-form).
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
  total,
  question,
  line,
}: {
  step: number;
  total: number;
  question: ReactNode;
  /** What Scout types in its bubble on this step. */
  line: string;
}) {
  return (
    <aside style={{ background: WASH }} className="overflow-hidden px-6 lg:flex-[5] lg:px-12">
      <div className="flex flex-col gap-8 py-8 lg:h-full lg:justify-between lg:gap-6 lg:py-10">
        <Logo size="card" className="self-start lg:h-10" />

        <Showcase className="hidden min-h-0 flex-1 lg:block" />

        {/* Set in from the panel's edge and lifted off the step bars, so the
            question reads as its own block rather than sitting on the bars. */}
        <div className="flex max-w-md flex-col gap-5 lg:mb-8 lg:ml-6 lg:max-w-xl lg:gap-7">
          <div className="flex items-start gap-2.5">
            <span className="bg-panel shadow-card flex size-10 items-center justify-center rounded-full lg:size-14">
              <SparkleIcon className="text-brand size-5 lg:size-7" />
            </span>
            <div>
              <p className="text-body text-ink lg:text-title font-semibold">Scout</p>
              <p className="text-note text-ink-meta lg:text-body">Your WorkIt job assistant</p>
              {/* Keyed on the step so Scout types afresh each time. */}
              <ScoutBubble key={step} line={line} />
            </div>
          </div>
          {/* Keyed on the step so each new question fades in. */}
          <p
            key={step}
            className="animate-fade text-display lg:text-hero text-ink font-normal [&_strong]:font-bold"
          >
            {question}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex gap-1.5" aria-hidden>
            {Array.from({ length: total }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors duration-300 lg:h-2",
                  i <= step ? "bg-brand" : "bg-brand/15",
                )}
              />
            ))}
          </div>
          <p className="text-note text-ink-meta lg:text-body">
            Step {step + 1} of {total}
          </p>
        </div>
      </div>
    </aside>
  );
}

/** How long Scout "types" before its line appears. */
const TYPING_MS = 900;

/** Scout's line for the step: three dots that bob for a beat, then the line
 *  in a chat bubble. aria-hidden, since it restates the question beside it
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
    <div aria-hidden className="mt-3 hidden max-w-sm *:[grid-area:1/1] lg:grid">
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
