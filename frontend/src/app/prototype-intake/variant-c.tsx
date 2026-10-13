"use client";

// PROTOTYPE (KAN-193), throwaway.
// C, "Card in the Chat": one column, like Scout. The draft entry card is a
// message in the stream that updates in place; a saved entry folds into a
// one-line receipt. Progress is a thin bar in the header with Skip beside it.
// The duplicate warning arrives as WorkIt's own message. Same on a phone.

import { MessageCircle } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { Bubble, Composer, SectionPicker } from "./chat";
import { DuplicateWarning, EntryCard } from "./entry-card";
import { SECTIONS, type Intake } from "./model";

export const NAME = "Card in the Chat";

export function VariantC({ intake }: { intake: Intake }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [intake.messages.length, intake.duplicate]);

  const done = SECTIONS.filter((s) => ["done", "skipped"].includes(intake.sectionState(s))).length;

  // The live card sits right after the message that opened the current draft.
  const cardAt = intake.draft
    ? intake.messages.findLastIndex((m) => m.kind === "text" && !!m.opensDraft)
    : -1;

  return (
    <Card
      padding="none"
      className="mx-auto flex h-[min(40rem,calc(100dvh-14rem))] w-full max-w-2xl flex-col"
    >
      <header className="border-border-subtle flex items-center gap-3 border-b px-4 py-3">
        <span className="bg-brand-tint text-brand flex size-8 shrink-0 items-center justify-center rounded-full">
          <MessageCircle className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-label text-ink">
            {intake.walk && intake.section
              ? `${intake.section} · ${SECTIONS.indexOf(intake.section) + 1} of ${SECTIONS.length}`
              : "Add to Your Bank"}
          </p>
          {intake.walk && (
            <div className="bg-app mt-1 h-1 overflow-hidden rounded-full">
              <div
                className="bg-brand h-full rounded-full transition-[width]"
                style={{ width: `${(done / SECTIONS.length) * 100}%` }}
              />
            </div>
          )}
        </div>
        {intake.walk && intake.section && (
          <Button variant="ghost" size="sm" onClick={intake.skip}>
            Skip Section
          </Button>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-4">
        {intake.messages.map((m, i) => (
          <div key={i} className="contents">
            <Bubble m={m} />
            {i === cardAt && <LiveCard intake={intake} />}
          </div>
        ))}
        {intake.duplicate && (
          <div className="max-w-[85%] self-start">
            <DuplicateWarning intake={intake} />
          </div>
        )}
        <div ref={end} />
      </div>

      <div className="flex flex-col gap-2 p-3">
        <SectionPicker intake={intake} />
        <Composer intake={intake} />
      </div>
    </Card>
  );
}

function LiveCard({ intake }: { intake: Intake }) {
  // The warning shows as its own message below, so hide the card's copy of it.
  return (
    <div className="border-brand-pale bg-panel w-full rounded-2xl border-2 p-3 [&_[role=alert]]:hidden">
      <EntryCard intake={intake} dense />
    </div>
  );
}
