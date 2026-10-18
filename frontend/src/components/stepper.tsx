import { CheckIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * The 1-2-3 rail above a flow of steps: the job composer
 * (company/jobs/new/composer.tsx) and applicant onboarding, both its pages
 * (onboarding/applicant). Promoted from company/jobs/new/ the day onboarding
 * became the second consumer.
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
 * TWO SIZES. `default` sits in the composer's header. `lg` is onboarding's,
 * which sets larger than the app (docs/screens.md): a 32px disc and 16px
 * labels, the size of the answers below it. At the default size onboarding's
 * steps were the smallest type on a screen whose question is 40px, and went
 * unnoticed.
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
  size?: keyof typeof SIZES;
  className?: string;
};

const SIZES = {
  default: {
    gap: "gap-2",
    rule: "h-px",
    disc: "text-meta size-5.5",
    check: "size-3.5",
    label: "text-label",
  },
  lg: {
    gap: "gap-2.5",
    rule: "h-0.5",
    disc: "text-body size-8",
    check: "size-4",
    label: "text-subtitle",
  },
};

export function Stepper({ steps, current, size = "default", className }: StepperProps) {
  const s = SIZES[size];
  return (
    <ol className={cn("flex items-center", className)}>
      {steps.map((step, index) => {
        const isCurrent = index === current;
        const isDone = index < current;

        return (
          <li
            key={step}
            className={cn("flex items-center", s.gap, index > 0 && "min-w-0 flex-1")}
            aria-current={isCurrent ? "step" : undefined}
          >
            {/* The rule leading into this step. It is the flexible part of the
                row, so the steps keep their natural width and the gaps take
                whatever is left. */}
            {index > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  "min-w-4 flex-1 rounded-full",
                  s.rule,
                  index <= current ? "bg-brand" : "bg-border",
                )}
              />
            )}

            <span
              aria-hidden="true"
              className={cn(
                "flex shrink-0 items-center justify-center rounded-full font-semibold",
                s.disc,
                isCurrent || isDone
                  ? "bg-brand text-on-brand"
                  : "border-ink-faint text-ink-meta border",
              )}
            >
              {isDone ? <CheckIcon className={s.check} /> : index + 1}
            </span>

            {/* text-subtitle carries a 600 weight of its own, so only the
                current step keeps it at lg. */}
            <span
              className={cn(
                "truncate",
                s.label,
                isCurrent ? "text-brand font-semibold" : isDone ? "text-ink" : "text-ink-meta",
                !isCurrent && size === "lg" && "font-medium",
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
