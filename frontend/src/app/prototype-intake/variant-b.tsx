"use client";

// PROTOTYPE (KAN-193), throwaway.
// B, "Card First": the draft entry card is the page. WorkIt's current question
// sits on top of the card and the answer box at its foot; past messages fold
// away. A section checklist runs down the left, and on a phone it collapses
// into one "Section 2 of 6" line.

import { Check, ChevronDown, MessageCircle, SkipForward } from "lucide-react";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

import { Composer, Messages, SectionPicker } from "./chat";
import { EntryCard } from "./entry-card";
import { entryLabel, SECTIONS, type Intake } from "./model";

export const NAME = "Card First";

export function VariantB({ intake }: { intake: Intake }) {
  const [history, setHistory] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  const lastQuestion = [...intake.messages]
    .reverse()
    .find((m) => m.kind === "text" && m.from === "workit");
  const pos = intake.section ? SECTIONS.indexOf(intake.section) + 1 : SECTIONS.length;

  const checklist = (
    <ul className="flex flex-col gap-0.5">
      {SECTIONS.map((s) => {
        const st = intake.sectionState(s);
        const saved = intake.entries.filter((e) => e.section === s);
        return (
          <li
            key={s}
            className={cn("rounded-lg px-3 py-2", st === "current" && "bg-rail-selected")}
          >
            <div className="text-label text-ink flex items-center gap-2">
              {st === "done" ? (
                <Check className="text-positive size-4" />
              ) : st === "skipped" ? (
                <SkipForward className="text-ink-subtle size-4" />
              ) : (
                <span
                  className={cn(
                    "size-4 rounded-full border-2",
                    st === "current" ? "border-brand" : "border-border-strong",
                  )}
                />
              )}
              <span className={cn(st === "skipped" && "text-ink-meta")}>{s}</span>
            </div>
            {saved.map((e, i) => (
              <p key={i} className="text-note text-ink-meta truncate pl-6">
                {entryLabel(e)}
              </p>
            ))}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="grid gap-4 @3xl/main:grid-cols-[15rem_1fr]">
      {/* Desktop checklist */}
      <Card padding="sm" className="hidden self-start @3xl/main:block">
        <p className="text-caption text-ink-meta px-3 pb-2 uppercase">Your Bank</p>
        {checklist}
      </Card>

      {/* Phone: one line that opens the checklist */}
      <div className="@3xl/main:hidden">
        <button
          onClick={() => setListOpen(!listOpen)}
          className="bg-app text-label text-ink flex w-full items-center justify-between rounded-xl px-3 py-2.5"
        >
          {intake.walk && intake.section
            ? `Section ${pos} of ${SECTIONS.length}: ${intake.section}`
            : `Your Bank: ${intake.entries.length} Entries`}
          <ChevronDown className={cn("size-4 transition-transform", listOpen && "rotate-180")} />
        </button>
        {listOpen && <Card className="mt-2">{checklist}</Card>}
      </div>

      <div className="flex flex-col gap-3">
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
              <EntryCard intake={intake} />
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
    </div>
  );
}
