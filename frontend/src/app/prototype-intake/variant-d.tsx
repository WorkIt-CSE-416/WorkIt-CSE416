"use client";

// PROTOTYPE (KAN-193), throwaway.
// D, "Card First + Stage Bar": B's card-first layout with the checklist moved
// into one bar across the top: a progress bar (from C) that opens at 25%, so
// the student starts with a head start, and a row of stages to jump to or
// skip. The account the student already made counts as the first step.

import { Check, MessageCircle, SkipForward } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

import { Composer, Messages, SectionPicker } from "./chat";
import { EntryCard } from "./entry-card";
import { SECTIONS, type Intake } from "./model";

export const NAME = "Card First + Stage Bar";

/** Where the bar starts: making the account already "counts". */
const HEAD_START = 25;

export function VariantD({ intake }: { intake: Intake }) {
  const [history, setHistory] = useState(false);

  const lastQuestion = [...intake.messages]
    .reverse()
    .find((m) => m.kind === "text" && m.from === "workit");

  return (
    <div className="flex flex-col gap-4">
      <StageBar intake={intake} />

      <Card padding="lg" className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="bg-brand-tint text-brand flex size-9 shrink-0 items-center justify-center rounded-full">
            <MessageCircle className="size-4" />
          </span>
          <p className="text-subtitle text-ink">
            {lastQuestion?.kind === "text" ? lastQuestion.text : ""}
          </p>
        </div>

        <SectionPicker intake={intake} />
        {intake.draft && <Composer intake={intake} />}

        {intake.draft && (
          <div className="border-border-subtle border-t pt-4">
            {/* Skip lives in the stage bar here, so the card leaves its own out. */}
            <EntryCard intake={{ ...intake, walk: false }} />
          </div>
        )}
      </Card>

      <button
        onClick={() => setHistory(!history)}
        className="text-label text-ink-meta hover:text-ink self-start"
      >
        {history ? "Hide" : "Show"} Conversation ({intake.messages.length})
      </button>
      {history && (
        <Card>
          <Messages intake={intake} />
        </Card>
      )}
    </div>
  );
}

/** The progress bar and stage row; variant E reuses it. */
export function StageBar({ intake }: { intake: Intake }) {
  const finished = SECTIONS.filter((s) =>
    ["done", "skipped"].includes(intake.sectionState(s)),
  ).length;
  const percent = Math.round(HEAD_START + ((100 - HEAD_START) * finished) / SECTIONS.length);

  return (
    <Card padding="sm" className="flex flex-col gap-3">
      <div className="flex items-center gap-3 px-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-label text-ink">
              {percent === HEAD_START
                ? "You've started! "
                : percent === 100
                  ? "Your bank is complete. "
                  : "Keep going. "}
              <span className="text-ink-meta font-normal">{percent}% done</span>
            </p>
            {intake.walk && intake.section && (
              <Button variant="ghost" size="sm" onClick={intake.skip}>
                <SkipForward className="size-3.5" /> Skip {intake.section}
              </Button>
            )}
          </div>
          <div className="bg-app mt-1.5 h-2 overflow-hidden rounded-full">
            <div
              className="bg-brand h-full rounded-full transition-[width] duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      </div>

      <ol className="flex gap-1 overflow-x-auto pb-0.5">
        <li className="text-label bg-positive-tint text-positive-ink flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5">
          <Check className="size-3.5" /> Account
        </li>
        {SECTIONS.map((s) => {
          const st = intake.sectionState(s);
          return (
            <li key={s} className="shrink-0">
              <button
                // Any stage can be jumped to, a skipped one too.
                onClick={() => st !== "current" && intake.start(s)}
                aria-current={st === "current" ? "step" : undefined}
                className={cn(
                  "text-label flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors",
                  st === "current" && "bg-brand text-on-brand",
                  st === "done" && "bg-positive-tint text-positive-ink",
                  st === "skipped" && "bg-inert-tint text-ink-meta hover:bg-hover",
                  st === "todo" && "bg-app text-ink-meta hover:bg-hover",
                )}
              >
                {st === "done" && <Check className="size-3.5" />}
                {st === "skipped" && <SkipForward className="size-3.5" />}
                {s}
              </button>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
