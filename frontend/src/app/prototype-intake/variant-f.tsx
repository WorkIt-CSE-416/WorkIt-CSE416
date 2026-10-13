"use client";

// PROTOTYPE (KAN-193), throwaway.
// F, "Modern": E restyled after current AI chat apps (ChatGPT, Claude, v0).
// WorkIt's replies are plain text beside a small gradient mark, with no
// bubble; only the student's words sit in a soft pill. The message box
// floats. The draft entry is a side panel like those apps' document canvas,
// with fields that look like text until touched. Progress is a thin bar of
// segments, one per stage. On a phone the draft opens as a bottom sheet.

import { ArrowUp, Check, Mic, Plus, SkipForward, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";

import { DuplicateWarning } from "./entry-card";
import { entryLabel, SECTIONS, type Draft, type Intake, type Message } from "./model";

export const NAME = "Modern";

const HEAD_START = 25;

function Mark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-[#6d3fd8] via-[#8b5cf6] to-[#c084fc] text-white shadow-[0_2px_8px_rgb(109_63_216/0.35)]",
        className,
      )}
    >
      <Sparkles className="size-3.5" />
    </span>
  );
}

export function VariantF({ intake }: { intake: Intake }) {
  const [sheet, setSheet] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <Progress intake={intake} />

      <div className="grid items-start gap-5 @4xl/main:grid-cols-[1fr_22rem]">
        <Conversation intake={intake} onOpenDraft={() => setSheet(true)} />

        <aside className="rounded-shell bg-panel border-border-subtle hidden border shadow-(--shadow-tile) @4xl/main:sticky @4xl/main:top-4 @4xl/main:block">
          <DraftPanel intake={intake} />
        </aside>
      </div>

      {/* Phone: the draft as a bottom sheet. */}
      {sheet && intake.draft && (
        <div className="fixed inset-0 z-40 @4xl/main:hidden">
          <button
            aria-label="Close draft"
            className="animate-fade absolute inset-0 bg-black/30 backdrop-blur-[2px]"
            onClick={() => setSheet(false)}
          />
          <div className="animate-rise bg-panel absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-3xl pb-6 shadow-2xl">
            <div className="bg-border-strong mx-auto mt-2.5 h-1 w-10 rounded-full" />
            <DraftPanel intake={intake} />
          </div>
        </div>
      )}
    </div>
  );
}

function Progress({ intake }: { intake: Intake }) {
  const states = SECTIONS.map((s) => intake.sectionState(s));
  const finished = states.filter((s) => s === "done" || s === "skipped").length;
  const percent = Math.round(HEAD_START + ((100 - HEAD_START) * finished) / SECTIONS.length);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-label text-ink">
          {percent === HEAD_START ? "You've started" : percent === 100 ? "All done" : "Keep going"}
          <span className="text-ink-meta ml-2 font-normal tabular-nums">{percent}%</span>
        </p>
        {intake.walk && intake.section && (
          <button
            onClick={intake.skip}
            className="text-label text-ink-meta hover:text-ink flex items-center gap-1 transition-colors"
          >
            Skip {intake.section} <SkipForward className="size-3.5" />
          </button>
        )}
      </div>

      {/* One segment per stage; the account is already done. */}
      <div className="flex gap-1">
        <span className="h-1.5 flex-1 rounded-full bg-[#6d3fd8]" />
        {states.map((st, i) => (
          <span
            key={i}
            className={cn(
              "relative h-1.5 flex-1 overflow-hidden rounded-full transition-colors duration-500",
              st === "done" && "bg-[#6d3fd8]",
              st === "skipped" && "bg-border-strong",
              st === "todo" && "bg-app",
              st === "current" && "bg-brand-pale",
            )}
          >
            {st === "current" && (
              <span className="absolute inset-0 animate-pulse bg-linear-to-r from-transparent via-white/70 to-transparent" />
            )}
          </span>
        ))}
      </div>

      <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
        <Stage label="Account" state="done" />
        {SECTIONS.map((s, i) => (
          <Stage
            key={s}
            label={s}
            state={states[i]}
            onClick={states[i] === "current" ? undefined : () => intake.start(s)}
          />
        ))}
      </div>
    </div>
  );
}

function Stage({ label, state, onClick }: { label: string; state: string; onClick?: () => void }) {
  return (
    <button
      disabled={!onClick}
      onClick={onClick}
      className={cn(
        "text-note flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 transition-colors",
        state === "current" && "bg-ink text-white",
        state === "done" && "text-ink",
        state !== "current" && onClick && "hover:bg-hover",
        (state === "todo" || state === "skipped") && "text-ink-meta",
      )}
    >
      {state === "done" && <Check className="size-3 text-[#6d3fd8]" />}
      {state === "skipped" && <SkipForward className="size-3" />}
      {label}
    </button>
  );
}

function Conversation({ intake, onOpenDraft }: { intake: Intake; onOpenDraft: () => void }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [intake.messages.length, intake.typing]);

  const last = intake.messages.at(-1);
  const waiting = !intake.typing && intake.draft && last?.kind === "text" && last.from === "workit";

  return (
    <div className="flex h-[min(40rem,calc(100dvh-17rem))] min-h-[26rem] flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_24px)] px-1 pt-2 pb-6">
        {intake.messages.map((m, i) => (
          <Line key={i} m={m} prev={intake.messages[i - 1]} />
        ))}

        {intake.typing && (
          <div className="flex items-center gap-3">
            <Mark />
            <span className="flex gap-1">
              {[0, 1, 2].map((d) => (
                <span
                  key={d}
                  className="bg-ink-subtle animate-typing size-1.5 rounded-full"
                  style={{ animationDelay: `${d * 160}ms` }}
                />
              ))}
            </span>
          </div>
        )}

        {waiting && (
          <div className="animate-fade flex flex-wrap gap-2 pl-10">
            {["I don't know", "Skip this question"].map((q) => (
              <button
                key={q}
                onClick={() => intake.send(q)}
                className="text-label text-ink-muted border-border-subtle hover:border-brand-pale hover:bg-brand-tint hover:text-brand rounded-full border px-3.5 py-1.5 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {!intake.walk && !intake.section && (
          <div className="flex flex-wrap gap-2 pl-10">
            {SECTIONS.map((s) => (
              <button
                key={s}
                onClick={() => intake.start(s)}
                className="text-label text-ink-muted border-border-subtle hover:bg-hover flex items-center gap-1 rounded-full border px-3.5 py-1.5"
              >
                <Plus className="size-3.5" /> {s}
              </button>
            ))}
          </div>
        )}
        <div ref={end} />
      </div>

      {/* Phone: the draft as one line that opens the sheet. */}
      {intake.draft && (
        <button
          onClick={onOpenDraft}
          className="bg-panel border-border-subtle mb-2 flex items-center gap-2.5 rounded-2xl border px-3.5 py-2.5 text-left shadow-(--shadow-panel) @4xl/main:hidden"
        >
          <StatusDot ready={intake.draft.ready} />
          <span className="text-label text-ink min-w-0 flex-1 truncate">
            {intake.draft.title || `New ${intake.draft.section} entry`}
          </span>
          <span className="text-note text-ink-meta">View Draft</span>
        </button>
      )}

      <FloatingComposer intake={intake} />
    </div>
  );
}

function Line({ m, prev }: { m: Message; prev?: Message }) {
  if (m.kind === "saved")
    return (
      <div className="animate-pop text-note text-ink-muted bg-positive-tint mx-auto flex items-center gap-1.5 rounded-full px-3 py-1">
        <Check className="text-positive-ink size-3.5" />
        Saved to {m.entry.section} · {entryLabel(m.entry)}
      </div>
    );
  if (m.kind === "skipped")
    return (
      <div className="text-note text-ink-meta mx-auto flex items-center gap-1.5">
        <SkipForward className="size-3.5" /> Skipped {m.section}
      </div>
    );
  if (m.from === "student")
    return (
      <p className="animate-rise text-body text-ink bg-panel border-border-subtle max-w-[80%] self-end rounded-3xl border px-4 py-2.5 shadow-(--shadow-panel)">
        {m.text}
      </p>
    );
  const follows = prev?.kind === "text" && prev.from === "workit";
  return (
    <div className={cn("animate-rise flex gap-3", follows && "-mt-3")}>
      {follows ? <span className="w-7 shrink-0" /> : <Mark className="mt-0.5" />}
      <p className="text-ink max-w-[85%] text-[0.9375rem] leading-relaxed">{m.text}</p>
    </div>
  );
}

function FloatingComposer({ intake }: { intake: Intake }) {
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
      className="bg-panel border-border-subtle focus-within:border-brand-pale rounded-3xl border p-2 pl-4 shadow-(--shadow-tile) transition-colors"
    >
      <textarea
        rows={2}
        disabled={off}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder={off ? "Pick a section to start" : "Reply to WorkIt…"}
        className="text-body text-ink placeholder:text-ink-meta w-full resize-none bg-transparent pt-2 outline-none"
      />
      <div className="flex items-center gap-2">
        {intake.section && (
          <span className="text-note text-ink-meta bg-app rounded-full px-2.5 py-1">
            {intake.section}
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Speak"
          disabled={off}
          className="text-ink-meta hover:bg-hover hover:text-ink flex size-9 items-center justify-center rounded-full transition-colors"
        >
          <Mic className="size-4" />
        </button>
        <button
          type="submit"
          aria-label="Send"
          disabled={off || !text.trim() || intake.typing}
          className="bg-ink flex size-9 items-center justify-center rounded-full text-white transition-[opacity,transform] active:scale-95 disabled:opacity-30"
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
    </form>
  );
}

function StatusDot({ ready }: { ready: boolean }) {
  return (
    <span className="relative flex size-2.5 shrink-0">
      {!ready && (
        <span className="bg-brand absolute inset-0 animate-ping rounded-full opacity-50" />
      )}
      <span className={cn("relative size-2.5 rounded-full", ready ? "bg-positive" : "bg-brand")} />
    </span>
  );
}

const GHOST =
  "w-full rounded-lg bg-transparent px-2 py-1 -mx-2 outline-none transition-colors hover:bg-app focus:bg-app placeholder:text-ink-subtle";

function DraftPanel({ intake }: { intake: Intake }) {
  const { draft, setDraft } = intake;
  if (!draft)
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <Mark />
        <p className="text-label text-ink">No draft yet</p>
        <p className="text-note text-ink-meta">
          Tell WorkIt about something you did, and the entry builds here.
        </p>
      </div>
    );

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <StatusDot ready={draft.ready} />
        <span className="text-note text-ink-meta">
          {draft.ready ? "Ready to save" : "Drafting"} · {draft.section}
        </span>
      </div>

      <div>
        <input
          value={draft.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="Title"
          className={cn(GHOST, "text-title text-ink")}
        />
        <input
          value={draft.organization}
          onChange={(e) => set({ organization: e.target.value })}
          placeholder="Organization"
          className={cn(GHOST, "text-body text-ink-muted")}
        />
        <div className="text-note text-ink-meta flex items-center">
          <input
            value={draft.start}
            onChange={(e) => set({ start: e.target.value })}
            placeholder="Start"
            className={cn(GHOST, "w-24")}
          />
          <span className="px-1">–</span>
          <input
            value={draft.end}
            onChange={(e) => set({ end: e.target.value })}
            placeholder="End"
            className={cn(GHOST, "mx-0 w-24")}
          />
        </div>
      </div>

      {draft.details.length > 0 && (
        <dl className="text-note grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {draft.details.map((d) => (
            <div key={d.label} className="contents">
              <dt className="text-ink-meta">{d.label}</dt>
              <dd className="text-ink">{d.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {draft.bullets.length > 0 && (
        <ul className="flex flex-col gap-1">
          {draft.bullets.map((b, i) => (
            <li key={i} className="group animate-fade flex items-start gap-2">
              <span className="bg-ink-subtle mt-[0.6rem] size-1 shrink-0 rounded-full" />
              <textarea
                rows={2}
                value={b}
                onChange={(e) =>
                  set({ bullets: draft.bullets.map((x, j) => (j === i ? e.target.value : x)) })
                }
                className={cn(GHOST, "text-body text-ink mx-0 resize-none")}
              />
              <button
                aria-label="Remove bullet"
                onClick={() => set({ bullets: draft.bullets.filter((_, j) => j !== i) })}
                className="text-ink-subtle hover:text-ink mt-1.5 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {draft.skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {draft.skills.map((s) => (
            <span
              key={s}
              className="text-note text-ink border-border-subtle flex items-center gap-1 rounded-full border px-2.5 py-0.5"
            >
              {s}
              <button
                aria-label={`Remove ${s}`}
                onClick={() => set({ skills: draft.skills.filter((x) => x !== s) })}
                className="text-ink-subtle hover:text-ink"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {intake.duplicate ? (
        <DuplicateWarning intake={intake} />
      ) : (
        <button
          onClick={intake.save}
          disabled={!draft.title}
          className={cn(
            "text-label flex h-10 items-center justify-center gap-1.5 rounded-full transition-[background-color,transform] active:scale-[0.98] disabled:opacity-40",
            draft.ready ? "bg-ink text-white hover:bg-black" : "bg-app text-ink hover:bg-hover",
          )}
        >
          <Check className="size-4" /> Save Entry
        </button>
      )}
    </div>
  );
}
