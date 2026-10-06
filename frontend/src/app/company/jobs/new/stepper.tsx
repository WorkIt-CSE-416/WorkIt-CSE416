import { CheckIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * The 1-2-3 rail above the composer.
 *
 * It draws every stage from the start, because the rail is what tells a
 * recruiter how long this is going to take before they start typing. The three
 * states read differently at a glance: a finished step swaps its number for a
 * check, the current one is the violet disc and label, and an upcoming one is
 * an outlined disc. The rule leading into a step fills violet once that step is
 * reached, so the filled part of the rail is the progress made.
 *
 * Nothing here is clickable. The footer's Back and Continue move between steps,
 * and Continue is also where Basic Details is checked: a rail you could click
 * past would skip that check.
 *
 * ON A PHONE ONLY THE CURRENT STEP KEEPS ITS LABEL ON SCREEN. Three labels in
 * a 343px column truncate each other ("Screeni…"), so the others go to
 * `max-sm:sr-only`: off the screen but still read out, so a screen reader hears
 * every step at every width.
 *
 * SEMANTICS: an <ol>, because the steps are ordered and a screen reader should
 * say how many there are. The current one carries aria-current="step". The
 * discs and the connecting rules are decoration and are hidden: the list
 * already numbers the steps, and a check glyph has nothing to say aloud.
 */
type StepperProps = {
  steps: readonly string[];
  /** Zero-based index of the step being worked on. */
  current: number;
  className?: string;
};

export function Stepper({ steps, current, className }: StepperProps) {
  return (
    <ol className={cn("flex items-center", className)}>
      {steps.map((step, index) => {
        const isCurrent = index === current;
        const isDone = index < current;

        return (
          <li
            key={step}
            className={cn("flex items-center gap-2", index > 0 && "min-w-0 flex-1")}
            aria-current={isCurrent ? "step" : undefined}
          >
            {/* The rule leading into this step. It is the flexible part of the
                row, so the steps keep their natural width and the gaps take
                whatever is left. */}
            {index > 0 && (
              <span
                aria-hidden="true"
                className={cn("h-px min-w-4 flex-1", index <= current ? "bg-brand" : "bg-border")}
              />
            )}

            <span
              aria-hidden="true"
              className={cn(
                "text-meta flex size-5.5 shrink-0 items-center justify-center rounded-full font-semibold",
                isCurrent || isDone
                  ? "bg-brand text-on-brand"
                  : "border-ink-faint text-ink-meta border",
              )}
            >
              {isDone ? <CheckIcon className="size-3.5" /> : index + 1}
            </span>

            <span
              className={cn(
                "text-label truncate",
                isCurrent ? "text-brand" : isDone ? "text-ink" : "text-ink-meta",
                !isCurrent && "max-sm:sr-only",
              )}
            >
              {step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
