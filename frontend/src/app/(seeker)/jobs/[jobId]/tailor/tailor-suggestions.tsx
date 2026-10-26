"use client";

import { CheckIcon, XIcon } from "@phosphor-icons/react/ssr";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Bank } from "@/lib/bank-actions";
import type { Choices } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";
import type { TailorEdit } from "@/lib/tailor-actions";

import { Editor } from "../../../resumes/[resumeId]/editor";
import { wording } from "../../../resumes/[resumeId]/model";
import {
  editKey,
  movesOf,
  useTailorReview,
  type SuggestionsApi,
} from "../../../resumes/[resumeId]/tailor-review";
import { TailorScore } from "./tailor-score";

/**
 * Tailor's review step (docs/tailor_resume.md, "Marking and reverting
 * changes"): the tailored resume in the editor, with a Suggestions panel
 * beside it, as a document's suggestions sit in its margin. The run's
 * changes are saved already, so each card offers Accept, which keeps the
 * change and clears its tint, and Reject, which undoes it. Pointing at a
 * card outlines its lines on the page; clicking a tinted line brings its
 * card up. The editor owns the state and lays the panel out
 * (`suggestions`); this file draws it.
 *
 * The record lives in this tab's sessionStorage, so a new tab or device has
 * no suggestions: the editor shows alone, with a line that says why.
 */
export function TailorReview(editor: ComponentProps<typeof Editor>) {
  const [record] = useTailorReview(editor.resumeId);
  // Storage is read after mount; until then the page shows no line about it.
  const [read, setRead] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- marks the storage read done
    setRead(true);
  }, []);
  const noRecord = read && !record && (
    <p className="text-note text-ink-meta mt-3">
      Tailor&apos;s suggestions show only in the tab that ran Tailor.
    </p>
  );

  return (
    // The page and the panel need more than the reading width, so with a
    // record the review widens to the shell's, up to 76rem.
    <div
      className={cn(
        "[--wide:max(100%,min(76rem,calc(100cqw_-_6rem)))]",
        record && "@4xl/main:ml-[calc((100%_-_var(--wide))/2)] @4xl/main:w-(--wide)",
      )}
    >
      {noRecord}
      <Editor
        {...editor}
        phoneBar={noRecord}
        suggestions={(api) => <SuggestionsPanel {...api} />}
      />
    </div>
  );
}

function SuggestionsPanel({
  record,
  bank,
  choices,
  saving,
  accept,
  reject,
  acceptAll,
  rejectAll,
  focused,
  focus,
  show,
  active,
}: SuggestionsApi) {
  const { edits, match } = record;
  const list = useRef<HTMLOListElement>(null);
  // The card of the tinted line last clicked comes into view
  useEffect(() => {
    if (!active) return;
    list.current
      ?.querySelector(`[data-card="${CSS.escape(active)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  return (
    <section
      aria-labelledby="suggestions-heading"
      // A card beside the page; bare in the phone's sheet, which has its own
      // frame and title
      className="sm:bg-panel sm:ring-border-subtle flex flex-col gap-3 sm:rounded-2xl sm:p-4 sm:shadow-sm sm:ring-1"
    >
      {/* The top stays in view while the cards scroll under it */}
      <div className="bg-panel sticky top-0 z-10 flex flex-col gap-3 pb-1 sm:-mx-4 sm:-mt-4 sm:rounded-t-2xl sm:px-4 sm:pt-4">
        <div className="flex items-center gap-2">
          <h2 id="suggestions-heading" className="text-title text-ink max-sm:sr-only">
            Suggestions
          </h2>
          {/* TODO: View Original here: ResumePreviewDialog({ open, onOpenChange,
              label, source }) from ./resume-preview.tsx, with `record.source`,
              once it lands (the merging session wires it). */}
        </div>
        {match && <TailorScore match={match} />}
        {edits.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-label text-ink mr-auto">
              {edits.length} {edits.length === 1 ? "Suggestion" : "Suggestions"}
            </p>
            <Button variant="secondary" size="sm" disabled={saving} onClick={rejectAll}>
              Reject All
            </Button>
            <Button size="sm" disabled={saving} onClick={acceptAll}>
              Accept All
            </Button>
          </div>
        )}
      </div>
      {edits.length > 0 ? (
        <>
          <ol ref={list} role="list" className="flex flex-col gap-2">
            {edits.map((edit) => {
              const key = editKey(edit);
              return (
                <li key={key}>
                  <Card
                    edit={edit}
                    bank={bank}
                    choices={choices}
                    cardKey={key}
                    lit={focused === key || active === key}
                    saving={saving}
                    onFocus={focus}
                    onShow={() => show(key)}
                    onAccept={() => accept(edit)}
                    onReject={() => reject(edit)}
                  />
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <p className="text-note text-ink-meta">
          You handled every suggestion. Edit anything else on the resume.
        </p>
      )}
    </section>
  );
}

const KIND_TITLES: Record<TailorEdit["kind"], string> = {
  reword: "New Wording",
  order: "New Order",
  skill: "Added Skill",
};

function Card({
  edit,
  bank,
  choices,
  cardKey,
  lit,
  saving,
  onFocus,
  onShow,
  onAccept,
  onReject,
}: {
  edit: TailorEdit;
  bank: Bank;
  choices: Choices;
  cardKey: string;
  lit: boolean;
  saving: boolean;
  onFocus: (key: string | null) => void;
  onShow: () => void;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div
      data-card={cardKey}
      onMouseEnter={() => onFocus(cardKey)}
      onMouseLeave={() => onFocus(null)}
      onFocus={() => onFocus(cardKey)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onFocus(null);
      }}
      className={cn(
        // Clear of the panel's pinned top when scrolled to
        "bg-panel ring-border-subtle scroll-mt-44 rounded-xl ring-1 transition-shadow",
        lit && "ring-brand ring-2",
      )}
    >
      {/* The card's body shows its lines on the page; the buttons act */}
      <button
        type="button"
        onClick={onShow}
        aria-label={`${KIND_TITLES[edit.kind]}: show on the resume`}
        className="focus-visible:outline-brand flex w-full flex-col gap-1.5 rounded-xl p-3 pb-2 text-left focus-visible:outline-2"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Badge variant="tag" tone={edit.kind === "order" ? "warning" : "positive"}>
            {KIND_TITLES[edit.kind]}
          </Badge>
          <span className="text-note text-ink-meta truncate">{where(edit, bank)}</span>
        </span>
        <span className="text-note text-ink block">
          <Change edit={edit} bank={bank} choices={choices} />
        </span>
      </button>
      <div className="flex justify-end gap-2 px-3 pb-3">
        <Button variant="secondary" size="sm" disabled={saving} onClick={onReject}>
          <XIcon aria-hidden /> Reject
        </Button>
        <Button variant="secondary" size="sm" disabled={saving} onClick={onAccept}>
          <CheckIcon aria-hidden /> Accept
        </Button>
      </div>
    </div>
  );
}

/** The entry a change sits in, or a skill's group. */
function where(edit: TailorEdit, bank: Bank) {
  if (edit.kind === "skill") return edit.group ?? "Skills";
  if (edit.kind === "order") return edit.label ?? "";
  return bank.entries.find((e) => e.bullets.some((b) => b.id === edit.bullet_id))?.title ?? "";
}

function Change({ edit, bank, choices }: { edit: TailorEdit; bank: Bank; choices: Choices }) {
  if (edit.kind === "skill") return <Added>{edit.label}</Added>;
  if (edit.kind === "order") {
    const bullets = bank.entries.find((e) => e.id === edit.entry_id)?.bullets ?? [];
    return (
      <span className="flex flex-col gap-1">
        {movesOf(edit, choices).map(({ bulletId, from, to }) => {
          const bullet = bullets.find((b) => b.id === bulletId);
          return (
            <span key={bulletId} className="block">
              <span className="text-ink-meta">
                {ordinal(from)} → {ordinal(to)}:{" "}
              </span>
              <span className="line-clamp-2">{bullet ? wording(choices, bullet) : ""}</span>
            </span>
          );
        })}
      </span>
    );
  }
  const after = edit.text ?? "";
  const before = edit.before;
  if (!before) return <Added>{after}</Added>;
  const diff = wordDiff(before, after);
  if (diff) {
    return (
      <>
        {diff.head} {diff.removed && <Removed>{diff.removed}</Removed>}{" "}
        {diff.added && <Added>{diff.added}</Added>} {diff.tail}
      </>
    );
  }
  return (
    <span className="flex flex-col gap-1.5">
      <Removed>{before}</Removed>
      <Added>{after}</Added>
    </span>
  );
}

function Removed({ children }: { children: ReactNode }) {
  return <del className="text-ink-meta decoration-danger/70 line-through">{children}</del>;
}

function Added({ children }: { children: ReactNode }) {
  return (
    <ins className="bg-positive/25 rounded-sm box-decoration-clone px-0.5 no-underline">
      {children}
    </ins>
  );
}

function ordinal(n: number) {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/**
 * A word diff where only a run in the middle changed: the shared words at
 * each end, and what was taken out and put in between. Null when less than
 * 40% of the words are shared, where a struck line over its new one reads
 * better than a patchwork.
 */
function wordDiff(before: string, after: string) {
  const a = before.trim().split(/\s+/);
  const b = after.trim().split(/\s+/);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  if (head + tail < Math.max(a.length, b.length) * 0.4) return null;
  return {
    head: a.slice(0, head).join(" "),
    removed: a.slice(head, a.length - tail).join(" "),
    added: b.slice(head, b.length - tail).join(" "),
    tail: a.slice(a.length - tail).join(" "),
  };
}
