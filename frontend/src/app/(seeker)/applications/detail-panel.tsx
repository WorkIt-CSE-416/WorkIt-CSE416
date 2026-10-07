"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { CheckIcon } from "@/components/icons";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/shadcn/sheet";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

import { When } from "../local-time";
import { KIND_STAGE, STAGE_COLOR, STAGE_LABEL, type StageKey } from "../stage-colors";
import type { Application, TimelineStep } from "../tracker";
import { MatchBadge } from "./match-badge";

/**
 * One application in full: what it is, where it stands, and its timeline from
 * the day it was saved to the last thing scheduled. Opened by clicking any
 * card or row, and by the Dashboard's Next Up.
 *
 * IT IS A URL, ?app=<id>, not component state. The page renders it when the
 * parameter names an application, so a panel can be linked to, reloads open,
 * and the back button closes it. Closing navigates to the same page without
 * the parameter, but only once the sheet has slid out: the navigation
 * unmounts it, which used to cut its exit short. So a close shuts it here
 * first and navigates when Base UI says the exit is done
 * (onOpenChangeComplete). It remembers which `application` object it was
 * closed on, not which id, because every render of the page brings a fresh
 * one: reopening the same application before the navigation lands opens it
 * again rather than finding it shut.
 *
 * It arrives in order: the sheet slides in, then the timeline's rail draws
 * down as its steps rise in one after another, and the step it is waiting on
 * pulses three times with its Next badge popping in, so the eye lands there.
 *
 * Everything it shows arrives worked out: the steps and which one is next are
 * computed on the server (`timelineOf` in ../tracker.ts) against the request's
 * time, and only the dates are formatted here, in the viewer's own zone. The
 * company tile arrives rendered, because its icon is a component and a
 * component cannot cross into a client one as a prop.
 *
 * Each step wears its kind's stage colour (KIND_STAGE), the same as the
 * Dashboard's Up Next: a step behind is filled with a check, the one the
 * application is waiting on is filled and marked Next, and anything further
 * out is an empty ring.
 */
export type PanelApplication = Pick<
  Application,
  "id" | "role" | "company" | "stage" | "status" | "summary" | "match"
>;

export function DetailPanel({
  application,
  tile,
  steps,
  closeHref,
  footer,
}: {
  application: PanelApplication;
  tile: ReactNode;
  steps: TimelineStep[];
  closeHref: string;
  /** The way on from the page it was opened over: Show on Calendar from
   *  Applications, Open in Applications from the Calendar. */
  footer?: ReactNode;
}) {
  const router = useRouter();
  const { stage } = application;
  const [closedOn, setClosedOn] = useState<PanelApplication | null>(null);

  return (
    <Sheet
      open={closedOn !== application}
      onOpenChange={(open) => {
        if (!open) setClosedOn(application);
      }}
      onOpenChangeComplete={(open) => {
        if (!open) router.push(closeHref, { scroll: false });
      }}
    >
      {/* Full width on a phone, 448px from sm. The vendored widths are set
          under data-[side=right], so the overrides have to be too. */}
      <SheetContent className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-border-subtle gap-0 border-b p-5 pr-12">
          <div className="flex items-start gap-3">
            {tile}
            <div className="min-w-0">
              <SheetTitle className="text-title text-ink font-bold">{application.role}</SheetTitle>
              <SheetDescription className="text-body text-ink-meta">
                {application.company}
              </SheetDescription>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge tone={STAGE_COLOR[stage].tone}>{STAGE_LABEL[stage]}</Badge>
            {application.status && (
              <span className="text-note text-ink-meta">{application.status}</span>
            )}
            <span className="ml-auto">
              <MatchBadge score={application.match} />
            </span>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto overscroll-contain p-5">
          <p className="text-body text-ink-muted">{application.summary}</p>

          <h3 className="text-subtitle text-ink mt-6">Timeline</h3>
          {/* One rail for the whole list, drawn by the <ol> through the
              centre of the 16px dots, as Work Experience draws its own. It
              draws itself down while the steps arrive. */}
          <ol className="before:bg-border before:animate-draw-y relative mt-4 flex flex-col gap-5 before:absolute before:top-2 before:bottom-2 before:left-[7px] before:w-0.5 before:origin-top before:content-[''] before:[animation-delay:120ms]">
            {steps.map((step, i) => (
              // After the sheet is mostly in, 40ms apart, capped so a long
              // timeline never keeps its last steps waiting.
              <Step key={step.id} step={step} delay={120 + Math.min(i, 8) * 40} />
            ))}
          </ol>
        </div>

        {footer && <div className="border-border-subtle border-t p-4">{footer}</div>}
      </SheetContent>
    </Sheet>
  );
}

function Step({ step, delay }: { step: TimelineStep; delay: number }) {
  const stage: StageKey = step.kind === "saved" ? "saved" : KIND_STAGE[step.kind];
  const filled = step.state !== "later";
  const next = step.state === "next";

  return (
    <li
      className="animate-rise relative flex items-start gap-3"
      style={{ animationDelay: `${delay}ms` }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
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
        {step.state === "done" && <CheckIcon className="size-2.5" />}
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
      </div>
    </li>
  );
}
