import { cn } from "@/lib/cn";

import { LocalDate } from "../local-time";
import { KIND_STAGE, STAGE_COLOR, STAGE_LABEL, type StageKey } from "../stage-colors";
import { sortKey, type Application } from "../tracker";

/** The stages a search moves through, as a card's line of steps. The last
 *  step is Offer, or Rejected once the application was turned down. */
const PATH = ["saved", "applied", "interviewing"] as const;

/** The ring around the step an application stands at, in its stage's tint.
 *  Written out whole: Tailwind only builds classes it can read in the source. */
const RING: Record<StageKey, string> = {
  saved: "ring-inert-tint",
  applied: "ring-brand-tint",
  interviewing: "ring-warning-tint",
  offer: "ring-positive-tint",
  rejected: "ring-danger-tint",
};

/** The day an application reached `stage`: the day it was saved or sent, or
 *  its first dated entry of that stage (an interview or assessment for
 *  Interviewing, the offer, the rejection). Null when it has none. */
function reachedOn(app: Application, stage: StageKey): string | null {
  if (stage === "saved") return app.savedOn;
  if (stage === "applied") return app.appliedOn;
  const days = app.events
    .filter((event) => KIND_STAGE[event.kind] === stage)
    .map((event) => event.at)
    .sort((a, b) => sortKey(a) - sortKey(b));
  return days[0] ?? null;
}

/**
 * An application's stages as a line of steps on its Tracker card, after
 * Simplify's tracker (2026-11-05): Saved, Applied, Interviewing, then Offer
 * or Rejected, each a dot on one rail with its name above and the day it was
 * reached below.
 *
 * A step is reached when the application is at it or past it, so an Offer
 * fills Saved to Offer even with no interview entered. A rejection fills
 * Interviewing only when an interview or assessment was entered: otherwise
 * it was turned down straight after applying. The step it stands at wears its
 * stage's colour with a ring; steps behind it are filled in the same colour,
 * and the rail between reached steps is tinted. No step is a control: the
 * card's stage menu changes the stage.
 */
export function StageSteps({ app, className }: { app: Application; className?: string }) {
  const last: StageKey = app.stage === "rejected" ? "rejected" : "offer";
  const steps: StageKey[] = [...PATH, last];
  const at = steps.indexOf(app.stage);
  const reached = (step: StageKey, i: number) =>
    app.stage === "rejected" && step === "interviewing"
      ? reachedOn(app, "interviewing") != null
      : i <= at;
  const tone = STAGE_COLOR[app.stage];

  return (
    <ol
      aria-label={`Stage: ${STAGE_LABEL[app.stage]}`}
      className={cn("grid grid-cols-4", className)}
    >
      {steps.map((step, i) => {
        const done = reached(step, i);
        const current = step === app.stage;
        const day = done ? reachedOn(app, step) : null;
        const nextDone = i < steps.length - 1 && reached(steps[i + 1], i + 1);
        return (
          <li
            key={step}
            aria-current={current ? "step" : undefined}
            className="relative flex flex-col items-center gap-1.5 text-center"
          >
            <span
              className={cn(
                "text-meta truncate",
                current ? "text-ink font-semibold" : done ? "text-ink-muted" : "text-ink-meta",
              )}
            >
              {STAGE_LABEL[step]}
            </span>
            {/* The rail to the next step, from this dot's centre to the next. */}
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-[1.65rem] left-1/2 h-0.5 w-full",
                  nextDone ? tone.tint : "bg-border-subtle",
                )}
              />
            )}
            <span
              aria-hidden
              className={cn(
                "relative z-[1] size-3.5 rounded-full border-2",
                done ? cn(tone.fill, "border-transparent") : "bg-panel border-border-strong",
                current && cn("ring-4", RING[app.stage]),
              )}
            />
            <span className="text-caption text-ink-meta h-4 tabular-nums">
              {day ? <LocalDate at={day} /> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
