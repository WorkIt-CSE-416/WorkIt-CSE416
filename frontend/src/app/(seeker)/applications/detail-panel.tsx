"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

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
 * the parameter. The trade is that the sheet's exit animation is cut short by
 * the navigation, which unmounts it.
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

  return (
    <Sheet
      open
      onOpenChange={(open) => {
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
              centre of the 16px dots, as Work Experience draws its own. */}
          <ol className="before:bg-border relative mt-4 flex flex-col gap-5 before:absolute before:top-2 before:bottom-2 before:left-[7px] before:w-0.5 before:content-['']">
            {steps.map((step) => (
              <Step key={step.id} step={step} />
            ))}
          </ol>
        </div>

        {footer && <div className="border-border-subtle border-t p-4">{footer}</div>}
      </SheetContent>
    </Sheet>
  );
}

function Step({ step }: { step: TimelineStep }) {
  const stage: StageKey = step.kind === "saved" ? "saved" : KIND_STAGE[step.kind];
  const filled = step.state !== "later";

  return (
    <li className="relative flex items-start gap-3">
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
          filled
            ? cn(STAGE_COLOR[stage].fill, "text-white")
            : "bg-panel border-border-strong border-2",
        )}
      >
        {step.state === "done" && <CheckIcon className="size-2.5" />}
      </span>

      <div className="min-w-0 flex-1">
        <p className={cn("text-label", step.state === "done" ? "text-ink-muted" : "text-ink")}>
          {step.title}
          {step.state === "next" && (
            <span className="ml-2 inline-flex align-middle">
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
