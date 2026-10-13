"use client";

// PROTOTYPE (KAN-193), throwaway.
// A, "Side by Side": a section stepper across the top; chat on the left, the
// draft entry card on the right. On a phone the two panes become tabs.

import { Check, SkipForward } from "lucide-react";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

import { Composer, Messages, SectionPicker } from "./chat";
import { EntryCard } from "./entry-card";
import { SECTIONS, type Intake } from "./model";

export const NAME = "Side by Side";

export function VariantA({ intake }: { intake: Intake }) {
  const [tab, setTab] = useState<"chat" | "draft">("chat");

  return (
    <div className="flex flex-col gap-4">
      {intake.walk && (
        <ol className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {SECTIONS.map((s, i) => {
            const st = intake.sectionState(s);
            return (
              <li
                key={s}
                className={cn(
                  "text-label flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5",
                  st === "current" && "bg-brand text-on-brand",
                  st === "done" && "bg-positive-tint text-positive-ink",
                  st === "skipped" && "bg-inert-tint text-ink-meta line-through",
                  st === "todo" && "bg-app text-ink-meta",
                )}
              >
                {st === "done" ? (
                  <Check className="size-3.5" />
                ) : st === "skipped" ? (
                  <SkipForward className="size-3.5" />
                ) : (
                  <span>{i + 1}</span>
                )}
                {s}
              </li>
            );
          })}
        </ol>
      )}

      {/* Phone: one pane at a time. */}
      <div className="bg-app flex rounded-full p-1 @3xl/main:hidden">
        {(["chat", "draft"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "text-label flex-1 rounded-full py-1.5",
              tab === t ? "bg-panel text-ink shadow-sm" : "text-ink-meta",
            )}
          >
            {t === "chat" ? "Chat" : "Draft Entry"}
            {t === "draft" && intake.draft?.ready && (
              <span className="bg-positive ml-1.5 inline-block size-2 rounded-full" />
            )}
          </button>
        ))}
      </div>

      <div className="grid gap-4 @3xl/main:grid-cols-[1fr_22rem]">
        <Card
          padding="none"
          className={cn(
            "flex h-[min(34rem,calc(100dvh-18rem))] flex-col",
            tab !== "chat" && "@max-3xl/main:hidden",
          )}
        >
          <Messages intake={intake} className="min-h-0 flex-1 overflow-y-auto p-4" />
          <div className="flex flex-col gap-2 p-3">
            <SectionPicker intake={intake} />
            <Composer intake={intake} />
          </div>
        </Card>

        <Card
          className={cn(
            "self-start @3xl/main:sticky @3xl/main:top-4",
            tab !== "draft" && "@max-3xl/main:hidden",
          )}
        >
          <h2 className="text-subtitle text-ink mb-3">Draft Entry</h2>
          {intake.draft ? (
            <EntryCard intake={intake} dense />
          ) : (
            <p className="text-body text-ink-meta">
              Nothing in progress. Pick a section, or tell WorkIt about something you did.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
