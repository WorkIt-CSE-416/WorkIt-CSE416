import type { ReactNode } from "react";
import { ArrowRightIcon, CheckIcon, MicrophoneIcon } from "@phosphor-icons/react/ssr";

import { SparkleIcon } from "@/components/sparkle-icon";
import { cn } from "@/lib/cn";

import { candidate } from "../../feature-data";
import { Vignette } from "./parts";

/**
 * The Scout page's pictures: Fill With Scout on the Experience Bank, the
 * one way into Scout today (Ask Scout is greyed out, ASK_SCOUT_LIVE), drawn
 * as its panel draws it (components/scout/: the mark, the bubbles, the
 * lavender stage card, the draft card, the composer with its mic). The
 * parts are shared with the hero's animation (scout-animation.tsx).
 */

/** Scout's mark: the brand gradient with a sparkle (chat.tsx). */
export function ScoutMark() {
  return (
    <span className="from-brand to-brand-pale text-on-brand flex size-7 shrink-0 items-center justify-center rounded-xl bg-linear-to-br shadow-[0_4px_12px_rgb(109_63_216/0.35)]">
      <SparkleIcon className="size-3.5" />
    </span>
  );
}

/** A chat bubble: Scout's on the left in grey, the student's on the right
 *  in violet, the sender's corner squared. */
export function Bubble({ mine = false, children }: { mine?: boolean; children: ReactNode }) {
  return (
    <p
      className={cn(
        "max-w-[85%] rounded-2xl px-3 py-2 text-[11px] leading-snug",
        mine
          ? "bg-brand text-on-brand self-end rounded-br-md"
          : "bg-surface text-ink self-start rounded-bl-md",
      )}
    >
      {children}
    </p>
  );
}

/** The bank's sections as intake walks them, the current one marked. */
const SECTIONS = ["Education", "Experience", "Projects", "Leadership", "Awards"];

/** The stage card above the chat: the section, its place, the step chips. */
export function StageCard() {
  return (
    <div className="bg-stage-card rounded-xl px-3 py-2.5">
      <p className="text-ink text-[12px] font-semibold">Experience</p>
      <p className="text-ink-muted text-[10px]">Section 2 of 6</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {SECTIONS.map((name, i) => (
          <span
            key={name}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
              i === 1 ? "bg-brand text-on-brand" : "text-ink bg-white",
            )}
          >
            {i === 0 && <CheckIcon className="size-2.5" weight="bold" />}
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Scout's question and the student's answer. */
export const QUESTION = "What did you do as an IT Support Intern at the Campus Help Desk?";
export const ANSWER =
  "I ran the help desk for three dorms, about 40 tickets a week, and wrote a guide that cut repeat tickets.";

/** The entry Scout drafts from the answer, line by line. */
export const DRAFT = {
  title: "IT Support Intern",
  org: "Campus Help Desk",
  when: "Jun 2025 – Aug 2025 · Chicago, IL",
  bullets: [
    "Resolved about 40 support tickets a week across three residence halls",
    "Wrote a troubleshooting guide that cut repeat tickets",
  ],
};

/** The draft card in the chat: what Scout wrote, its status, its actions. */
export function DraftCard({ lines = Infinity }: { lines?: number }) {
  const rows = [
    <p key="title" className="text-ink text-[12px] font-semibold">
      {DRAFT.title}
    </p>,
    <p key="org" className="text-ink-muted text-[11px]">
      {DRAFT.org}
    </p>,
    <p key="when" className="text-ink-meta text-[10px]">
      {DRAFT.when}
    </p>,
    ...DRAFT.bullets.map((bullet) => (
      <p key={bullet} className="text-ink flex gap-1.5 text-[10px] leading-snug">
        <span className="text-ink-meta">•</span>
        {bullet}
      </p>
    )),
  ];
  return (
    <div className="rounded-xl bg-white p-3 shadow-[0_10px_24px_-16px_rgb(16_48_94/0.5)] ring-1 ring-slate-900/8">
      <div className="grid gap-0.5">{rows.slice(0, lines)}</div>
      <p className="text-positive-ink mt-2 flex items-center gap-1 text-[10px] font-semibold">
        <CheckIcon className="size-3" weight="bold" />
        Ready to save
      </p>
      <div className="mt-2 flex justify-end gap-1.5">
        {["Skip Section", "Edit"].map((label) => (
          <span
            key={label}
            className="text-ink rounded-lg bg-white px-2.5 py-1 text-[10px] font-semibold ring-1 ring-slate-900/10"
          >
            {label}
          </span>
        ))}
        <span className="bg-brand text-on-brand rounded-lg px-2.5 py-1 text-[10px] font-semibold">
          Save Entry
        </span>
      </div>
    </div>
  );
}

/** The composer: the box to type in, the mic and Send. */
export function Composer() {
  return (
    <div className="bg-well rounded-2xl p-2.5">
      <p className="text-ink-meta text-[11px]">Ask me anything...</p>
      <div className="mt-1.5 flex justify-end gap-1.5">
        <span className="text-ink grid size-6 place-items-center rounded-full bg-white ring-1 ring-slate-900/10">
          <MicrophoneIcon className="size-3.5" />
        </span>
        <span className="bg-brand text-on-brand grid size-6 place-items-center rounded-full opacity-40">
          <ArrowRightIcon className="size-3.5" />
        </span>
      </div>
    </div>
  );
}

/** The walk through the bank: the stage card and Scout's question. */
export function WalkVisual() {
  return (
    <Vignette className="gap-3 px-8">
      <div className="gloss-card flex flex-col gap-3 rounded-2xl p-3">
        <StageCard />
        <div className="flex items-end gap-2">
          <ScoutMark />
          <Bubble>{QUESTION}</Bubble>
        </div>
        <div className="flex gap-1.5 pl-9">
          {["Fill In Myself", "Skip Section"].map((label) => (
            <span
              key={label}
              className="text-ink rounded-full bg-white px-2.5 py-1 text-[10px] font-medium ring-1 ring-slate-900/10"
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </Vignette>
  );
}

/** The student's answer and the entry Scout drafted from it. */
export function DraftVisual() {
  return (
    <Vignette className="gap-2.5 px-8">
      <div className="flex flex-col">
        <Bubble mine>{ANSWER}</Bubble>
      </div>
      <div className="flex items-start gap-2">
        <ScoutMark />
        <div className="min-w-0 flex-1">
          <DraftCard />
        </div>
      </div>
    </Vignette>
  );
}

/** What the student typed, and what the model reads: identity fields
 *  become placeholders before any model call (scout/ identity.py). */
export function PrivacyVisual() {
  const typed = (
    <>
      I&rsquo;m <b>{candidate.name}</b>, reach me at <b>alex@example.com</b> or{" "}
      <b>(555) 014-2290</b>.
    </>
  );
  const sent = (
    <>
      I&rsquo;m <Tag>[name]</Tag>, reach me at <Tag>[email]</Tag> or <Tag>[phone]</Tag>.
    </>
  );
  return (
    <Vignette className="gap-2 px-8">
      <p className="text-ink-muted text-[11px] font-semibold">You type</p>
      <p className="gloss-card text-ink rounded-2xl px-3.5 py-3 text-[12px] leading-relaxed">
        {typed}
      </p>
      <p className="text-ink-muted mt-2 flex items-center gap-1.5 text-[11px] font-semibold">
        <SparkleIcon className="size-3.5" />
        The model reads
      </p>
      <p className="gloss-card text-ink rounded-2xl px-3.5 py-3 text-[12px] leading-relaxed">
        {sent}
      </p>
    </Vignette>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="bg-warning-tint text-warning rounded-md px-1 py-0.5 font-mono text-[11px] font-semibold">
      {children}
    </span>
  );
}
