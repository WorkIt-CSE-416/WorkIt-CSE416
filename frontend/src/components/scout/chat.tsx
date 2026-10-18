"use client";

import { ArrowUp, Mic } from "lucide-react";
import { useState, type ReactNode } from "react";

import { SparkleIcon } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

import type { ScoutMessage } from "./stream";
import { useSpeechInput } from "./use-speech-input";

/**
 * The chat pieces Scout's panel, intake on the bank page and the editor
 * assistant share: a message bubble, the typing dots, the composer with its
 * mic, and WorkIt's mark beside its lines in intake's look. Each caller
 * names itself through the props (who is thinking, what the box is for), so
 * the pieces never say "Scout" where Scout is not the one talking.
 */

/** A bubble rises in as it arrives. The sender's corner is squared, the way
 *  a chat draws who spoke. */
export function Message({
  role,
  className,
  children,
}: {
  role: ScoutMessage["role"];
  className?: string;
  children: ReactNode;
}) {
  const mine = role === "user";
  return (
    <div
      className={cn(
        "text-body animate-rise max-w-[85%] rounded-2xl px-4 py-2.5",
        // The user's own text keeps its line breaks; Scout's are ReplyText's paragraphs.
        mine
          ? "bg-brand text-on-brand self-end rounded-br-md whitespace-pre-wrap"
          : "bg-surface text-ink self-start rounded-bl-md",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** WorkIt's mark: the brand gradient with a sparkle, beside its lines in
 *  intake and the editor assistant (the intake prototype's variant G), and
 *  in Scout's panel header. The sparkle is `SparkleIcon`, the one glyph
 *  for Scout and AI (KAN-257). */
export function WorkItMark() {
  return (
    <span
      aria-hidden
      className="from-brand to-brand-pale text-on-brand flex size-8 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br shadow-[0_4px_12px_rgb(109_63_216/0.35)]"
    >
      <SparkleIcon className="size-4" />
    </span>
  );
}

/** Three dots while the assistant works out its first words. */
export function Typing({ who = "Scout" }: { who?: string }) {
  return (
    <span role="status" className="flex h-6 items-center gap-1">
      <span className="sr-only">{who} is thinking</span>
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          aria-hidden="true"
          className="bg-ink-subtle animate-typing size-1.5 rounded-full"
          style={{ animationDelay: `${dot * 150}ms` }}
        />
      ))}
    </span>
  );
}

export function Composer({
  onSend,
  answering,
  input,
  who = "Scout",
  label = "Message Scout",
  placeholder = "Ask me anything...",
  disabled = false,
}: {
  onSend: (text: string) => void;
  answering: boolean;
  input?: React.RefObject<HTMLTextAreaElement | null>;
  /** Who answers, for the Send button's tooltip while it does. */
  who?: string;
  label?: string;
  placeholder?: string;
  /** Nothing to answer yet (intake before a section is picked). */
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const speech = useSpeechInput((text) => setDraft((d) => (d ? `${d} ${text}` : text)));
  const empty = !draft.trim();
  const blocked = answering || empty || disabled;

  function submit() {
    if (blocked) return;
    onSend(draft);
    setDraft("");
  }

  return (
    <form
      className="shrink-0 px-3 pt-1 pb-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {/* A grey field like the bar's search, turning white with the brand
          ring while it is being typed in. */}
      <div className="bg-app hover:bg-hover focus-within:bg-panel focus-within:hover:bg-panel focus-within:ring-brand-ring rounded-2xl p-3 transition-[background-color,box-shadow] duration-150 focus-within:ring-2">
        <textarea
          ref={input}
          aria-label={label}
          placeholder={placeholder}
          disabled={disabled}
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a new line, as in every chat box.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="text-body text-ink placeholder:text-ink-meta w-full resize-none bg-transparent outline-none"
        />
        <div className="flex items-center justify-end gap-2">
          {speech.supported && (
            <IconButton
              label={speech.listening ? "Stop dictating" : "Dictate a message"}
              className={cn(
                "relative size-8 rounded-full after:hidden",
                speech.listening
                  ? "bg-brand text-on-brand hover:text-on-brand"
                  : "hover:bg-panel text-ink-meta",
              )}
              onClick={speech.toggle}
              disabled={disabled}
            >
              {/* While it listens, a ring breathes around it, like a
                  recording light. */}
              {speech.listening && (
                <span
                  aria-hidden="true"
                  className="ring-brand/40 absolute inset-0 animate-pulse rounded-full ring-4"
                />
              )}
              <Mic className="size-4" />
            </IconButton>
          )}
          <IconButton
            label="Send"
            tooltip={
              answering ? `${who} is still answering` : empty ? "Type a message to send" : "Send"
            }
            type="submit"
            variant="brand"
            aria-disabled={blocked}
            className="size-8 border-0 aria-disabled:cursor-default aria-disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </IconButton>
        </div>
      </div>
    </form>
  );
}
