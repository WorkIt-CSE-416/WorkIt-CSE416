"use client";

// PROTOTYPE (KAN-193), throwaway.
// E, "Talk to WorkIt": D's stage bar and head-start progress on top, and under
// it a real conversation, not a questionnaire: WorkIt's avatar on each reply,
// a typing pause, quick replies under its question, and the draft entry card
// building beside the chat. On a phone the card folds into one line above
// the message box that opens on tap.

import { ChevronUp, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

import { Bubble, Composer, SectionPicker } from "./chat";
import { EntryCard } from "./entry-card";
import { type Intake } from "./model";
import { StageBar } from "./variant-d";

export const NAME = "Talk to WorkIt";

function Avatar() {
  return (
    <span className="bg-brand text-on-brand flex size-8 shrink-0 items-center justify-center rounded-full">
      <Sparkles className="size-4" />
    </span>
  );
}

export function VariantE({ intake }: { intake: Intake }) {
  const [cardOpen, setCardOpen] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [intake.messages.length, intake.typing]);

  const last = intake.messages.at(-1);
  const waitingOnStudent =
    !intake.typing && intake.draft && last?.kind === "text" && last.from === "workit";

  return (
    <div className="flex flex-col gap-4">
      <StageBar intake={intake} />

      <div className="grid gap-4 @3xl/main:grid-cols-[1fr_20rem]">
        <Card
          padding="none"
          className="flex h-[min(36rem,calc(100dvh-20rem))] min-h-[24rem] flex-col"
        >
          <header className="border-border-subtle flex items-center gap-3 border-b px-4 py-3">
            <Avatar />
            <div>
              <p className="text-label text-ink">WorkIt</p>
              <p className="text-note text-ink-meta">
                {intake.typing ? "Typing…" : "Building your experience bank with you"}
              </p>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            {intake.messages.map((m, i) =>
              m.kind === "text" && m.from === "workit" ? (
                <div key={i} className="flex items-end gap-2">
                  {/* One avatar per run of replies, on the last one. */}
                  {intake.messages[i + 1]?.kind === "text" &&
                  (intake.messages[i + 1] as { from: string }).from === "workit" ? (
                    <span className="size-8 shrink-0" />
                  ) : (
                    <Avatar />
                  )}
                  <Bubble m={m} />
                </div>
              ) : (
                <Bubble key={i} m={m} />
              ),
            )}

            {intake.typing && (
              <div className="flex items-end gap-2">
                <Avatar />
                <span className="bg-surface flex h-10 items-center gap-1 rounded-2xl rounded-bl-md px-4">
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="bg-ink-subtle size-1.5 animate-bounce rounded-full"
                      style={{ animationDelay: `${d * 150}ms` }}
                    />
                  ))}
                </span>
              </div>
            )}

            {waitingOnStudent && (
              <div className="flex flex-wrap gap-1.5 pl-10">
                {["I don't know", "Skip this question"].map((q) => (
                  <button
                    key={q}
                    onClick={() => intake.send(q)}
                    className="text-label border-brand-pale text-brand hover:bg-brand-tint rounded-full border px-3 py-1"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            <div ref={end} />
          </div>

          <div className="flex flex-col gap-2 p-3">
            <SectionPicker intake={intake} />

            {/* Phone: the card as one line that opens over the chat. */}
            {intake.draft && (
              <div className="@3xl/main:hidden">
                <button
                  onClick={() => setCardOpen(!cardOpen)}
                  className="bg-brand-tint text-label text-ink flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2"
                >
                  <span className="truncate">
                    {intake.draft.title || `New ${intake.draft.section} entry`}
                  </span>
                  <span
                    className={cn(
                      "text-note shrink-0",
                      intake.draft.ready ? "text-positive-ink" : "text-ink-meta",
                    )}
                  >
                    {intake.draft.ready ? "Ready to Save" : "Drafting"}
                  </span>
                  <ChevronUp
                    className={cn(
                      "size-4 shrink-0 transition-transform",
                      !cardOpen && "rotate-180",
                    )}
                  />
                </button>
                {cardOpen && (
                  <div className="border-border-subtle mt-2 max-h-[50dvh] overflow-y-auto rounded-xl border p-3">
                    <EntryCard intake={{ ...intake, walk: false }} dense />
                  </div>
                )}
              </div>
            )}

            <Composer intake={intake} />
          </div>
        </Card>

        <Card className="hidden self-start @3xl/main:sticky @3xl/main:top-4 @3xl/main:block">
          <h2 className="text-subtitle text-ink mb-1">Draft Entry</h2>
          <p className="text-note text-ink-meta mb-3">
            Builds as you talk. Nothing is saved until you save it.
          </p>
          {intake.draft ? (
            <EntryCard intake={{ ...intake, walk: false }} dense />
          ) : (
            <p className="text-body text-ink-meta">Nothing in progress.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
