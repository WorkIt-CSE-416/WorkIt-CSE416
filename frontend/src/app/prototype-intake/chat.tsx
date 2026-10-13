"use client";

// PROTOTYPE (KAN-193), throwaway. Chat pieces in Scout's panel style.

import { ArrowUp, Check, Mic, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import { entryDates, entryLabel, SECTIONS, type Intake, type Message } from "./model";

export function Bubble({ m }: { m: Message }) {
  if (m.kind === "saved")
    return (
      <p className="text-note text-positive-ink flex items-center gap-1.5 self-center">
        <Check className="size-3.5" /> Saved to {m.entry.section}: {entryLabel(m.entry)}
        {entryDates(m.entry) && ` (${entryDates(m.entry)})`}
      </p>
    );
  if (m.kind === "skipped")
    return (
      <p className="text-note text-ink-meta flex items-center gap-1.5 self-center">
        <SkipForward className="size-3.5" /> Skipped {m.section}
      </p>
    );
  return (
    <div
      className={cn(
        "text-body max-w-[85%] rounded-2xl px-4 py-2.5",
        m.from === "workit"
          ? "bg-surface text-ink self-start rounded-bl-md"
          : "bg-brand text-on-brand self-end rounded-br-md",
      )}
    >
      {m.text}
    </div>
  );
}

export function Messages({ intake, className }: { intake: Intake; className?: string }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [intake.messages.length]);
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {intake.messages.map((m, i) => (
        <Bubble key={i} m={m} />
      ))}
      <div ref={end} />
    </div>
  );
}

/** The input comes prefilled with the scripted answer; Send uses whatever is typed. */
export function Composer({ intake, className }: { intake: Intake; className?: string }) {
  const [text, setText] = useState("");
  const [seen, setSeen] = useState("");
  if (seen !== intake.nextAnswer) {
    setSeen(intake.nextAnswer);
    setText(intake.nextAnswer);
  }
  const off = !intake.draft;
  return (
    <form
      className={cn(
        "bg-app focus-within:bg-panel focus-within:ring-brand-ring flex items-end gap-2 rounded-2xl p-2.5 focus-within:ring-2",
        className,
      )}
      onSubmit={(e) => {
        e.preventDefault();
        intake.send(text);
        setText("");
      }}
    >
      <textarea
        rows={2}
        disabled={off}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={off ? "Pick a section to start" : "Tell me in your own words"}
        className="text-body text-ink placeholder:text-ink-meta w-full resize-none bg-transparent outline-none"
      />
      <Button variant="ghost" size="icon" aria-label="Speak" type="button" disabled={off}>
        <Mic className="size-4" />
      </Button>
      <Button size="icon" aria-label="Send" type="submit" disabled={off}>
        <ArrowUp className="size-4" />
      </Button>
    </form>
  );
}

/** For a filled bank: the student picks a section to add to. */
export function SectionPicker({ intake }: { intake: Intake }) {
  if (intake.walk || intake.section) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {SECTIONS.map((s) => (
        <Button key={s} variant="secondary" size="sm" onClick={() => intake.start(s)}>
          {s}
        </Button>
      ))}
    </div>
  );
}
