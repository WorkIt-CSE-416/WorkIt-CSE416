import { CheckIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

/** Tailor's steps, in order: each its own view, so the student looks at one
 *  thing at a time. "review" is the tailored resume's own page. The run
 *  itself was a fourth step, Tailor, until 2026-10-26; it only waited, so
 *  it is now a loader over Choose Keywords (`TailorRunning`). */
export type TailorStep = "pick" | "keywords" | "review";

export const TAILOR_STEPS: { value: TailorStep; label: string }[] = [
  { value: "pick", label: "Pick a Resume" },
  { value: "keywords", label: "Choose Keywords" },
  { value: "review", label: "Review Changes" },
];

/**
 * The timeline over every Tailor view: the three steps, the done ones
 * checked and the line after them in brand, the current one named for
 * screen readers (`aria-current`). It only shows where the student is;
 * moving between steps is each view's. Even columns, each label under
 * its circle, so it holds one row at every width: as one wrapping row of
 * circle, label and line, a phone broke it over three rows with lines
 * hanging at their ends.
 */
export function TailorSteps({ current }: { current: TailorStep }) {
  const at = TAILOR_STEPS.findIndex((s) => s.value === current);
  return (
    <nav aria-label="Tailor steps" className="mt-4">
      <ol role="list" className="grid grid-cols-3">
        {TAILOR_STEPS.map((step, i) => {
          const done = i < at;
          const now = i === at;
          return (
            <li
              key={step.value}
              aria-current={now ? "step" : undefined}
              className="flex min-w-0 flex-col gap-1.5"
            >
              <div className="flex items-center">
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
                {i < TAILOR_STEPS.length - 1 && (
                  <span
                    aria-hidden="true"
                    className={cn("mx-2 h-px flex-1", done ? "bg-brand" : "bg-border-subtle")}
                  />
                )}
              </div>
              <span className={cn("text-label pr-2", now ? "text-ink" : "text-ink-meta")}>
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
