import { CheckIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

/** Tailor's steps, in order: each its own view, so the student looks at one
 *  thing at a time. "review" is the tailored resume's own page. */
export type TailorStep = "pick" | "keywords" | "tailor" | "review";

export const TAILOR_STEPS: { value: TailorStep; label: string }[] = [
  { value: "pick", label: "Pick a Resume" },
  { value: "keywords", label: "Choose Keywords" },
  { value: "tailor", label: "Tailor" },
  { value: "review", label: "Review Changes" },
];

/**
 * The timeline over every Tailor view: the four steps, the done ones
 * checked, the current one named for screen readers (`aria-current`). It
 * only shows where the student is; moving between steps is each view's.
 */
export function TailorSteps({ current }: { current: TailorStep }) {
  const at = TAILOR_STEPS.findIndex((s) => s.value === current);
  return (
    <nav aria-label="Tailor steps" className="mt-4">
      <ol role="list" className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {TAILOR_STEPS.map((step, i) => {
          const done = i < at;
          const now = i === at;
          return (
            <li
              key={step.value}
              aria-current={now ? "step" : undefined}
              className="flex items-center gap-2"
            >
              <span
                className={cn(
                  "text-note flex size-6 shrink-0 items-center justify-center rounded-full border font-semibold tabular-nums",
                  done && "border-brand bg-brand text-on-brand",
                  now && "border-brand text-brand bg-brand-tint",
                  !done && !now && "border-border-subtle text-ink-meta",
                )}
              >
                {done ? <CheckIcon className="size-3.5" /> : i + 1}
              </span>
              <span className={cn("text-label", now ? "text-ink" : "text-ink-meta")}>
                {step.label}
              </span>
              {i < TAILOR_STEPS.length - 1 && (
                <span aria-hidden="true" className="bg-border-subtle mx-1 h-px w-6 sm:w-10" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
