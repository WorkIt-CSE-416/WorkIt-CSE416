"use client";

import { ArrowUp, MessageCircle, Mic, SlidersHorizontal, Star } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ArrowRightIcon, CloseIcon, SparkleIcon } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

import { ReplyText } from "./reply-text";
import { closeScout, sendToScout, useScout } from "./scout-store";
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
 *
 * OPENING IS TWO MOVES, NOT A SQUEEZE. The panel stays mounted (inert while
 * closed). From md, opening first makes room in one step: the <aside> takes
 * its 384px and 12px gap at once, so the page lays itself out a single time
 * at its new width, and settles into it with a short glide from 32px to the
 * right and a fade up (scout-page-in in globals.css, keyed off data-scout on
 * this <aside> through the row in (seeker)/layout.tsx). Meanwhile the panel
 * slides in from the window's edge on transform alone, 360ms on the glide.
 * Closing is one move: the room goes back to the page at once, and the page
 * settles out to its full width (scout-page-out) while the panel slides off
 * to the right over the page's edge on the exit curve (200ms). Holding the
 * room until the panel had gone, as it first did, left the page waiting a
 * beat before it widened, which read as lag.
 * Animating the <aside>'s width instead, as it once did, made the page lay
 * itself out on every frame for 300ms: text rewrapped as it went and the
 * Dashboard dropped a column partway through, which read as the page being
 * squeezed. Below md, where it covers the window, it rises and fades in.
 * Escape closes it from anywhere inside, and focus goes back to the bar's
 * launcher.
 *
 * NO RULED LINES. The header and the composer used to be fenced off with
 * hairlines; the header is now the panel's own top, and the conversation
 * fades out under it and above the composer instead, so it reads as one
 * surface. Every icon-only control carries a tooltip (ui/icon-button.tsx),
 * Send included: it is aria-disabled rather than disabled while there is
 * nothing to send, so its tooltip can still say why.
 */
export function ScoutPanel() {
  const { open, messages, reply, error } = useScout();
  const answering = reply !== null;
  // "closed" only once it has been open, so a page load does not play the
  // page's settle for a panel nobody opened.
  const [touched, setTouched] = useState(open);
  if (open && !touched) setTouched(true);
  const phase = open ? "open" : touched ? "closed" : undefined;
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Keep the newest text in view while a reply streams in, and land on it
  // when the panel is reopened. Scrolls the conversation alone: scrolling an
  // element into view would scroll the page too.
  useEffect(() => {
    if (open && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [open, messages, reply, error]);

  // Opening puts the cursor in the message box, so a question can be typed at
  // once. Not on a phone, where focusing would throw the keyboard over the
  // answer an "Ask Scout" click is waiting for.
  useEffect(() => {
    if (open && window.matchMedia("(min-width: 48rem)").matches) {
      input.current?.focus({ preventScroll: true });
    }
  }, [open]);

  // The streaming reply sits in the thread at the index its finished message
  // will take, so React keeps the same bubble when it lands rather than
  // swapping in a new one that would rise in a second time.
  const thread: (ScoutMessage & { streaming?: boolean })[] = answering
    ? [...messages, { role: "assistant", content: reply, streaming: true }]
    : messages;
  const last = messages.at(-1);

  return (
    <aside
      aria-label="Scout"
      data-scout={phase}
      inert={!open}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          closeScout();
        }
      }}
      className={cn(
        // Below md: a sheet over the window.
        "fixed inset-0 z-30 transition-[opacity,translate,visibility]",
        open
          ? "ease-glide visible translate-y-0 opacity-100 duration-300"
          : "ease-exit invisible translate-y-4 opacity-0 duration-200",
        // From md: the panel's room beside the page. It opens at once; on
        // close it goes at once too, and the panel slides out over the page's
        // edge (the row clips it at the window's).
        "md:visible md:static md:inset-auto md:z-auto md:translate-y-0 md:opacity-100",
        "md:relative md:shrink-0",
        open ? "md:ml-3 md:w-96" : "md:ml-0 md:w-0",
      )}
    >
      <div
        className={cn(
          "bg-panel flex h-full flex-col",
          "md:border-rail-border md:rounded-shell md:shadow-panel md:absolute md:inset-y-0 md:right-0 md:w-96 md:border",
          // Slides from just past the window's edge into the room made for it.
          "md:transition-[opacity,translate] md:delay-0",
          open
            ? "md:ease-glide md:translate-x-0 md:opacity-100 md:duration-[360ms]"
            : "md:ease-exit md:translate-x-[calc(100%+12px)] md:opacity-0 md:duration-200",
        )}
      >
        <header className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-1">
          <span
            aria-hidden="true"
            className="bg-brand-tint text-brand flex size-9 shrink-0 items-center justify-center rounded-full"
          >
            <SparkleIcon className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-subtitle text-ink font-semibold">Scout</h2>
            <p className="text-note text-ink-meta">Your job search assistant</p>
          </div>
          <IconButton
            label="Close Scout"
            className="hover:bg-hover ml-auto size-8 rounded-full after:hidden"
            onClick={closeScout}
          >
            <CloseIcon className="size-4" />
          </IconButton>
        </header>

        {/* The conversation fades out under the header and above the
            composer rather than being ruled off from them. */}
        <div
          ref={log}
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain [mask-image:linear-gradient(to_bottom,transparent,black_16px,black_calc(100%-16px),transparent)] px-4 py-4"
        >
          <Bubble>Hi, I&apos;m Scout! You&apos;ve just unlocked your chat with me.</Bubble>
          <Suggestions onPick={sendToScout} disabled={answering} />

          {thread.map((message, i) => (
            <Message key={i} role={message.role}>
              {message.role === "user" ? (
                message.content
              ) : message.content ? (
                <ReplyText text={message.content} />
              ) : (
                <Typing />
              )}
            </Message>
          ))}

          {error && (
            <p role="alert" className="text-note text-danger animate-fade px-1">
              {error}
            </p>
          )}
        </div>

        {/* A screen reader hears each finished reply once, not every word as
            it streams in. */}
        <p aria-live="polite" className="sr-only">
          {!answering && last?.role === "assistant" ? last.content : ""}
        </p>

        <Composer onSend={sendToScout} answering={answering} input={input} />
      </div>
    </aside>
  );
}

function Bubble({ children }: { children: ReactNode }) {
  return (
    <div className="bg-surface text-body text-ink self-start rounded-2xl rounded-bl-md px-4 py-3">
      {children}
    </div>
  );
}

/** The two questions Scout answers from here, as rows to press, and a tip
 *  for the third thing it does, which starts from a job's own card. The tip
 *  is a line of text, not a row: drawn as a row it looked as pressable as
 *  the two above it and did nothing. */
function Suggestions({ onPick, disabled }: { onPick: (text: string) => void; disabled: boolean }) {
  return (
    <div className="bg-surface rounded-2xl p-2">
      <p className="text-label text-ink px-2 pt-1 pb-1.5 font-semibold">Tasks I can help with</p>
      <Suggestion
        icon={<SlidersHorizontal className="size-4" />}
        title="Adjust current preference"
        description="Fine-tune your job search criteria."
        disabled={disabled}
        onClick={() => onPick("Help me adjust my job search preferences.")}
      />
      <Suggestion
        icon={<Star className="size-4" />}
        title="Top Match jobs"
        description="Explore jobs where you shine as a top candidate."
        disabled={disabled}
        onClick={() => onPick("Which jobs am I a top match for?")}
      />
      <p className="text-note text-ink-meta flex items-start gap-2 px-2 pt-2 pb-1">
        <MessageCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        Click &ldquo;Ask Scout&rdquo; on any job for insights on that role.
      </p>
    </div>
  );
}

/** A row that asks Scout something: it lightens under the pointer, its glyph
 *  takes the brand tint and its arrow leans on, and it presses in on the
 *  click, like every other control in the app. */
function Suggestion({
  icon,
  title,
  description,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group/task hover:bg-panel focus-visible:ring-brand-ring flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-[background-color,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none active:scale-[0.99] disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className="bg-panel text-ink-meta group-hover/task:bg-brand-tint group-hover/task:text-brand flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-label text-ink block font-semibold">{title}</span>
        <span className="text-note text-ink-meta block">{description}</span>
      </span>
      <ArrowRightIcon className="text-ink-subtle group-hover/task:text-ink ease-glide size-4 shrink-0 transition-[color,translate] duration-200 group-hover/task:translate-x-0.5" />
    </button>
  );
}

/** A bubble rises in as it arrives. The sender's corner is squared, the way
 *  a chat draws who spoke. */
function Message({ role, children }: { role: ScoutMessage["role"]; children: ReactNode }) {
  const mine = role === "user";
  return (
    <div
      className={cn(
        "text-body animate-rise max-w-[85%] rounded-2xl px-4 py-2.5",
        // The user's own text keeps its line breaks; Scout's are ReplyText's paragraphs.
        mine
          ? "bg-brand text-on-brand self-end rounded-br-md whitespace-pre-wrap"
          : "bg-surface text-ink self-start rounded-bl-md",
      )}
    >
      {children}
    </div>
  );
}

/** Three dots while Scout works out its first words. */
function Typing() {
  return (
    <span role="status" className="flex h-6 items-center gap-1">
      <span className="sr-only">Scout is thinking</span>
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

function Composer({
  onSend,
  answering,
  input,
}: {
  onSend: (text: string) => void;
  answering: boolean;
  input: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [draft, setDraft] = useState("");
  const speech = useSpeechInput((text) => setDraft((d) => (d ? `${d} ${text}` : text)));
  const empty = !draft.trim();
  const blocked = answering || empty;

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
              answering ? "Scout is still answering" : empty ? "Type a message to send" : "Send"
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
