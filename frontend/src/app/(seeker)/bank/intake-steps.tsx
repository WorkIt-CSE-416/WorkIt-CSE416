"use client";

import { ChevronLeft } from "lucide-react";

import type { Section } from "@/lib/bank-actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import { sectionOf } from "./sections";

/**
 * Intake's step bar (KAN-214), after the intake prototype's variant G: one
 * segment per section, in the order intake leads a student through them
 * (user story 41), with Back on the left and Skip on the right. A segment
 * jumps to its section on a click. The bar starts at HEAD_START and fills
 * as sections are done; the current segment fills as its draft grows.
 *
 * A skipped section counts toward the percentage, as in the prototype: the
 * bar measures the sections the student has dealt with, and a student with
 * no awards should still reach 100%. Its segment stays striped, not filled.
 *
 * `compact` (Scout's panel, KAN-249) is the segments alone, thinner, for
 * the stage card (`draft-preview.tsx`) that names the section and the step
 * and holds Skip above them. A segment still jumps, so it needs no Back.
 * The panel had drawn the bar, "Step 1 of 6 · Education" and a Skip in one
 * place and the draft with another Skip in a card under it; the two read as
 * unrelated and took room its chat needed. With no current section (every
 * one dealt with) it says how many are done beside the bar.
 */

/** The order intake walks: not the bank's, which puts Experience second. */
export const WALK: readonly Section[] = [
  "education",
  "projects",
  "leadership",
  "experience",
  "awards",
  "certifications",
];

const HEAD_START = 25;

type State = "done" | "skipped" | "current" | "todo";

const SHORT: Partial<Record<Section, string>> = { leadership: "Leadership" };

export function StepBar({
  current,
  currentFill,
  filled,
  skipped,
  lead,
  busy = false,
  compact = false,
  onJump,
  onSkip,
}: {
  current: Section | null;
  /** How full the current segment is, 0 to 100. */
  currentFill: number;
  /** Sections with at least one entry in the bank. */
  filled: readonly Section[];
  skipped: readonly Section[];
  /** A step before the sections, shown done: onboarding's profile form. */
  lead?: string;
  /** While WorkIt answers: a late reply must not land on another section. */
  busy?: boolean;
  /** The segments alone, for Scout's panel's stage card. */
  compact?: boolean;
  onJump: (section: Section) => void;
  /** Omitted in `compact`, where the stage card has Skip. */
  onSkip?: () => void;
}) {
  const stateOf = (s: Section): State =>
    s === current
      ? "current"
      : filled.includes(s)
        ? "done"
        : skipped.includes(s)
          ? "skipped"
          : "todo";
  const states = WALK.map(stateOf);
  const finished = states.filter((s) => s === "done" || s === "skipped").length;
  const percent = Math.round(HEAD_START + ((100 - HEAD_START) * finished) / WALK.length);

  const index = current ? WALK.indexOf(current) : -1;
  const previous = index > 0 ? WALK[index - 1] : null;
  const offset = lead ? 1 : 0;
  const steps = WALK.length + offset;

  const cheer =
    percent === 100
      ? "Your experience bank is complete!"
      : finished === 0
        ? "You're off to a great start!"
        : finished >= WALK.length / 2
          ? "Over halfway there. Keep it up!"
          : "Nice work. Keep going!";

  const where = current ? (
    <>
      Step {index + 1 + offset} of {steps} ·{" "}
      <span className="text-brand font-semibold">{sectionOf(current).label}</span>
    </>
  ) : (
    `${finished + offset} of ${steps} steps done`
  );

  const segments = WALK.map((s, i) => (
    <Segment
      key={s}
      label={sectionOf(s).label}
      short={SHORT[s]}
      state={states[i]}
      fill={states[i] === "done" ? 100 : states[i] === "current" ? currentFill : 0}
      compact={compact}
      onClick={states[i] === "current" || busy ? undefined : () => onJump(s)}
    />
  ));

  if (compact) {
    return (
      <div className="flex items-center gap-3">
        <ol aria-label="Intake steps" className="flex flex-1 items-center gap-1">
          {segments}
        </ol>
        {!current && <p className="text-note text-ink-meta shrink-0">{where}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label={previous ? `Back to ${sectionOf(previous).label}` : "Back"}
          disabled={!previous || busy}
          onClick={() => previous && onJump(previous)}
          className="text-brand hover:bg-brand-tint disabled:text-brand-pale focus-visible:ring-brand-ring flex size-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:hover:bg-transparent"
        >
          <ChevronLeft aria-hidden className="size-5" strokeWidth={2.5} />
        </button>

        <ol aria-label="Intake steps" className="flex flex-1 items-start gap-1.5">
          {lead && <Segment label={lead} state="done" fill={100} />}
          {segments}
        </ol>

        {current && onSkip ? (
          // A text button, not a pill: pills are chips (KAN-251).
          <Button variant="ghost" size="sm" className="shrink-0" onClick={onSkip} disabled={busy}>
            Skip
          </Button>
        ) : (
          <span className="w-9 shrink-0" />
        )}
      </div>

      <div className="flex items-center justify-between gap-3 px-11">
        <p className="text-note text-ink-meta @3xl/main:hidden">{where}</p>
        <p className="text-note text-ink-meta ml-auto hidden @xl/main:block">
          {cheer} <span className="text-brand font-semibold tabular-nums">{percent}%</span>
        </p>
      </div>
    </div>
  );
}

function Segment({
  label,
  short,
  state,
  fill,
  compact = false,
  onClick,
}: {
  label: string;
  short?: string;
  state: State;
  fill: number;
  /** Thin, with no name under it: the stage card names the section. */
  compact?: boolean;
  onClick?: () => void;
}) {
  const note = state === "todo" ? "" : ` (${state})`;
  return (
    <li className="group relative flex-1">
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        aria-label={`${onClick ? "Go to " : ""}${label}${note}`}
        aria-current={state === "current" ? "step" : undefined}
        // The thin bar keeps the full bar's 28px hit area.
        className={cn(
          "focus-visible:ring-brand-ring block w-full rounded-full focus-visible:ring-2 focus-visible:outline-none disabled:cursor-default",
          compact ? "py-2.75" : "py-2",
        )}
      >
        <span
          className={cn(
            "ease-glide block overflow-hidden rounded-full transition-transform duration-200",
            compact ? "h-1.5" : "h-3",
            onClick && "group-hover:scale-y-125",
            state === "skipped"
              ? "bg-[repeating-linear-gradient(135deg,var(--color-brand-tint)_0_5px,var(--color-panel)_5px_10px)]"
              : "bg-brand-tint",
          )}
        >
          <span
            className="from-brand to-brand-pale ease-glide relative block h-full rounded-full bg-linear-to-r transition-[width] duration-300"
            style={{ width: `${fill}%` }}
          />
        </span>
      </button>
      {!compact && (
        <span
          aria-hidden
          className={cn(
            "text-meta hidden truncate text-center @3xl/main:block",
            state === "current" ? "text-brand font-semibold" : "text-ink-meta",
          )}
        >
          {state === "done" && "✓ "}
          {short ?? label}
        </span>
      )}
    </li>
  );
}
