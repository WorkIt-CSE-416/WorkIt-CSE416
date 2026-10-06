"use client";

import { ArrowUp, MessageCircle, Mic, SlidersHorizontal, Star } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ChevronDownIcon, SparkleIcon } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

import { ReplyText } from "./reply-text";
import { sendToScout, setScoutOpen, useScout } from "./scout-store";
import type { ScoutMessage } from "./stream";
import { useSpeechInput } from "./use-speech-input";

/**
 * Scout's panel, after JobRight's Orion: a header, a welcome, a card of what
 * Scout can do, the conversation, and a composer.
 *
 * Docked beside the page rather than over it. A modal sheet would lock the
 * feed, and the point is to keep scrolling and pressing "Ask Scout" on other
 * cards while it is open. From md it is one more of the shell's floating
 * panels; below md there is no room beside anything, so it covers the window.
 *
 * It only ever opens because someone clicked something: an assistant that
 * pops up uninvited is the complaint reviewers make most about Orion.
 */
export function ScoutPanel() {
  const { open, messages, reply, error } = useScout();
  const answering = reply !== null;
  const end = useRef<HTMLDivElement>(null);

  // Keep the newest text in view while a reply streams in, and land on it
  // when the panel is reopened.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [open, messages, reply, error]);

  if (!open) return null;

  return (
    <aside
      aria-label="Scout"
      className="bg-panel border-rail-border fixed inset-0 z-30 flex flex-col overflow-hidden md:static md:w-96 md:shrink-0 md:rounded-shell md:border md:shadow-panel"
    >
      <header className="border-border flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SparkleIcon className="text-brand size-5" />
        <h2 className="text-subtitle text-ink font-semibold">Scout</h2>
        <IconButton label="Close Scout" className="ml-auto" onClick={() => setScoutOpen(false)}>
          <ChevronDownIcon className="size-5" />
        </IconButton>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4">
        <Bubble>Hi, I&apos;m Scout! You&apos;ve just unlocked your chat with me.</Bubble>
        <GreetingCard onPick={sendToScout} disabled={answering} />

        {messages.map((message, i) => (
          <Message key={i} role={message.role}>
            {message.role === "assistant" ? <ReplyText text={message.content} /> : message.content}
          </Message>
        ))}
        {answering && (
          <Message role="assistant">
            {reply ? <ReplyText text={reply} /> : <span className="text-ink-meta">Thinking…</span>}
          </Message>
        )}

        {error && (
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        )}
        <div ref={end} />
      </div>

      <Composer onSend={sendToScout} disabled={answering} />
    </aside>
  );
}

function Bubble({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("bg-surface text-body text-ink rounded-2xl px-4 py-3", className)}>
      {children}
    </div>
  );
}

/** The three things Scout offers, as in the reference. The first two are
 *  questions Scout answers; the third is an instruction, since asking about
 *  a job starts from that job's own card. */
function GreetingCard({ onPick, disabled }: { onPick: (text: string) => void; disabled: boolean }) {
  return (
    <Bubble className="flex flex-col gap-1">
      <p className="text-subtitle text-ink mb-1 font-semibold">Tasks I can help with:</p>
      {/* divide-y draws a rule between rows, whichever element each row is. */}
      <div className="divide-border divide-y">
        <Task
          icon={<SlidersHorizontal className="size-4" />}
          title="Adjust current preference"
          description="Fine-tune your job search criteria."
          onClick={disabled ? undefined : () => onPick("Help me adjust my job search preferences.")}
        />
        <Task
          icon={<Star className="size-4" />}
          title="Top Match jobs"
          description="Explore jobs where you shine as a top candidate."
          onClick={disabled ? undefined : () => onPick("Which jobs am I a top match for?")}
        />
        <Task
          icon={<MessageCircle className="size-4" />}
          title="Ask Scout"
          description="Click 'Ask Scout' on any job for insights on that role."
        />
      </div>
    </Bubble>
  );
}

function Task({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="text-ink flex items-center gap-2 font-semibold">
        {icon}
        {title}
      </span>
      <span className="text-ink-meta">{description}</span>
    </>
  );
  const row = "text-body flex flex-col gap-0.5 py-2 text-left";
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        row,
        "hover:bg-hover focus-visible:ring-brand-ring w-full rounded-md focus-visible:ring-2 focus-visible:outline-none",
      )}
    >
      {body}
    </button>
  ) : (
    <div className={row}>{body}</div>
  );
}

function Message({ role, children }: { role: ScoutMessage["role"]; children: ReactNode }) {
  const mine = role === "user";
  return (
    <div
      className={cn(
        "text-body max-w-[85%] rounded-2xl px-4 py-2.5",
        // The user's own text keeps its line breaks; Scout's are ReplyText's paragraphs.
        mine
          ? "bg-brand text-on-brand self-end whitespace-pre-wrap"
          : "bg-surface text-ink self-start",
      )}
    >
      {children}
    </div>
  );
}

function Composer({ onSend, disabled }: { onSend: (text: string) => void; disabled: boolean }) {
  const [draft, setDraft] = useState("");
  const speech = useSpeechInput((text) => setDraft((d) => (d ? `${d} ${text}` : text)));

  function submit() {
    if (disabled || !draft.trim()) return;
    onSend(draft);
    setDraft("");
  }

  return (
    <form
      className="border-border shrink-0 border-t p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="border-brand/40 focus-within:ring-brand-ring rounded-2xl border p-3 focus-within:ring-2">
        <textarea
          aria-label="Message Scout"
          placeholder="Ask me anything..."
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
          className="text-body text-ink placeholder:text-ink-subtle w-full resize-none bg-transparent outline-none"
        />
        <div className="flex items-center justify-end gap-2">
          {speech.supported && (
            <IconButton
              label={speech.listening ? "Stop dictating" : "Dictate a message"}
              variant="outline"
              className={cn("size-9 rounded-full", speech.listening && "text-brand border-brand")}
              onClick={speech.toggle}
            >
              <Mic className="size-4" />
            </IconButton>
          )}
          <IconButton
            label="Send"
            type="submit"
            variant="brand"
            className="size-9"
            disabled={disabled || !draft.trim()}
          >
            <ArrowUp className="size-4" />
          </IconButton>
        </div>
      </div>
    </form>
  );
}
