"use client";

import {
  CaretDownIcon,
  CheckIcon,
  FileMagnifyingGlassIcon,
  XIcon,
} from "@phosphor-icons/react/ssr";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";

import { EllipsisIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { Bank } from "@/lib/bank-actions";
import type { Choices } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";
import type { TailorEdit, TailorSource } from "@/lib/tailor-actions";

import { Editor } from "../../../resumes/[resumeId]/editor";
import { wording } from "../../../resumes/[resumeId]/model";
import {
  editKey,
  GROUPS,
  movesOf,
  useTailorReview,
  type SuggestionsApi,
} from "../../../resumes/[resumeId]/tailor-review";
import { ResumePreviewDialog } from "./resume-preview";
import { ResumeTitle } from "./resume-title";
import { TailorScore } from "./tailor-score";

/**
 * Tailor's review step (docs/tailor_resume.md, "Suggestions"), kept quiet
 * after Quinncia's resume review: the tailored resume under its name and
 * the editor's slim toolbar (`compact`), and the Suggestions panel, which
 * the toolbar shows and hides. Each changed line has a small dot in the
 * page's margin and is highlighted only while its suggestion is pointed
 * at, focused or open. The panel has a section per kind (Reworded
 * Bullets, Reordered Bullets, Added Skills), each counting its suggestions, and each suggestion is a row that
 * opens to its before and after with Accept, which keeps the saved change,
 * and Reject, which undoes it. The editor owns the state and lays the
 * panel out (`suggestions`); this file draws it.
 *
 * The record lives in this tab's sessionStorage, so a new tab or device has
 * no suggestions: the editor shows alone, with a line that says why.
 */
export function TailorReview({
  name,
  ...editor
}: ComponentProps<typeof Editor> & {
  /** The tailored resume's name, in the page column's label. */
  name: string;
}) {
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
    <>
      {noRecord}
      <Editor
        {...editor}
        compact
        heading={<ResumeTitle resumeId={editor.resumeId} name={name} />}
        phoneBar={noRecord}
        suggestions={(api) => <SuggestionsPanel {...api} />}
      />
    </>
  );
}

/** The resume Tailor started from, read-only in step 1's Preview dialog:
 *  the panel's way to the original, in place of the side-by-side Before
 *  column the user found too much at once. The record keeps the source's
 *  id, not its name, so the dialog is titled for what it is. */
function ViewOriginal({ source }: { source: TailorSource }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* A white button on the panel's tint, with its glyph: as a bare
          brand link it read as stray text beside the heading */}
      <Button variant="secondary" size="xs" onClick={() => setOpen(true)}>
        <FileMagnifyingGlassIcon aria-hidden /> View Original
      </Button>
      <ResumePreviewDialog
        open={open}
        onOpenChange={setOpen}
        label="Original Resume"
        source={source}
      />
    </>
  );
}

/** The number of suggestions left, as a filled brand pill. */
function Count({ n }: { n: number }) {
  return (
    <span className="bg-brand text-on-brand text-note flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-semibold tabular-nums">
      {n}
    </span>
  );
}

/** A group opens by default only when it is this small. */
const OPEN_UP_TO = 3;

/** A group's swatch, in the dark shade of its lines' highlight and margin
 *  dots (../../../resumes/[resumeId]/pdf-pages.tsx), so a section and its
 *  lines on the page read as one. */
const SWATCH: Record<TailorEdit["kind"], string> = {
  reword: "bg-positive-ink",
  order: "bg-warning-strong",
  skill: "bg-positive-ink",
};

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
  open,
}: SuggestionsApi) {
  const { edits, match } = record;
  const list = useRef<HTMLDivElement>(null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () =>
      new Set(
        GROUPS.filter((g) => edits.filter((e) => e.kind === g.kind).length <= OPEN_UP_TO).map(
          (g) => g.kind,
        ),
      ),
  );
  // A card opened from the page (its line or dot) opens its group too
  const [seen, setSeen] = useState(active);
  if (active !== seen) {
    setSeen(active);
    const kind = edits.find((e) => editKey(e) === active)?.kind;
    if (kind && !openGroups.has(kind)) setOpenGroups(new Set([...openGroups, kind]));
  }
  // The open card comes into view
  useEffect(() => {
    if (!active) return;
    list.current
      ?.querySelector(`[data-card="${CSS.escape(active)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, openGroups]);

  const toggle = (kind: string) => {
    const next = new Set(openGroups);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    setOpenGroups(next);
  };

  return (
    // In the brand tint with its ring, as the editor's bar above the page,
    // so the two read as one review and the white sections stand out; bare
    // in the phone's sheet, which is its own panel. The toolbar's
    // Suggestions shows and hides it.
    <section
      aria-labelledby="suggestions-heading"
      className="sm:bg-brand-tint sm:ring-brand-pale flex flex-col gap-2 sm:rounded-2xl sm:p-3 sm:ring-1"
    >
      {/* The top stays in view while the sections scroll under it */}
      <div className="bg-panel sm:bg-brand-tint sticky top-0 z-10 flex flex-col gap-2 pb-2 sm:-mx-3 sm:-mt-3 sm:rounded-t-2xl sm:px-3 sm:pt-3">
        <div className="flex min-h-8 items-center gap-1">
          <h2
            id="suggestions-heading"
            className="text-subtitle text-ink mr-auto flex items-center gap-2 font-semibold max-sm:sr-only"
          >
            Suggestions <Count n={edits.length} />
          </h2>
          {record.source && <ViewOriginal source={record.source} />}
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={saving || edits.length === 0}
              aria-label="More Actions"
              render={<Button variant="ghost" size="icon-sm" />}
            >
              <EllipsisIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={acceptAll}>Accept All</DropdownMenuItem>
              <DropdownMenuItem onClick={rejectAll}>Reject All</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {match && <TailorScore match={match} />}
      </div>
      {edits.length > 0 ? (
        <div ref={list} className="flex flex-col gap-2">
          {GROUPS.map((group) => {
            const inGroup = edits.filter((e) => e.kind === group.kind);
            if (inGroup.length === 0) return null;
            const isOpen = openGroups.has(group.kind);
            return (
              // One white section per kind: its heading counts what is in it,
              // and its suggestions are rows under a hairline, each opening
              // in place
              <section
                key={group.kind}
                aria-label={group.title}
                className="bg-panel max-sm:bg-app overflow-hidden rounded-xl"
              >
                <h3>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => toggle(group.kind)}
                    className="hover:bg-ink/[0.03] focus-visible:outline-brand flex w-full items-center gap-2 px-3 py-2.5 text-left -outline-offset-2 transition-colors focus-visible:outline-2"
                  >
                    <span
                      aria-hidden
                      className={cn("size-2.5 shrink-0 rounded-full", SWATCH[group.kind])}
                    />
                    <span className="text-label text-ink font-semibold">{group.title}</span>
                    <span className="bg-ink/5 text-ink-muted text-note flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-semibold tabular-nums">
                      {inGroup.length}
                    </span>
                    <Chevron open={isOpen} />
                  </button>
                </h3>
                {isOpen && (
                  <ul
                    role="list"
                    className="border-border-subtle divide-border-subtle divide-y border-t"
                  >
                    {inGroup.map((edit) => {
                      const key = editKey(edit);
                      return (
                        <li key={key}>
                          <Suggestion
                            edit={edit}
                            bank={bank}
                            choices={choices}
                            cardKey={key}
                            lit={focused === key}
                            isOpen={active === key}
                            saving={saving}
                            onFocus={focus}
                            onToggle={() => open(active === key ? null : key)}
                            onShow={() => show(key)}
                            onAccept={() => accept(edit)}
                            onReject={() => reject(edit)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <p className="text-note text-ink-meta">
          You handled every suggestion. Edit anything else on the resume.
        </p>
      )}
    </section>
  );
}

/** A suggestion's kind, for screen readers: the section says it on screen. */
const KIND_TITLES: Record<TailorEdit["kind"], string> = {
  reword: "New wording",
  order: "New order",
  skill: "Added skill",
};

/** The panel's one sign of something to open: a caret at the row's end,
 *  turned up while open. */
function Chevron({ open }: { open: boolean }) {
  return (
    <CaretDownIcon
      aria-hidden
      className={cn(
        "text-ink-meta ml-auto size-4 shrink-0 transition-transform duration-150",
        open && "rotate-180",
      )}
    />
  );
}

/**
 * One suggestion, a row in its section: its one line and a caret; open, it
 * shows where it is, the change, and ✕ Reject and ✓ Accept. Grey while
 * pointed at or focused; its lines on the page are highlighted then. Each was a
 * card of its own with a numbered dot until 2026-10-26: the numbers read as
 * an order to follow, and the cards did not say they open.
 */
function Suggestion({
  edit,
  bank,
  choices,
  cardKey,
  lit,
  isOpen,
  saving,
  onFocus,
  onToggle,
  onShow,
  onAccept,
  onReject,
}: {
  edit: TailorEdit;
  bank: Bank;
  choices: Choices;
  cardKey: string;
  lit: boolean;
  isOpen: boolean;
  saving: boolean;
  onFocus: (key: string | null) => void;
  onToggle: () => void;
  onShow: () => void;
  onAccept: () => void;
  onReject: () => void;
}) {
  const at = edit.kind === "order" ? null : where(edit, bank);
  return (
    <div
      data-card={cardKey}
      onMouseEnter={() => onFocus(cardKey)}
      onMouseLeave={() => onFocus(null)}
      onFocus={() => onFocus(cardKey)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onFocus(null);
      }}
      // Clear of the panel's pinned top when scrolled to
      // Grey while pointed at, never brand: an open row in purple read as
      // selected rather than open
      className={cn("scroll-mt-28 transition-colors", lit && !isOpen && "bg-ink/[0.03]")}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={onToggle}
        className="focus-visible:outline-brand flex w-full items-start gap-2 px-3 py-2.5 text-left -outline-offset-2 focus-visible:outline-2"
      >
        <span className="sr-only">{KIND_TITLES[edit.kind]}: </span>
        <span className={cn("text-note text-ink min-w-0 flex-1", !isOpen && "line-clamp-2")}>
          {summary(edit, choices)}
        </span>
        <span className="mt-0.5 flex">
          <Chevron open={isOpen} />
        </span>
      </button>
      {isOpen && (
        <div className="flex flex-col gap-2.5 px-3 pb-3">
          {at && <p className="text-note text-ink-meta truncate">In {at}</p>}
          <div className="text-note text-ink bg-panel ring-border-subtle rounded-lg p-2.5 ring-1">
            <Change edit={edit} bank={bank} choices={choices} />
          </div>
          <div className="flex items-center gap-1.5">
            {/* On a phone the sheet covers the page: this shows the line */}
            <Button variant="ghost" size="xs" className="mr-auto sm:hidden" onClick={onShow}>
              Show on Resume
            </Button>
            {/* Red undoes, green keeps: the pair reads at a glance */}
            <Button variant="decline" className="ml-auto" disabled={saving} onClick={onReject}>
              <XIcon aria-hidden /> Reject
            </Button>
            <Button variant="positive" disabled={saving} onClick={onAccept}>
              <CheckIcon aria-hidden /> Accept
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A closed row's line: the new wording, the entry and how many of its
 *  bullets moved, or the skill added. */
function summary(edit: TailorEdit, choices: Choices) {
  if (edit.kind === "reword") return edit.text ?? "";
  if (edit.kind === "order") {
    const n = movesOf(edit, choices).length;
    return `${edit.label ?? "An entry"}: ${n} ${n === 1 ? "bullet" : "bullets"} moved`;
  }
  return edit.label ?? "";
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
