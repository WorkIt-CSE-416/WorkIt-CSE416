import type { CSSProperties } from "react";

import { FileIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

import { When } from "../local-time";
import { KIND_ICON, KIND_STAGE, STAGE_COLOR, STAGE_ICON, type StageKey } from "../stage-colors";
import type { TimelineStep } from "../tracker";

/**
 * An application's timeline: one dot per step on one rail, in its kind's
 * stage colour (KIND_STAGE), as Home's Up Next colours it. A step
 * behind, and the one the application is waiting on, is filled with its
 * stage's glyph (STAGE_ICON; a resume sent on its own wears the file), the
 * one waiting is marked Next too, and anything further out is an empty
 * ring. The glyph replaced a check on every step (KAN-317): the page's
 * timeline is all history, so a check on each step said nothing. Drawn by
 * the archived Calendar's detail panel and the application's own page
 * (./[jobId], KAN-256).
 *
 * It arrives in order: the rail draws down as the steps rise in one after
 * another, from `startDelay`, and the step it is waiting on pulses three
 * times with its Next badge popping in, so the eye lands there.
 *
 * `horizontal` lays it left to right, a step a column with its words under
 * its dot, for the top of the application's page, where it shares At a
 * Glance with the facts (KAN-256). Each step draws the rail to the next one;
 * the row scrolls sideways rather than squeezing a long timeline. A step is
 * at most 192px wide, so two dots never sit a whole card apart.
 */
export function Timeline({
  steps,
  startDelay = 0,
  horizontal = false,
  className,
}: {
  steps: TimelineStep[];
  horizontal?: boolean;
  /** When the first step rises, in ms: after whatever opens it. */
  startDelay?: number;
  className?: string;
}) {
  if (horizontal) {
    return (
      // overflow-y-hidden: the steps rise in from below, which flashed a
      // vertical scrollbar in the row on a phone.
      <div className={cn("overflow-x-auto overflow-y-hidden", className)}>
        <ol
          className="grid"
          style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(8rem, 12rem))` }}
        >
          {steps.map((step, i) => (
            <Step
              key={step.id}
              step={step}
              delay={startDelay + Math.min(i, 8) * 40}
              horizontal
              last={i === steps.length - 1}
            />
          ))}
        </ol>
      </div>
    );
  }

  return (
    // One rail for the whole list, drawn by the <ol> through the centre of
    // the 20px dots, as Work Experience draws its own.
    <ol
      className={cn(
        "before:bg-border before:animate-draw-y relative flex flex-col gap-5 before:absolute before:top-2.5 before:bottom-2.5 before:left-[9px] before:w-0.5 before:origin-top before:content-[''] before:[animation-delay:var(--rail-delay)]",
        className,
      )}
      // The rail starts with the first step; a custom property, since an
      // inline style cannot reach ::before.
      style={{ "--rail-delay": `${startDelay}ms` } as CSSProperties}
    >
      {steps.map((step, i) => (
        // 40ms apart, capped so a long timeline never keeps its last steps
        // waiting.
        <Step key={step.id} step={step} delay={startDelay + Math.min(i, 8) * 40} />
      ))}
    </ol>
  );
}

function Step({
  step,
  delay,
  horizontal = false,
  last = false,
}: {
  step: TimelineStep;
  delay: number;
  horizontal?: boolean;
  /** The last step on a horizontal row draws no rail after it. */
  last?: boolean;
}) {
  const stage: StageKey =
    step.kind === "saved" ? "saved" : step.kind === "sent" ? "applied" : KIND_STAGE[step.kind];
  const Glyph =
    step.kind === "sent"
      ? FileIcon
      : step.kind === "saved"
        ? STAGE_ICON.saved
        : KIND_ICON[step.kind];
  const filled = step.state !== "later";
  const next = step.state === "next";

  return (
    <li
      className={cn(
        "animate-rise relative flex items-start",
        horizontal ? "flex-col gap-2 pr-4" : "gap-3",
        // The rail to the next step: from this dot's right edge to the next
        // one's left, through the centre of the 20px dots.
        horizontal &&
          !last &&
          "before:bg-border before:animate-draw-x before:absolute before:top-[11px] before:right-0 before:left-6 before:h-0.5 before:origin-left before:content-['']",
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
          filled
            ? cn(STAGE_COLOR[stage].fill, "text-white")
            : "bg-panel border-border-strong border-2",
        )}
      >
        {/* The step it is waiting on rings out from its dot, once the step
            has risen in, the way the bar's status dot does. */}
        {next && (
          <span
            className={cn(
              "animate-status-ping absolute inset-0 rounded-full",
              STAGE_COLOR[stage].fill,
            )}
            style={{ animationDelay: `${delay + 260}ms` }}
          />
        )}
        {filled && <Glyph aria-hidden className="relative size-3" />}
      </span>

      <div className="min-w-0 flex-1">
        <p className={cn("text-label", step.state === "done" ? "text-ink-muted" : "text-ink")}>
          {step.title}
          {next && (
            <span
              className="animate-pop ml-2 inline-flex align-middle"
              style={{ animationDelay: `${delay + 160}ms` }}
            >
              <Badge tone={STAGE_COLOR[stage].tone}>Next</Badge>
            </span>
          )}
          {step.state === "done" && <span className="sr-only">, done</span>}
        </p>
        <p className="text-note text-ink-meta">
          <When at={step.at} />
        </p>
        {step.note && <p className="text-note text-ink-meta">{step.note}</p>}
      </div>
    </li>
  );
}
