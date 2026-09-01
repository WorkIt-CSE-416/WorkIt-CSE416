import { cn } from "@/lib/cn";

/**
 * The 1-2-3 rail above the composer.
 *
 * It draws all three stages even though only the first is built, because the
 * rail is what tells a recruiter how long this is going to take before they
 * start typing. A one-step rail would be a progress indicator that never
 * progresses; three steps with two of them dimmed is the honest version — it
 * shows what is ahead without claiming either is reachable yet.
 *
 * Nothing here is clickable for the same reason. A step you cannot go to is not
 * a link, and the repo's rule for a route nobody has drawn is a link that 404s
 * rather than a control that quietly does nothing — so an unbuilt step is plain
 * text until there is a screen behind it.
 *
 * SEMANTICS: an <ol>, because the steps are ordered and a screen reader should
 * say how many there are. The current one carries aria-current="step"; the
 * numbers are in the markup rather than in a ::before counter so they are read
 * out with the label. The connecting rules are decoration and are hidden.
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
            {index > 0 && <span aria-hidden="true" className="bg-border h-px min-w-4 flex-1" />}

            <span
              aria-hidden="true"
              className={cn(
                "text-meta flex size-5.5 shrink-0 items-center justify-center rounded-full font-semibold",
                isCurrent || isDone
                  ? "bg-brand text-on-brand"
                  : "border-border-strong text-ink-faint border",
              )}
            >
              {index + 1}
            </span>

            <span
              className={cn(
                "text-label truncate",
                isCurrent ? "text-brand" : isDone ? "text-ink" : "text-ink-faint",
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
