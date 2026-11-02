"use client";

import { CheckIcon, SparkleIcon } from "@/components/icons";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/shadcn/dialog";
import { cn } from "@/lib/cn";

/** The run's phases, in order, by the streamed run's lines
 *  (`TailorStreamEvent`): the first until the API sends `asking`, and the
 *  last once `done` has come and the editor loads. */
const PHASE = {
  retrieving: "Reading your resume and the job",
  asking: "Rewriting your bullets",
  generating: "Building your tailored resume",
  compiling: "Opening your resume",
} as const;
export type Phase = keyof typeof PHASE;
const PHASES = Object.keys(PHASE) as Phase[];

/** The little page's rows, top to bottom: a section's heading, or a bullet
 *  at a share of the column. Only bullets are rewritten, as in a real run. */
const ROWS = [
  { heading: 30 },
  { bullet: 96 },
  { bullet: 84 },
  { bullet: 91 },
  { heading: 24 },
  { bullet: 88 },
  { bullet: 97 },
  { bullet: 70 },
  { heading: 34 },
  { bullet: 92 },
  { bullet: 80 },
];

/** A resume, drawn small, whose bullets turn brand one after another: the
 *  run shown as what it does. It stands in the tint, cut off by the panel's
 *  foot, so it reads as a page on a desk and not an icon. */
function RewritingPage() {
  return (
    <div
      aria-hidden
      className="bg-brand-tint relative flex h-44 justify-center overflow-hidden pt-6"
    >
      <div className="relative">
        <div className="bg-panel shadow-lift h-56 w-40 rounded-t-md px-4 pt-4">
          <span className="bg-ink/70 mx-auto block h-1.5 w-1/2 rounded-full" />
          <span className="bg-ink/15 mx-auto mt-1 block h-1 w-3/4 rounded-full" />
          {ROWS.map((row, i) =>
            "heading" in row ? (
              <span
                key={`heading-${row.heading}`}
                className="bg-ink/40 mt-3 block h-1 rounded-full"
                style={{ width: `${row.heading}%` }}
              />
            ) : (
              <span
                key={`bullet-${row.bullet}`}
                className="bg-ink/10 mt-1.5 block h-1 overflow-hidden rounded-full"
                style={{ width: `${row.bullet}%` }}
              >
                <span
                  className="bg-brand animate-rewrite block h-full origin-left rounded-full"
                  style={{ animationDelay: `${i * 200}ms` }}
                />
              </span>
            ),
          )}
        </div>
        <span className="bg-brand text-on-brand shadow-lift absolute -top-2.5 -right-3 flex size-7 items-center justify-center rounded-full">
          <SparkleIcon className="size-3.5" />
        </span>
      </div>
    </div>
  );
}

/**
 * The run, over Choose Keywords: a modal with the page being rewritten, the
 * resume's name, and the run's phases as a list as the stream reports them: a
 * check on each done, a spinner on the one running, and a small dot on those
 * to come. It cannot be closed (Esc and a click outside do nothing: a run
 * cannot be stopped); a failed run closes it and shows its error on the card
 * under it, and a finished one opens the tailored resume (Review Changes).
 *
 * The list stays: one sentence over a thin four-part bar was tried on
 * 2026-11-01, and the user wanted to watch the steps finish. What went is the
 * old list's circle on every row, an empty one and one with a dot, which read
 * as radio buttons under a spinner of their own. Tailor was a step of its own
 * until 2026-10-26, a view that only waited.
 */
export function TailorRunning({
  open,
  phase,
  resume,
}: {
  open: boolean;
  phase: Phase;
  resume: string | undefined;
}) {
  const at = PHASES.indexOf(phase);
  return (
    <Dialog open={open}>
      <DialogContent showCloseButton={false} className="gap-0 overflow-hidden p-0 sm:max-w-sm">
        <RewritingPage />
        <div className="px-6 pt-5 pb-6">
          <DialogTitle className="text-subtitle text-ink truncate text-center font-semibold">
            Tailoring {resume ?? "Your Resume"}
          </DialogTitle>
          <DialogDescription className="sr-only" role="status">
            {PHASE[phase]}
          </DialogDescription>
          <ol role="list" className="mx-auto mt-4 flex w-fit flex-col gap-2.5">
            {PHASES.map((key, i) => {
              const done = i < at;
              const now = i === at;
              return (
                <li
                  key={key}
                  aria-current={now ? "step" : undefined}
                  className={cn(
                    "text-label flex items-center gap-2.5 transition-colors duration-300",
                    now ? "text-ink" : done ? "text-ink-muted" : "text-ink-meta",
                  )}
                >
                  <span aria-hidden className="flex size-4.5 shrink-0 items-center justify-center">
                    {done ? (
                      <span className="bg-brand text-on-brand animate-pop flex size-full items-center justify-center rounded-full">
                        <CheckIcon className="size-3" />
                      </span>
                    ) : now ? (
                      <span className="border-brand-tint border-t-brand size-full animate-spin rounded-full border-2" />
                    ) : (
                      <span className="bg-border-strong size-1.5 rounded-full" />
                    )}
                  </span>
                  {PHASE[key]}
                </li>
              );
            })}
          </ol>
        </div>
      </DialogContent>
    </Dialog>
  );
}
