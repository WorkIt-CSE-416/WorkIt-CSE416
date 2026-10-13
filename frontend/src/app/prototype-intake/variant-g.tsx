"use client";

// PROTOTYPE (KAN-193), throwaway.
// G, "Friendly": F's layout made warmer, with a sign-up style step bar: one
// segment per stage, the current one filling as the
// draft takes shape. Brand purple and soft lavender replace F's black, the
// chat has bubbles again, each section opens with a small chapter divider,
// and a save gets a little celebration.

import {
  ArrowUp,
  BadgeCheck,
  Briefcase,
  Check,
  ChevronLeft,
  GraduationCap,
  Lightbulb,
  Mic,
  PartyPopper,
  SkipForward,
  Sparkles,
  Trophy,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";

import { DuplicateWarning } from "./entry-card";
import { SECTIONS, entryLabel, type Draft, type Intake, type Message, type Section } from "./model";

export const NAME = "Friendly";

const HEAD_START = 25;

const ICONS: Record<Section, LucideIcon> = {
  Education: GraduationCap,
  Projects: Lightbulb,
  "Leadership & Activities": Users,
  Experience: Briefcase,
  Awards: Trophy,
  Certifications: BadgeCheck,
};

const SHORT: Record<Section, string> = {
  Education: "Education",
  Projects: "Projects",
  "Leadership & Activities": "Leadership",
  Experience: "Experience",
  Awards: "Awards",
  Certifications: "Certifications",
};

function Mark({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-[#7c4dff] to-[#b388ff] text-white shadow-[0_4px_12px_rgb(124_77_255/0.35)]",
        size === "md" ? "size-8" : "size-11",
      )}
    >
      <Sparkles className={size === "md" ? "size-4" : "size-5"} />
    </span>
  );
}

export function VariantG({ intake }: { intake: Intake }) {
  const [sheet, setSheet] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <ProgressSteps intake={intake} />

      <div className="grid items-start gap-5 @4xl/main:grid-cols-[1fr_21rem]">
        <Chat intake={intake} onOpenDraft={() => setSheet(true)} />

        <aside className="hidden rounded-3xl bg-white shadow-[0_8px_30px_-8px_rgb(80_50_160/0.18)] ring-1 ring-[#ece6ff] @4xl/main:sticky @4xl/main:top-4 @4xl/main:block">
          <DraftPanel intake={intake} />
        </aside>
      </div>

      {sheet && intake.draft && (
        <div className="fixed inset-0 z-40 @4xl/main:hidden">
          <button
            aria-label="Close draft"
            className="animate-fade absolute inset-0 bg-[#1e1446]/30 backdrop-blur-[2px]"
            onClick={() => setSheet(false)}
          />
          <div className="animate-rise absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-[2rem] bg-white pb-6 shadow-2xl">
            <div className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-[#e4dcff]" />
            <DraftPanel intake={intake} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- progress */

/**
 * Styled after the step bars of sign-up flows (Duolingo, Headspace, Noom,
 * LinkedIn onboarding): a thick rounded bar of segments across the top, back
 * on the left, Skip on the right, and "Step 3 of 7" under it. Each segment is
 * one section: it names itself on hover and a click jumps there.
 */
function ProgressSteps({ intake }: { intake: Intake }) {
  const states = SECTIONS.map((s) => intake.sectionState(s));
  const finished = states.filter((s) => s === "done" || s === "skipped").length;
  const percent = Math.round(HEAD_START + ((100 - HEAD_START) * finished) / SECTIONS.length);

  // The current segment grows as the draft does.
  const d = intake.draft;
  const currentFill = !d
    ? 0
    : d.ready
      ? 100
      : Math.min(85, (d.title ? 35 : 12) + intake.followUps * 20);

  const index = intake.section ? SECTIONS.indexOf(intake.section) : -1;
  const previous = index > 0 ? SECTIONS[index - 1] : null;

  const message =
    percent === HEAD_START
      ? "You're off to a great start!"
      : percent === 100
        ? "Your experience bank is complete 🎉"
        : finished >= SECTIONS.length / 2
          ? "Over halfway there. Keep it up!"
          : "Nice work. Keep going!";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <button
          aria-label={previous ? `Back to ${previous}` : "Back"}
          disabled={!previous}
          onClick={() => previous && intake.start(previous)}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-[#6d3fd8] transition-colors hover:bg-[#f3efff] disabled:text-[#d4cdea] disabled:hover:bg-transparent"
        >
          <ChevronLeft className="size-5" strokeWidth={2.5} />
        </button>

        <ol className="flex flex-1 items-start gap-1.5">
          <Segment label="Account" state="done" fill={100} />
          {SECTIONS.map((s, i) => (
            <Segment
              key={s}
              label={s}
              state={states[i]}
              fill={states[i] === "done" ? 100 : states[i] === "current" ? currentFill : 0}
              onClick={states[i] === "current" ? undefined : () => intake.start(s)}
            />
          ))}
        </ol>

        {intake.walk && intake.section ? (
          <button
            onClick={intake.skip}
            className="text-label shrink-0 rounded-full px-3 py-1.5 font-semibold text-[#8a80a8] transition-colors hover:bg-[#f3efff] hover:text-[#6d3fd8]"
          >
            Skip
          </button>
        ) : (
          <span className="w-9 shrink-0" />
        )}
      </div>

      <div className="flex items-center justify-between gap-3 px-12">
        <p className="text-note text-ink-meta @3xl/main:hidden">
          {intake.section ? (
            <>
              Step {index + 2} of {SECTIONS.length + 1} ·{" "}
              <span className="font-semibold text-[#6d3fd8]">{intake.section}</span>
            </>
          ) : (
            `${finished + 1} of ${SECTIONS.length + 1} steps done`
          )}
        </p>
        <p className="text-note text-ink-meta ml-auto hidden @xl/main:block">
          {message} <span className="font-semibold text-[#6d3fd8] tabular-nums">{percent}%</span>
        </p>
      </div>
    </div>
  );
}

function Segment({
  label,
  state,
  fill,
  onClick,
}: {
  label: string;
  state: string;
  fill: number;
  onClick?: () => void;
}) {
  return (
    <li className="group relative flex-1">
      <button
        onClick={onClick}
        disabled={!onClick}
        aria-label={`${label}: ${state}`}
        className="block w-full py-2 disabled:cursor-default"
      >
        <span
          className={cn(
            "block h-3 overflow-hidden rounded-full transition-transform duration-200",
            onClick && "group-hover:scale-y-125",
            state === "skipped"
              ? "bg-[repeating-linear-gradient(135deg,#ebe7f5_0_5px,#f7f5fc_5px_10px)]"
              : "bg-[#ece6ff]",
          )}
        >
          <span
            className="relative block h-full rounded-full bg-linear-to-r from-[#7c4dff] to-[#9f6bff] transition-[width] duration-700 ease-out"
            style={{ width: `${fill}%` }}
          >
            {/* The glossy highlight sign-up bars use. */}
            {fill > 0 && (
              <span className="absolute inset-x-1.5 top-[3px] h-[3px] rounded-full bg-white/35" />
            )}
          </span>
        </span>
      </button>
      <span
        className={cn(
          "text-meta hidden truncate text-center @3xl/main:block",
          state === "current" ? "font-semibold text-[#6d3fd8]" : "text-[#8a80a8]",
        )}
      >
        {state === "done" && "✓ "}
        {label === "Leadership & Activities" ? "Leadership" : label}
      </span>
      <span className="text-meta pointer-events-none absolute top-full left-1/2 z-10 mt-1 -translate-x-1/2 rounded-md bg-[#1e1446] px-2 py-1 whitespace-nowrap text-white opacity-0 transition-opacity group-hover:opacity-100 @3xl/main:hidden">
        {label}
        {state === "skipped" ? " (skipped)" : state === "done" ? " ✓" : ""}
      </span>
    </li>
  );
}

/* -------------------------------------------------------------------- chat */

function Chat({ intake, onOpenDraft }: { intake: Intake; onOpenDraft: () => void }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [intake.messages.length, intake.typing]);

  const last = intake.messages.at(-1);
  const waiting =
    !intake.typing &&
    intake.draft &&
    !intake.draft.ready &&
    last?.kind === "text" &&
    last.from === "workit";

  return (
    <div className="flex h-[min(38rem,calc(100dvh-20rem))] min-h-[26rem] flex-col overflow-hidden rounded-3xl bg-linear-to-b from-[#f7f4ff] to-[#fbfaff] ring-1 ring-[#ece6ff]">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-5 pb-4">
        {intake.messages.map((m, i) => (
          <Line key={i} m={m} prev={intake.messages[i - 1]} />
        ))}

        {intake.typing && (
          <div className="flex items-end gap-2.5">
            <Mark />
            <span className="flex h-10 items-center gap-1 rounded-2xl rounded-bl-md bg-white px-4 shadow-[0_1px_3px_rgb(80_50_160/0.08)]">
              {[0, 1, 2].map((d) => (
                <span
                  key={d}
                  className="animate-typing size-1.5 rounded-full bg-[#b9a6f0]"
                  style={{ animationDelay: `${d * 160}ms` }}
                />
              ))}
            </span>
          </div>
        )}

        {waiting && (
          <div className="animate-fade flex flex-wrap gap-2 pl-[2.625rem]">
            {["I don't know", "Skip this question"].map((q) => (
              <button
                key={q}
                onClick={() => intake.send(q)}
                className="text-label rounded-full bg-white px-3.5 py-1.5 text-[#6d3fd8] ring-1 ring-[#e4dcff] transition-colors hover:bg-[#f3efff]"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {!intake.walk && !intake.section && (
          <div className="flex flex-wrap gap-2 pl-[2.625rem]">
            {SECTIONS.map((s) => {
              const Icon = ICONS[s];
              return (
                <button
                  key={s}
                  onClick={() => intake.start(s)}
                  className="text-label flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[#6d3fd8] ring-1 ring-[#e4dcff] hover:bg-[#f3efff]"
                >
                  <Icon className="size-3.5" /> {s}
                </button>
              );
            })}
          </div>
        )}
        <div ref={end} />
      </div>

      <div className="flex flex-col gap-2 p-3 pt-0">
        {intake.draft && (
          <button
            onClick={onOpenDraft}
            className="flex items-center gap-2.5 rounded-2xl bg-white px-3.5 py-2.5 text-left ring-1 ring-[#ece6ff] @4xl/main:hidden"
          >
            <Dot ready={intake.draft.ready} />
            <span className="text-label text-ink min-w-0 flex-1 truncate">
              {intake.draft.title || `Your new ${SHORT[intake.draft.section]} entry`}
            </span>
            <span className="text-note font-semibold text-[#6d3fd8]">View</span>
          </button>
        )}
        <Composer intake={intake} />
      </div>
    </div>
  );
}

function Line({ m, prev }: { m: Message; prev?: Message }) {
  if (m.kind === "saved")
    return (
      <div className="animate-pop text-label mx-auto my-1 flex items-center gap-2 rounded-full bg-[#e3f7f0] px-4 py-1.5 text-[#107a52]">
        <PartyPopper className="size-4" />
        Saved! {entryLabel(m.entry)}
      </div>
    );
  if (m.kind === "skipped")
    return (
      <div className="text-note text-ink-meta mx-auto flex items-center gap-1.5">
        <SkipForward className="size-3.5" /> Skipped {m.section}. You can come back to it anytime.
      </div>
    );
  if (m.from === "student")
    return (
      <p className="animate-rise text-body max-w-[80%] self-end rounded-2xl rounded-br-md bg-linear-to-br from-[#7c4dff] to-[#6d3fd8] px-4 py-2.5 text-white shadow-[0_4px_12px_-4px_rgb(109_63_216/0.5)]">
        {m.text}
      </p>
    );

  const follows = prev?.kind === "text" && prev.from === "workit";
  return (
    <>
      {m.opensDraft && <Chapter section={m.opensDraft} />}
      <div className={cn("animate-rise flex items-end gap-2.5", follows && "-mt-1.5")}>
        {follows ? <span className="w-8 shrink-0" /> : <Mark />}
        <p className="text-body text-ink max-w-[85%] rounded-2xl rounded-bl-md bg-white px-4 py-2.5 leading-relaxed shadow-[0_1px_3px_rgb(80_50_160/0.08)]">
          {m.text}
        </p>
      </div>
    </>
  );
}

/** A divider that opens each section, so the chat reads in chapters. */
function Chapter({ section }: { section: Section }) {
  const Icon = ICONS[section];
  return (
    <div className="my-2 flex items-center gap-3">
      <span className="h-px flex-1 bg-[#e4dcff]" />
      <span className="text-note flex items-center gap-1.5 font-semibold text-[#6d3fd8]">
        <Icon className="size-3.5" /> {section}
      </span>
      <span className="h-px flex-1 bg-[#e4dcff]" />
    </div>
  );
}

function Composer({ intake }: { intake: Intake }) {
  const [text, setText] = useState("");
  const [seen, setSeen] = useState("");
  if (seen !== intake.nextAnswer) {
    setSeen(intake.nextAnswer);
    setText(intake.nextAnswer);
  }
  const off = !intake.draft;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        intake.send(text);
        setText("");
      }}
      className="flex items-end gap-2 rounded-2xl bg-white p-2 pl-4 shadow-[0_4px_20px_-6px_rgb(80_50_160/0.2)] ring-1 ring-[#ece6ff] transition-shadow focus-within:ring-2 focus-within:ring-[#b9a6f0]"
    >
      <textarea
        rows={1}
        disabled={off}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder={off ? "Pick a section to start" : "Type your answer…"}
        className="text-body text-ink placeholder:text-ink-meta field-sizing-content max-h-32 min-h-9 w-full resize-none bg-transparent py-2 outline-none"
      />
      <button
        type="button"
        aria-label="Speak"
        disabled={off}
        className="flex size-9 shrink-0 items-center justify-center rounded-xl text-[#9b86d9] transition-colors hover:bg-[#f3efff] hover:text-[#6d3fd8]"
      >
        <Mic className="size-[1.125rem]" />
      </button>
      <button
        type="submit"
        aria-label="Send"
        disabled={off || !text.trim() || intake.typing}
        className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-[#7c4dff] to-[#6d3fd8] text-white shadow-[0_4px_12px_-4px_rgb(109_63_216/0.6)] transition-[opacity,transform] active:scale-95 disabled:opacity-35 disabled:shadow-none"
      >
        <ArrowUp className="size-[1.125rem]" />
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------- draft */

function Dot({ ready }: { ready: boolean }) {
  return (
    <span className="relative flex size-2.5 shrink-0">
      {!ready && (
        <span className="absolute inset-0 animate-ping rounded-full bg-[#7c4dff] opacity-40" />
      )}
      <span
        className={cn("relative size-2.5 rounded-full", ready ? "bg-[#17b076]" : "bg-[#7c4dff]")}
      />
    </span>
  );
}

const FIELD =
  "text-body text-ink placeholder:text-[#b4b0c4] w-full rounded-xl bg-[#f8f6ff] px-3 py-2 outline-none ring-1 ring-transparent transition focus:bg-white focus:ring-[#b9a6f0]";

function Label({ children }: { children: string }) {
  return <span className="text-meta mb-1 block font-semibold text-[#8a80a8]">{children}</span>;
}

function DraftPanel({ intake }: { intake: Intake }) {
  const { draft, setDraft } = intake;
  if (!draft)
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <Mark size="lg" />
        <p className="text-subtitle text-ink">Your entry builds here</p>
        <p className="text-note text-ink-meta">
          Tell WorkIt about something you did. I&apos;ll turn it into a resume entry as we talk.
        </p>
      </div>
    );

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const Icon = ICONS[draft.section];

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-[#f3efff] text-[#6d3fd8]">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-label text-ink">{draft.section}</p>
          <p className="text-note text-ink-meta flex items-center gap-1.5">
            <Dot ready={draft.ready} />
            {draft.ready ? "Looks good! Ready to save" : "Filling in as we talk…"}
          </p>
        </div>
      </div>

      <label>
        <Label>What</Label>
        <input
          value={draft.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="e.g. B.S. Computer Science"
          className={cn(FIELD, "font-semibold")}
        />
      </label>
      <label>
        <Label>Where</Label>
        <input
          value={draft.organization}
          onChange={(e) => set({ organization: e.target.value })}
          placeholder="e.g. Stony Brook University"
          className={FIELD}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label>
          <Label>From</Label>
          <input
            value={draft.start}
            onChange={(e) => set({ start: e.target.value })}
            placeholder="Month Year"
            className={FIELD}
          />
        </label>
        <label>
          <Label>To</Label>
          <input
            value={draft.end}
            onChange={(e) => set({ end: e.target.value })}
            placeholder="Month Year"
            className={FIELD}
          />
        </label>
      </div>

      {draft.details.map((d) => (
        <div key={d.label}>
          <Label>{d.label}</Label>
          <p className="text-body text-ink px-1">{d.value}</p>
        </div>
      ))}

      {draft.bullets.length > 0 && (
        <div>
          <Label>What you did</Label>
          <ul className="flex flex-col gap-1.5">
            {draft.bullets.map((b, i) => (
              <li key={i} className="group animate-fade relative">
                <textarea
                  value={b}
                  onChange={(e) =>
                    set({ bullets: draft.bullets.map((x, j) => (j === i ? e.target.value : x)) })
                  }
                  className={cn(FIELD, "field-sizing-content resize-none pr-8")}
                />
                <button
                  aria-label="Remove bullet"
                  onClick={() => set({ bullets: draft.bullets.filter((_, j) => j !== i) })}
                  className="absolute top-2 right-2 rounded-md p-0.5 text-[#b4b0c4] opacity-0 transition group-hover:opacity-100 hover:text-[#6d3fd8]"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {draft.skills.length > 0 && (
        <div>
          <Label>Skills</Label>
          <div className="flex flex-wrap gap-1.5">
            {draft.skills.map((s) => (
              <span
                key={s}
                className="text-note flex items-center gap-1 rounded-full bg-[#f3efff] px-2.5 py-1 font-medium text-[#6d3fd8]"
              >
                {s}
                <button
                  aria-label={`Remove ${s}`}
                  onClick={() => set({ skills: draft.skills.filter((x) => x !== s) })}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {intake.duplicate ? (
        <DuplicateWarning intake={intake} />
      ) : (
        <button
          onClick={intake.save}
          disabled={!draft.title}
          className={cn(
            "text-label flex h-11 items-center justify-center gap-1.5 rounded-2xl font-semibold transition-[background-color,transform,box-shadow] active:scale-[0.98] disabled:opacity-40",
            draft.ready
              ? "bg-linear-to-br from-[#7c4dff] to-[#6d3fd8] text-white shadow-[0_6px_16px_-6px_rgb(109_63_216/0.6)]"
              : "bg-[#f3efff] text-[#6d3fd8] hover:bg-[#e9e2ff]",
          )}
        >
          <Check className="size-4" strokeWidth={3} /> Save Entry
        </button>
      )}
    </div>
  );
}
