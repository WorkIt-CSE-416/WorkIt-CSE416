"use client";

import {
  BadgeCheck,
  Briefcase,
  GraduationCap,
  Lightbulb,
  PartyPopper,
  SkipForward,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Composer, Message, Typing, WorkItMark as Mark } from "@/components/scout/chat";
import { readEvents, type ScoutMessage } from "@/components/scout/stream";
import { createEntry, type BankEntry, type EntryFields, type Section } from "@/lib/bank-actions";
import { cn } from "@/lib/cn";
import {
  INTAKE_DRAFT_KEY,
  INTAKE_SKIPPED_KEY,
  readLocalDraft,
  writeLocalDraft,
} from "@/lib/local-drafts";

import { EntryEditor } from "./entry-editor";
import { StepBar, WALK } from "./intake-steps";
import { emptyDraft, sectionOf, SECTIONS, type EntryDraft } from "./sections";

/**
 * Intake on the bank page (KAN-213): the student tells WorkIt about one thing
 * they did, and a draft entry card fills in as they talk. The look is the
 * intake prototype's variant G (prototype/KAN-193-intake-screen): a lavender
 * chat with WorkIt's mark beside its lines, a chapter line for each section,
 * the card in a sticky column beside the chat from @4xl/main, and below that
 * a one-line draft that opens as a bottom sheet. The bubbles, typing dots and
 * composer (with its mic) are Scout's own (`components/scout/chat.tsx`).
 *
 * Each turn POSTs the section, this entry's chat and the card (with the
 * student's own edits) to /api/intake; the reply streams back as NDJSON: the
 * line, the whole draft, the uses left. The card is the shared entry editor,
 * remounted on each new draft. Saving is the bank's own create, one entry at
 * a time, with its duplicate warning.
 *
 * What persists: the unsaved draft and its section, in localStorage, so a
 * reload keeps it; Sign Out clears it (lib/local-drafts.ts). The chat itself
 * is never stored, here or in the API, so a reload starts the talk afresh
 * beside the kept card.
 *
 * The step bar, Skip and jump (KAN-214, `intake-steps.tsx`): with `walk`,
 * intake opens on the first section that is neither filled nor skipped and
 * moves to the next one after each save or Skip, in the order WALK gives.
 * The bank page walks when the bank is empty; onboarding always does.
 * Without it, the student picks a section from the chips and comes back to
 * them after each save. Skip and a jump drop the unsaved draft, as in the
 * prototype. Skipped sections are kept beside the draft, so a reload does
 * not walk back into them.
 */

type DraftWire = EntryFields & { bullets: string[] };

type IntakeEvent =
  | { type: "text"; delta: string }
  | { type: "draft"; draft: DraftWire; done: boolean }
  | { type: "error"; message: string }
  | { type: "usage"; uses_left: number };

type Line =
  | { kind: "chapter"; section: Section }
  | { kind: "text"; role: ScoutMessage["role"]; content: string }
  | { kind: "saved"; title: string }
  | { kind: "skipped"; section: Section };

type Kept = { draft: EntryDraft; done: boolean };

const ICONS: Record<Section, LucideIcon> = {
  education: GraduationCap,
  experience: Briefcase,
  projects: Lightbulb,
  leadership: Users,
  awards: Trophy,
  certifications: BadgeCheck,
};

/** WorkIt's first line for each section. Fixed text, not a model turn, so it
 *  costs nothing and is not sent: the API counts follow-ups from its own. */
const OPENERS: Record<Section, string> = {
  education: "Tell me about your school. Where do you study, and what are you studying?",
  experience: "Tell me about a job or internship. Where was it, and what did you do there?",
  projects: "Tell me about something you built. What was it, and what did it do?",
  leadership: "Tell me about a club, team or activity. What was your role?",
  awards: "Tell me about an award you won. What was it, and what was it for?",
  certifications: "Tell me about a certification. What is it called, and who gave it?",
};

const toWire = ({ bullets, ...fields }: EntryDraft): DraftWire => ({
  ...fields,
  bullets: bullets.map((b) => b.text.trim()).filter(Boolean),
});

const fromWire = ({ bullets, ...fields }: DraftWire): EntryDraft => ({
  ...fields,
  bullets: bullets.map((text) => ({ text })),
});

/**
 * The model's draft laid over the card. A field the student changed while
 * the reply was on its way (it differs from what was sent) keeps the
 * student's value; every other field takes the model's. So a reply never
 * overwrites what the student is typing into the card.
 */
function mergeReply(current: EntryDraft, sent: EntryDraft, reply: EntryDraft): EntryDraft {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const merged = { ...reply } as Record<string, unknown>;
  const now = current as Record<string, unknown>;
  const then = sent as Record<string, unknown>;
  for (const key of Object.keys(now)) {
    if (!same(now[key], then[key])) merged[key] = now[key];
  }
  return merged as EntryDraft;
}

export function Intake({
  filled,
  onSaved,
  walk = false,
  lead,
}: {
  /** Sections with at least one entry in the bank. */
  filled: readonly Section[];
  onSaved: () => Promise<string | null>;
  /** Lead the student through the sections, one after another. */
  walk?: boolean;
  /** A step shown done before the sections, in the step bar. */
  lead?: string;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [messages, setMessages] = useState<ScoutMessage[]>([]);
  const [kept, setKept] = useState<Kept | null>(null);
  // Bumped whenever the model sends a new draft, to remount the card on it.
  const [version, setVersion] = useState(0);
  const [answering, setAnswering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usesLeft, setUsesLeft] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<BankEntry | null>(null);
  const [sheet, setSheet] = useState(false);
  const [skipped, setSkipped] = useState<Section[]>([]);
  const restored = useRef(false);
  const log = useRef<HTMLDivElement>(null);

  // The kept draft comes back after mount, never in the first render, which
  // must match the server's (it has no localStorage).
  useEffect(() => {
    // Strict Mode runs this twice; a second run would add the chapter again.
    if (restored.current) return;
    const saved = readLocalDraft<Kept>(INTAKE_DRAFT_KEY);
    const wasSkipped = readLocalDraft<Section[]>(INTAKE_SKIPPED_KEY) ?? [];
    restored.current = true;
    /* eslint-disable react-hooks/set-state-in-effect -- a one-time restore from storage */
    setSkipped(wasSkipped);
    if (saved?.draft?.section) {
      setKept(saved);
      setLines([
        { kind: "chapter", section: saved.draft.section },
        { kind: "text", role: "assistant", content: "Here's the draft you were working on." },
      ]);
    } else if (walk) {
      const first = WALK.find((s) => !filled.includes(s) && !wasSkipped.includes(s));
      if (first) start(first);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // Mount only: `filled` and `walk` as they were when the page opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (restored.current) writeLocalDraft(INTAKE_DRAFT_KEY, kept);
  }, [kept]);

  useEffect(() => {
    if (restored.current) writeLocalDraft(INTAKE_SKIPPED_KEY, skipped.length ? skipped : null);
  }, [skipped]);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [lines, answering, error]);

  const draft = kept?.draft ?? null;

  function start(section: Section) {
    setKept({ draft: emptyDraft(section), done: false });
    setVersion((v) => v + 1);
    setMessages([]);
    setError(null);
    setLines((l) => [
      ...l,
      { kind: "chapter", section },
      { kind: "text", role: "assistant", content: OPENERS[section] },
    ]);
  }

  function finish() {
    setKept(null);
    setMessages([]);
    setDuplicate(null);
    setSaveError(null);
    setSheet(false);
  }

  /** A jump from the step bar: this section, with the draft dropped. */
  function jump(section: Section) {
    finish();
    start(section);
  }

  /** After a save or Skip: the next section when walking, else the chips. */
  function advance(from: Section) {
    finish();
    const next = walk ? WALK[WALK.indexOf(from) + 1] : undefined;
    if (next) return start(next);
    setLines((l) => [
      ...l,
      {
        kind: "text",
        role: "assistant",
        content: walk
          ? "That's every section. Pick one to add more, or build a resume from your bank."
          : "Anything else? Pick a section.",
      },
    ]);
  }

  function skip() {
    if (!draft) return;
    const { section } = draft;
    setSkipped((s) => (s.includes(section) ? s : [...s, section]));
    setLines((l) => [...l, { kind: "skipped", section }]);
    advance(section);
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || !draft || answering) return;
    const sent: ScoutMessage[] = [...messages, { role: "user", content }];
    const sentDraft = draft;
    setMessages(sent);
    setLines((l) => [...l, { kind: "text", role: "user", content }]);
    setAnswering(true);
    setError(null);

    let failure: string | null = null;
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: draft.section, messages: sent, draft: toWire(draft) }),
      });
      if (!res.ok || !res.body) {
        const body: unknown = await res.json().catch(() => null);
        const detail = (body as { detail?: unknown } | null)?.detail;
        failure = typeof detail === "string" ? detail : "WorkIt couldn't answer. Try again.";
      } else {
        for await (const event of readEvents<IntakeEvent>(res.body)) {
          if (event.type === "text") {
            setMessages((m) => [...m, { role: "assistant", content: event.delta }]);
            setLines((l) => [...l, { kind: "text", role: "assistant", content: event.delta }]);
          } else if (event.type === "draft") {
            const reply = fromWire(event.draft);
            // A card discarded or moved to another section meanwhile stays so.
            setKept((k) =>
              k && k.draft.section === reply.section
                ? { draft: mergeReply(k.draft, sentDraft, reply), done: event.done }
                : k,
            );
            setVersion((v) => v + 1);
          } else if (event.type === "error") {
            failure = event.message;
          } else {
            setUsesLeft(event.uses_left);
          }
        }
      }
    } catch {
      failure = "WorkIt couldn't be reached. Check your connection and try again.";
    }
    setAnswering(false);
    setError(failure);
  }

  async function save(entry: EntryDraft, allowDuplicate = false) {
    setSaving(true);
    setSaveError(null);
    const { bullets, ...fields } = entry;
    const res = await createEntry(
      fields,
      bullets.map((b) => b.text),
      allowDuplicate,
    );
    setSaving(false);
    if (res.duplicate) return setDuplicate(res.duplicate);
    if (res.error) return setSaveError(res.error);
    setLines((l) => [...l, { kind: "saved", title: entry.title }]);
    advance(entry.section);
    const reloadError = await onSaved();
    if (reloadError) setError(reloadError);
  }

  const card = (
    <DraftCard
      key={version}
      draft={draft}
      done={kept?.done ?? false}
      onChange={(next) => setKept((k) => (k ? { ...k, draft: next } : k))}
      onSave={(next) => save(next)}
      onSaveAsNew={(next) => save(next, true)}
      onDiscard={finish}
      saving={saving}
      error={saveError}
      duplicate={duplicate}
    />
  );

  // The current segment grows with the draft: a head start, more once it has
  // a title, more with each answer, and full when WorkIt has no questions.
  const asked = messages.filter((m) => m.role === "assistant").length;
  const currentFill = !draft
    ? 0
    : kept?.done
      ? 100
      : Math.min(85, (draft.title ? 35 : 12) + asked * 20);

  return (
    <section aria-labelledby="intake-title" className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Mark />
        <div className="min-w-0">
          <h2 id="intake-title" className="text-subtitle text-ink">
            Tell WorkIt About It
          </h2>
          <p className="text-note text-ink-meta">
            Talk it through, and WorkIt fills in an entry from your own words.
          </p>
        </div>
      </div>

      <StepBar
        current={draft?.section ?? null}
        currentFill={currentFill}
        filled={filled}
        skipped={skipped}
        lead={lead}
        busy={answering || saving}
        onJump={jump}
        onSkip={skip}
      />

      <div className="grid items-start gap-5 @4xl/main:grid-cols-[1fr_21rem]">
        <div className="from-brand-tint to-panel ring-brand-tint flex h-[min(34rem,calc(100dvh-16rem))] min-h-[24rem] flex-col overflow-hidden rounded-3xl bg-linear-to-b ring-1">
          <div
            ref={log}
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pt-5 pb-4"
          >
            <WorkItLine>
              {walk
                ? "Hi! I'll help you fill your experience bank, one thing at a time. You can skip any section."
                : "Hi! Pick a section and tell me about one thing you did. I'll draft the entry while we talk, and you save it when it looks right."}
            </WorkItLine>

            {lines.map((line, i) => (
              <ChatLine key={i} line={line} follows={continues(lines, i)} />
            ))}

            {answering && (
              <div className="flex items-end gap-2.5">
                <Mark />
                <Message role="assistant" className="bg-panel shadow-card">
                  <Typing who="WorkIt" />
                </Message>
              </div>
            )}

            {error && (
              <p role="alert" className="text-note text-danger animate-fade pl-10.5">
                {error}
              </p>
            )}

            {!draft && (
              <div className="animate-fade flex flex-wrap gap-2 pl-10.5">
                {SECTIONS.map((s) => {
                  const Icon = ICONS[s.id];
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => start(s.id)}
                      className="text-label bg-panel text-brand ring-brand-pale hover:bg-brand-tint focus-visible:ring-brand-ring flex items-center gap-1.5 rounded-full px-3.5 py-1.5 ring-1 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <Icon aria-hidden className="size-3.5" /> {s.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* A screen reader hears each of WorkIt's lines once. */}
          <p aria-live="polite" className="sr-only">
            {!answering && lines.at(-1)?.kind === "text" ? lastText(lines) : ""}
          </p>

          <div className="flex flex-col gap-1.5 px-3 pb-3">
            {draft && (
              <button
                type="button"
                onClick={() => setSheet(true)}
                className="bg-panel ring-brand-tint flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-left ring-1 @4xl/main:hidden"
              >
                <Dot ready={kept?.done ?? false} />
                <span className="text-label text-ink min-w-0 flex-1 truncate">
                  {draft.title || `Your new ${sectionOf(draft.section).label} entry`}
                </span>
                <span className="text-note text-brand font-semibold">View</span>
              </button>
            )}
            <div className="[&>form]:p-0">
              <Composer
                onSend={send}
                answering={answering}
                disabled={!draft}
                who="WorkIt"
                label="Message WorkIt"
                placeholder={draft ? "Type your answer…" : "Pick a section to start"}
              />
            </div>
            {usesLeft !== null && (
              <p className="text-note text-ink-meta px-1">
                {usesLeft === 1 ? "1 message" : `${usesLeft} messages`} left today
              </p>
            )}
          </div>
        </div>

        <aside
          aria-label="Draft entry"
          className="bg-panel ring-brand-tint shadow-card hidden rounded-3xl ring-1 @4xl/main:sticky @4xl/main:top-4 @4xl/main:block"
        >
          {!sheet && card}
        </aside>
      </div>

      {sheet && draft && (
        <div
          className="fixed inset-0 z-40 @4xl/main:hidden"
          onKeyDown={(e) => e.key === "Escape" && setSheet(false)}
        >
          <button
            type="button"
            aria-label="Close draft"
            className="animate-fade bg-ink/30 absolute inset-0"
            onClick={() => setSheet(false)}
          />
          <div
            role="dialog"
            aria-label="Draft entry"
            className="animate-rise bg-panel absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-[2rem] pb-6 shadow-2xl"
          >
            <div aria-hidden className="bg-brand-pale mx-auto mt-3 h-1.5 w-12 rounded-full" />
            {card}
          </div>
        </div>
      )}
    </section>
  );
}

function continues(lines: Line[], i: number): boolean {
  const prev = lines[i - 1];
  const line = lines[i];
  return (
    line.kind === "text" &&
    line.role === "assistant" &&
    prev?.kind === "text" &&
    prev.role === "assistant"
  );
}

function lastText(lines: Line[]): string {
  const last = lines.at(-1);
  return last?.kind === "text" && last.role === "assistant" ? last.content : "";
}

function WorkItLine({ follows = false, children }: { follows?: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex items-end gap-2.5", follows && "-mt-1.5")}>
      {follows ? <span className="w-8 shrink-0" /> : <Mark />}
      <Message role="assistant" className="bg-panel shadow-card leading-relaxed">
        {children}
      </Message>
    </div>
  );
}

function ChatLine({ line, follows }: { line: Line; follows: boolean }) {
  if (line.kind === "chapter") return <Chapter section={line.section} />;
  if (line.kind === "saved")
    return (
      <div className="animate-pop text-label bg-positive-tint text-positive-ink mx-auto my-1 flex items-center gap-2 rounded-full px-4 py-1.5">
        <PartyPopper aria-hidden className="size-4" />
        Saved! {line.title}
      </div>
    );
  if (line.kind === "skipped")
    return (
      <p className="text-note text-ink-meta mx-auto flex items-center gap-1.5 text-center">
        <SkipForward aria-hidden className="size-3.5 shrink-0" />
        Skipped {sectionOf(line.section).label}. You can come back to it anytime.
      </p>
    );
  if (line.role === "user") return <Message role="user">{line.content}</Message>;
  return <WorkItLine follows={follows}>{line.content}</WorkItLine>;
}

/** A divider that opens each section, so the chat reads in chapters. */
function Chapter({ section }: { section: Section }) {
  const Icon = ICONS[section];
  return (
    <div className="my-2 flex items-center gap-3">
      <span className="bg-brand-pale h-px flex-1" />
      <span className="text-note text-brand flex items-center gap-1.5 font-semibold">
        <Icon aria-hidden className="size-3.5" /> {sectionOf(section).label}
      </span>
      <span className="bg-brand-pale h-px flex-1" />
    </div>
  );
}

function Dot({ ready }: { ready: boolean }) {
  return (
    <span aria-hidden className="relative flex size-2.5 shrink-0">
      {!ready && (
        <span className="bg-brand absolute inset-0 animate-ping rounded-full opacity-40" />
      )}
      <span className={cn("relative size-2.5 rounded-full", ready ? "bg-positive" : "bg-brand")} />
    </span>
  );
}

/** The draft entry card: the shared entry editor under a header that says
 *  which section it is and whether WorkIt has more to ask. It is its own
 *  `@container/main`, so the editor lays out for the card's width rather
 *  than the page's. */
function DraftCard({
  draft,
  done,
  onChange,
  onSave,
  onSaveAsNew,
  onDiscard,
  saving,
  error,
  duplicate,
}: {
  draft: EntryDraft | null;
  done: boolean;
  onChange: (draft: EntryDraft) => void;
  onSave: (draft: EntryDraft) => void;
  onSaveAsNew: (draft: EntryDraft) => void;
  onDiscard: () => void;
  saving: boolean;
  error: string | null;
  duplicate: BankEntry | null;
}) {
  if (!draft)
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <Mark />
        <p className="text-subtitle text-ink">Your Entry Builds Here</p>
        <p className="text-note text-ink-meta">
          Tell WorkIt about something you did. It turns into a resume entry as you talk.
        </p>
      </div>
    );

  const Icon = ICONS[draft.section];
  return (
    <div className="@container/main flex flex-col gap-4 p-5">
      <div className="flex items-center gap-3">
        <span className="bg-brand-tint text-brand flex size-10 items-center justify-center rounded-2xl">
          <Icon aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-label text-ink">{sectionOf(draft.section).label}</p>
          <p className="text-note text-ink-meta flex items-center gap-1.5">
            <Dot ready={done} />
            {done ? "Looks good! Ready to save" : "Filling in as you talk…"}
          </p>
        </div>
      </div>
      <EntryEditor
        initial={draft}
        onChange={onChange}
        onSave={onSave}
        onCancel={onDiscard}
        cancelLabel="Discard"
        saving={saving}
        error={error}
        duplicate={duplicate}
        onSaveAsNew={onSaveAsNew}
      />
    </div>
  );
}
