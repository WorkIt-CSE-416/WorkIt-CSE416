"use client";

import { useEffect, useRef, useState } from "react";

import { Composer, Message, Typing, ScoutMark } from "@/components/scout/chat";
import { Chip } from "@/components/ui/chip";
import { askAssistant, type AssistantLine } from "@/lib/assistant-actions";
import type { Bank } from "@/lib/bank-actions";
import type { Choices, ChoicesUpdate } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";

import { move, wording, type BankLine as Line } from "./model";

/**
 * The editor assistant (KAN-221): a chat in Scout's panel on a wide screen,
 * opened from the top bar's Scout (KAN-411; it docked beside the page from
 * a toolbar Ask Scout until then, the editor prototype's variant E), and in
 * a sheet on a phone. Either holder draws its header and close button. It
 * fits the resume, hides and moves the selected line, and makes a bullet
 * shorter; it does no other rewording. The look is intake's (variant G) and
 * the bubbles, dots and composer are Scout's (`components/scout/chat.tsx`).
 *
 * Typed messages go to `POST .../assistant`, which reads them into one
 * action and spends one of today's assistant messages; its lines are fixed
 * text from the API, never the model's. The chips do what they say with no
 * AI call, except "Make it shorter", which needs the model. Every action is
 * applied through the editor's own saves (the choices PATCH and Fit), and a
 * shorter wording waits for Use This, which saves it as this resume's
 * wording. The chat is not stored.
 */

type Shorter = { bulletId: string; before: string; after: string };
type Said =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; shorter?: Shorter; done?: boolean };

const HELLO =
  "Need a hand? I can fit your resume to one page, or hide, move or shorten a line you pick.";
const EDGE = "It can't move any further that way.";
const ONE_PAGE = "It already fits on one page.";

function hideChanges(line: Line): ChoicesUpdate {
  if (line.kind === "bullet") return { bullets: [{ bullet_id: line.bullet.id, shown: false }] };
  if (line.kind === "entry") return { entries: [{ entry_id: line.entry.id, shown: false }] };
  return { skills: [{ skill_id: line.skill.id, shown: false }] };
}

function lineIds(line: Line | null): AssistantLine {
  if (!line) return {};
  if (line.kind === "bullet") return { bullet_id: line.bullet.id };
  if (line.kind === "entry") return { entry_id: line.entry.id };
  return { skill_id: line.skill.id };
}

function lineText(line: Line, choices: Choices) {
  if (line.kind === "bullet") return wording(choices, line.bullet);
  if (line.kind === "entry") return line.entry.title;
  return line.skill.name;
}

export function Assistant({
  resumeId,
  bank,
  choices,
  line,
  pageCount,
  onApply,
  onHide,
  onFit,
  className,
}: {
  resumeId: string;
  bank: Bank;
  choices: Choices;
  /** The line selected on the page, if any: what "it" means. */
  line: Line | null;
  pageCount: number;
  onApply: (changes: ChoicesUpdate) => void;
  /** Hides a line and clears the selection. */
  onHide: (changes: ChoicesUpdate) => void;
  onFit: () => void;
  className?: string;
}) {
  const [said, setSaid] = useState<Said[]>([{ role: "assistant", content: HELLO }]);
  const [answering, setAnswering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usesLeft, setUsesLeft] = useState<number | null>(null);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [said, answering, error]);

  const say = (content: string, shorter?: Shorter) =>
    setSaid((s) => [...s, { role: "assistant", content, shorter }]);

  /** The editor actions, applied to the line selected when it was asked. */
  function act(
    action: "fit" | "hide" | "move_up" | "move_down",
    target: Line | null,
    reply: string,
  ) {
    if (action === "fit") {
      if (pageCount <= 1) return say(ONE_PAGE);
      onFit();
      return say(`${reply} Undo in the bar puts back what it hides.`);
    }
    if (!target) return say(reply);
    if (action === "hide") {
      onHide(hideChanges(target));
      return say(reply);
    }
    const changes = move(bank, choices, target, action === "move_up" ? -1 : 1);
    if (!changes) return say(EDGE);
    onApply(changes);
    say(reply);
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || answering) return;
    const target = line;
    setSaid((s) => [...s, { role: "user", content }]);
    setAnswering(true);
    setError(null);
    const { data, error } = await askAssistant(resumeId, content, lineIds(target));
    setAnswering(false);
    if (!data) return setError(error);
    setUsesLeft(data.uses_left);
    if (data.action === "shorter" && target?.kind === "bullet" && data.text && data.original)
      return say(data.reply, {
        bulletId: target.bullet.id,
        before: data.original,
        after: data.text,
      });
    if (data.action === "none" || data.action === "shorter") return say(data.reply);
    act(data.action, target, data.reply);
  }

  /** A chip: the student's words in the chat, then the action with no AI call. */
  function chip(label: string, action: "fit" | "hide" | "move_up") {
    setSaid((s) => [...s, { role: "user", content: label }]);
    const reply = {
      fit: "Fitting it to one page.",
      hide: "Done. Turn it back on under Experiences if you want it.",
      move_up: "Moved it up.",
    }[action];
    act(action, line, reply);
  }

  function settle(i: number, use: boolean) {
    const message = said[i];
    if (message.role !== "assistant" || !message.shorter) return;
    if (use)
      onApply({ bullets: [{ bullet_id: message.shorter.bulletId, text: message.shorter.after }] });
    setSaid((s) => [
      ...s.map((m, j) => (j === i ? { ...m, done: true } : m)),
      {
        role: "assistant",
        content: use ? "Done! It's on the page now." : "No problem, I kept your wording.",
      },
    ]);
  }

  return (
    // A div: its holder (Scout's panel, the phone's sheet) is the landmark
    // and names it, and a second "Scout" inside the panel's was one too many
    <div
      className={cn(
        "from-brand-tint to-panel flex min-h-0 flex-col overflow-hidden bg-linear-to-b",
        className,
      )}
    >
      <div
        ref={log}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pt-4 pb-3"
      >
        {said.map((m, i) =>
          m.role === "user" ? (
            <Message key={i} role="user">
              {m.content}
            </Message>
          ) : (
            <div
              key={i}
              className={cn(
                "flex items-end gap-2.5",
                said[i - 1]?.role === "assistant" && "-mt-1.5",
              )}
            >
              {said[i - 1]?.role === "assistant" ? (
                <span className="w-8 shrink-0" />
              ) : (
                <ScoutMark />
              )}
              <Message
                role="assistant"
                className="bg-panel shadow-card flex flex-col gap-2 leading-relaxed"
              >
                <span>{m.content}</span>
                {m.shorter && (
                  <>
                    <span className="text-note text-ink-meta line-through">{m.shorter.before}</span>
                    <span className="text-note bg-brand-tint rounded-lg p-2">
                      {m.shorter.after}
                    </span>
                    {!m.done && (
                      <span className="flex flex-wrap gap-2">
                        <Chip variant="primary" onClick={() => settle(i, true)}>
                          Use This
                        </Chip>
                        <Chip variant="suggestion" onClick={() => settle(i, false)}>
                          Keep Mine
                        </Chip>
                      </span>
                    )}
                  </>
                )}
              </Message>
            </div>
          ),
        )}
        {answering && (
          <div className="flex items-end gap-2.5">
            <ScoutMark />
            <Message role="assistant" className="bg-panel shadow-card">
              <Typing who="Scout" />
            </Message>
          </div>
        )}
        {error && (
          <p role="alert" className="text-note text-danger animate-fade pl-10.5">
            {error}
          </p>
        )}
        {!answering && (
          <div className="flex flex-wrap gap-2 pl-10.5">
            {line?.kind === "bullet" && (
              <Chip variant="suggestion" onClick={() => send("Make it shorter")}>
                Make it shorter
              </Chip>
            )}
            {line && (
              <Chip variant="suggestion" onClick={() => chip("Hide it", "hide")}>
                Hide it
              </Chip>
            )}
            {line && line.kind !== "skill" && (
              <Chip variant="suggestion" onClick={() => chip("Move it up", "move_up")}>
                Move it up
              </Chip>
            )}
            {!line && pageCount > 1 && (
              <Chip variant="suggestion" onClick={() => chip("Fit to one page", "fit")}>
                Fit to one page
              </Chip>
            )}
          </div>
        )}
      </div>

      {/* A screen reader hears each of Scout's lines once. */}
      <p aria-live="polite" className="sr-only">
        {!answering && said.at(-1)?.role === "assistant" ? said.at(-1)!.content : ""}
      </p>

      <div className="flex flex-col gap-1.5 px-3 pb-3">
        {line && (
          <span className="text-note bg-brand-tint text-brand max-w-full self-start truncate rounded-lg px-2 py-1">
            {lineText(line, choices)}
          </span>
        )}
        <div className="[&>form]:p-0">
          <Composer
            onSend={send}
            answering={answering}
            who="Scout"
            label="Message Scout"
            placeholder={line ? "What should change?" : "Ask Scout, or pick a line…"}
          />
        </div>
        {usesLeft !== null && (
          <p className="text-note text-ink-meta px-1">
            {usesLeft === 1 ? "1 message" : `${usesLeft} messages`} left today
          </p>
        )}
      </div>
    </div>
  );
}
