"use client";

import {
  BadgeCheck,
  Briefcase,
  Check,
  ChevronLeft,
  GraduationCap,
  Lightbulb,
  Minus,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

import type { Section } from "@/lib/bank-actions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import { sectionOf } from "./sections";

/**
 * Intake's step bar (KAN-214), in the order intake leads a student through
 * the sections (user story 41), with Back on the left and Skip on the right.
 * The percentage starts at HEAD_START and grows as sections are dealt with.
 *
 * A skipped section counts toward the percentage, as in the prototype: the
 * bar measures the sections the student has dealt with, and a student with
 * no awards should still reach 100%.
 *
 * AN ICON STEPPER (KAN-257): one round chip per section, carrying the
 * section's own glyph (`ICONS`, the ones the chat's chapter lines use), on a
 * line from the first chip to the last. Each meaning has one signal:
 * - where the walk is: the chip filled with the brand, ringed;
 * - what became of the section: a corner badge, a green check when done and
 *   a grey dash when skipped, and a dashed edge on a skipped chip;
 * - which section: the glyph, and the name in the tooltip (and under the
 *   chip where the bar has the room, outside Scout's panel).
 * Only a save changes a badge, so a visit to a done entry ("Leave As Is")
 * keeps its check, and the section still counts toward the percentage.
 * A chip is a 32px button that jumps to its section.
 *
 * It replaced a bar of thin segments, unlabelled in Scout's panel, where a
 * 6px sliver was the target for a jump and colour carried everything: done
 * green, untouched grey, skipped hatched, current ringed, and the current
 * draft's progress filling in brand. Visiting a done section had also turned
 * it purple, as if it had come undone. The draft's progress now lives in the
 * draft card's own status ("Still needed: Start Date").
 *
 * `compact` (Scout's panel, KAN-249) is the whole of the stage card
 * (KAN-257): the current section's name and "Section 1 of 6" over the chips,
 * and nothing to act on but the chips. Edit, Skip and the draft moved into
 * the chat, under Scout's latest line (`draft-preview.tsx`), where they had
 * crowded a card that is for finding your way. A chip still jumps, so it
 * needs no Back. With no current section (every one dealt with) it reads
 * "Your Sections" and how many are done.
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

/** Each section's glyph: its step chip, the chat's chapter line, the draft
 *  form's header and the sections Scout offers to start. */
export const ICONS: Record<Section, LucideIcon> = {
  education: GraduationCap,
  experience: Briefcase,
  projects: Lightbulb,
  leadership: Users,
  awards: Trophy,
  certifications: BadgeCheck,
};

const HEAD_START = 25;

/** What became of a section. Where the walk is, is separate: `current`. */
type State = "done" | "skipped" | "todo";

/** A state as its status label, in Title Case as a badge's is: a chip's
 *  tooltip pairs it with the section's name ("Projects · Not Started"), and
 *  its accessible name carries it. In lower case beside a Title Case name,
 *  the pair read as a sentence that had lost its start. */
const STATUS: Record<State, string> = { done: "Done", skipped: "Skipped", todo: "Not Started" };

const SHORT: Partial<Record<Section, string>> = { leadership: "Leadership" };

export function StepBar({
  current,
  filled,
  skipped,
  busy = false,
  compact = false,
  onJump,
  onSkip,
}: {
  current: Section | null;
  /** Sections with at least one entry in the bank. */
  filled: readonly Section[];
  skipped: readonly Section[];
  /** While Scout answers: a late reply must not land on another section. */
  busy?: boolean;
  /** The chips alone, for Scout's panel's stage card. */
  compact?: boolean;
  onJump: (section: Section) => void;
  /** Omitted in `compact`, where the stage card has Skip. */
  onSkip?: () => void;
}) {
  const stateOf = (s: Section): State =>
    filled.includes(s) ? "done" : skipped.includes(s) ? "skipped" : "todo";
  const states = WALK.map(stateOf);
  const finished = states.filter((s) => s !== "todo").length;
  const percent = Math.round(HEAD_START + ((100 - HEAD_START) * finished) / WALK.length);

  const index = current ? WALK.indexOf(current) : -1;
  const previous = index > 0 ? WALK[index - 1] : null;

  const cheer =
    percent === 100
      ? "Your experience bank is complete!"
      : finished === 0
        ? "You're off to a great start!"
        : finished >= WALK.length / 2
          ? "Over halfway there. Keep it up!"
          : "Nice work. Keep going!";

  // "Section", not "Step": onboarding's Experiences page had the step rail
  // above this bar until KAN-275 took intake out of onboarding, and two
  // "Step x of y" counts on one page read as one count gone wrong (KAN-259).
  const where = current ? (
    <>
      Section {index + 1} of {WALK.length} ·{" "}
      <span className="text-brand font-semibold">{sectionOf(current).label}</span>
    </>
  ) : (
    `${finished} of ${WALK.length} sections done`
  );

  // The badges' ring is the colour the bar sits on, so a badge reads as cut
  // out of its chip: the stage card's lavender, or the page's grey.
  const ground = compact ? "ring-stage-card" : "ring-canvas";

  const chips = (
    <ol
      aria-label="Intake steps"
      // The line the chips sit on runs from the first chip's centre to the
      // last's: half a column in from each end.
      style={{ "--edge": `${50 / WALK.length}%` } as CSSProperties}
      className="before:bg-brand-pale relative grid grid-cols-6 before:absolute before:top-4 before:right-(--edge) before:left-(--edge) before:h-0.5 before:-translate-y-1/2"
    >
      {WALK.map((s, i) => (
        <StepChip
          key={s}
          label={sectionOf(s).label}
          short={SHORT[s]}
          icon={ICONS[s]}
          state={states[i]}
          current={s === current}
          ground={ground}
          named={!compact}
          onClick={s === current || busy ? undefined : () => onJump(s)}
        />
      ))}
    </ol>
  );

  if (compact) {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-label text-ink truncate font-semibold">
            {current ? sectionOf(current).label : "Your Sections"}
          </p>
          <p className="text-note text-ink-meta shrink-0">
            {current
              ? `Section ${index + 1} of ${WALK.length}`
              : `${finished} of ${WALK.length} done`}
          </p>
        </div>
        {chips}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Back and Skip are 36px; up 2px, they centre on the 32px chips. */}
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label={previous ? `Back to ${sectionOf(previous).label}` : "Back"}
          disabled={!previous || busy}
          onClick={() => previous && onJump(previous)}
          className="text-brand hover:bg-brand-tint disabled:text-brand-pale focus-visible:ring-brand-ring -mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:hover:bg-transparent"
        >
          <ChevronLeft aria-hidden className="size-5" strokeWidth={2.5} />
        </button>

        <div className="min-w-0 flex-1">{chips}</div>

        {current && onSkip ? (
          // A text button, not a pill: pills are chips (KAN-251).
          <Button
            variant="ghost"
            size="sm"
            className="-mt-0.5 shrink-0"
            onClick={onSkip}
            disabled={busy}
          >
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

function StepChip({
  label,
  short,
  icon: Icon,
  state,
  current = false,
  ground,
  named,
  onClick,
}: {
  label: string;
  short?: string;
  icon: LucideIcon;
  state: State;
  /** Where the walk is: the brand fill and ring, over the state's badge. */
  current?: boolean;
  /** The ring class that matches what the bar sits on. */
  ground: string;
  /** The name under the chip, where the bar is wide enough (not docked). */
  named: boolean;
  onClick?: () => void;
}) {
  return (
    <li className="flex min-w-0 flex-col items-center gap-1">
      <Tooltip>
        <TooltipTrigger
          type="button"
          onClick={onClick}
          disabled={!onClick}
          aria-label={
            current
              ? `${label} (Current Step, ${STATUS[state]})`
              : `${onClick ? "Go to " : ""}${label} (${STATUS[state]})`
          }
          aria-current={current ? "step" : undefined}
          className="group focus-visible:ring-brand-ring rounded-full transition-transform duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none enabled:active:scale-90 disabled:cursor-default"
        >
          <span
            className={cn(
              // The ring is an outline, always drawn and only coloured, so it
              // eases to the next chip; its gap shows the ground behind.
              "relative flex size-8 items-center justify-center rounded-full border outline-2 outline-offset-2 transition-[background-color,border-color,color,outline-color] duration-150 ease-out",
              current
                ? "bg-brand border-brand text-on-brand outline-brand"
                : cn(
                    "bg-panel border-step-outline outline-transparent",
                    state === "done" ? "text-ink-muted" : "text-ink-faint",
                    state === "skipped" && "border-dashed",
                    onClick && "group-hover:border-brand group-hover:text-brand",
                  ),
            )}
          >
            <Icon aria-hidden className="size-4" />
            {state !== "todo" && (
              <span
                aria-hidden
                className={cn(
                  "text-on-brand absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full ring-2",
                  state === "done" ? "bg-step-done" : "bg-ink-faint",
                  ground,
                )}
              >
                {state === "done" ? (
                  <Check className="size-2.5" strokeWidth={3.5} />
                ) : (
                  <Minus className="size-2.5" strokeWidth={3.5} />
                )}
              </span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {label} · {current ? "Current Step" : STATUS[state]}
        </TooltipContent>
      </Tooltip>
      {named && (
        <span
          aria-hidden
          className={cn(
            "text-meta hidden max-w-full truncate text-center @3xl/main:block",
            current ? "text-brand font-semibold" : "text-ink-meta",
          )}
        >
          {short ?? label}
        </span>
      )}
    </li>
  );
}
