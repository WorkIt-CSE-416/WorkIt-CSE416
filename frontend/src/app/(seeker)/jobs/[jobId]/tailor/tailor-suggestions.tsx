"use client";

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import {
  ArrowsDownUpIcon,
  CaretDownIcon,
  CheckIcon,
  MinusIcon,
  PencilSimpleIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react/ssr";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";

import { facetClasses } from "@/components/field-facet";
import { ChevronDownIcon, FilterIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { Bank } from "@/lib/bank-actions";
import type { Choices } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";

import { Editor } from "../../../resumes/[resumeId]/editor";
import { wording } from "../../../resumes/[resumeId]/model";
import { dismissDemo, useDemoChanges } from "../../../resumes/[resumeId]/demo-suggestions";
import {
  changesOf,
  movesOf,
  useTailorReview,
  type Change,
  type ChangeKind,
  type SuggestionsApi,
} from "../../../resumes/[resumeId]/tailor-review";
import { OriginalResume } from "./resume-preview";
import { ResumeTitle } from "./resume-title";

/**
 * Tailor's review step (docs/tailor_resume.md, "Suggestions"), kept quiet
 * after Quinncia's resume review: the tailored resume under its name and
 * the editor's slim toolbar (`compact`), and beside it the Suggestions
 * panel or, from the toolbar's View Original, the source resume
 * (`original`). Each changed line has a small dot in the page's margin and
 * is highlighted only while its suggestion is pointed at, focused or open.
 * The panel has a section per resume entry, top to bottom as on the page,
 * each counting its suggestions; each suggestion is a row with its type's
 * badge (added, reworded, removed, moved: a colour and a glyph) that opens
 * to its before and after with Accept, which keeps the saved change, and
 * Reject, which undoes it. A dropdown in the heading row filters by type. The editor owns the state and
 * lays the panel out (`suggestions`); this file draws it.
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
        original={record?.source && <OriginalResume source={record.source} />}
        phoneBar={noRecord}
        suggestions={(api) => <SuggestionsPanel {...api} />}
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

/**
 * Each change type's name, glyph and colours: the badge on its row and in
 * the type filter, in the colour its lines carry on the page
 * (../../../resumes/[resumeId]/pdf-pages.tsx): green added, blue reworded,
 * red removed, amber moved. A glyph as well as a colour, so the type reads
 * without telling colours apart.
 */
const KINDS: Record<ChangeKind, { label: string; Icon: PhosphorIcon; badge: string }> = {
  added: { label: "Added", Icon: PlusIcon, badge: "bg-positive-tint text-positive-ink" },
  reworded: { label: "Reworded", Icon: PencilSimpleIcon, badge: "bg-advanced-tint text-advanced" },
  removed: { label: "Removed", Icon: MinusIcon, badge: "bg-danger-tint text-danger" },
  moved: { label: "Moved", Icon: ArrowsDownUpIcon, badge: "bg-warning-tint text-warning" },
};

const KIND_ORDER: ChangeKind[] = ["added", "reworded", "removed", "moved"];

/** One section of the panel: a resume entry, or Skills, with its changes. */
type Group = { where: string; title: string; detail?: string; changes: Change[]; at: number };

/** The changes by the entry they sit in, top to bottom as on the page, and
 *  within an entry by line where the line is on the page. */
function groupsOf(changes: Change[], bank: Bank, pageOrder: (key: string) => number): Group[] {
  const lineAt = (change: Change) => {
    const edit = change.edit;
    if (edit?.kind === "reword") return pageOrder(`${edit.bullet_id}.bullet`);
    if (edit?.kind === "skill") return pageOrder(`${edit.skill_id}.skill`);
    return Number.POSITIVE_INFINITY;
  };
  const groups = new Map<string, Group>();
  for (const change of changes) {
    let group = groups.get(change.where);
    if (!group) {
      const entry = bank.entries.find((e) => e.id === change.where);
      group = entry
        ? {
            where: change.where,
            title: entry.title,
            detail: entry.organization ?? undefined,
            changes: [],
            at: pageOrder(`${entry.id}.title`),
          }
        : { where: change.where, title: "Skills", changes: [], at: Number.POSITIVE_INFINITY };
      groups.set(change.where, group);
    }
    group.changes.push(change);
  }
  for (const group of groups.values()) {
    group.changes.sort((a, b) => lineAt(a) - lineAt(b));
    if (group.where === "skills") group.at = Math.min(...group.changes.map(lineAt));
  }
  return [...groups.values()].sort((a, b) => a.at - b.at);
}

function SuggestionsPanel({
  record,
  pageOrder,
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
  const list = useRef<HTMLDivElement>(null);
  // TEMPORARY: sample changes of every type beside the run's own
  const demo = useDemoChanges(bank, (id) => pageOrder(`${id}.title`) !== Number.POSITIVE_INFINITY);
  const changes = [...changesOf(record.edits, bank), ...demo];
  const [only, setOnly] = useState<ChangeKind | null>(null);
  const shown = only ? changes.filter((c) => c.kind === only) : changes;
  const groups = groupsOf(shown, bank, pageOrder);
  const counts = new Map(KIND_ORDER.map((k) => [k, changes.filter((c) => c.kind === k).length]));
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  // A card opened from the page (its line or dot) opens its section, and
  // shows every type again if a filter hid it
  const [seen, setSeen] = useState(active);
  if (active !== seen) {
    setSeen(active);
    const change = changes.find((c) => c.key === active);
    if (change && closed.has(change.where)) {
      setClosed(new Set([...closed].filter((w) => w !== change.where)));
    }
    if (change && only && change.kind !== only) setOnly(null);
  }
  // The open card comes into view, by scrolling the list alone: its
  // scrollIntoView also scrolled the page, and Chrome then cancelled the
  // page's own smooth scroll to the card's lines (`focus` in PdfPages)
  useEffect(() => {
    const box = list.current;
    const card = box?.querySelector(`[data-card="${CSS.escape(active ?? "")}"]`);
    if (!active || !box || !card) return;
    const r = card.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const by =
      r.top < b.top
        ? r.top - b.top
        : r.bottom > b.bottom
          ? Math.min(r.bottom - b.bottom, r.top - b.top)
          : 0;
    if (by) box.scrollBy({ top: by, behavior: "smooth" });
  }, [active, closed]);

  const toggle = (where: string) => {
    const next = new Set(closed);
    if (next.has(where)) next.delete(where);
    else next.add(where);
    setClosed(next);
  };
  const demoKeys = demo.map((c) => c.key);

  return (
    // In the brand tint with its ring, as the editor's bar above the page,
    // so the two read as one review and the white sections stand out; bare
    // in the phone's sheet, which is its own panel. The toolbar's switch
    // shows and hides it.
    <section
      aria-labelledby="suggestions-heading"
      className="sm:bg-brand-tint sm:ring-brand-pale flex min-h-0 flex-col gap-2 sm:rounded-2xl sm:p-3 sm:ring-1"
    >
      {/* The top stays put and only the sections under it scroll, so the
          scroll bar starts under it and the panel keeps its rounded corners */}
      <div className="flex shrink-0 flex-col gap-2.5 pb-1">
        <div className="flex min-h-8 items-center gap-1">
          <h2
            id="suggestions-heading"
            className="text-subtitle text-ink mr-auto flex items-center gap-2 font-semibold max-sm:sr-only"
          >
            Suggestions <Count n={changes.length} />
          </h2>
          {changes.length > 0 && <TypeFilter only={only} counts={counts} onChange={setOnly} />}
        </div>
      </div>
      {changes.length > 0 ? (
        <div
          ref={list}
          className="-mr-1.5 flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain pr-1.5"
        >
          {groups.map((group) => {
            const isOpen = !closed.has(group.where);
            return (
              // One white section per resume entry, as the page lists them:
              // its heading names the entry and counts its changes, and each
              // change is a row under a hairline that opens in place
              <section
                key={group.where}
                aria-label={group.title}
                // shrink-0: in the scrolling list a clipped section would
                // otherwise squeeze to fit rather than scroll
                className="bg-panel max-sm:bg-app shrink-0 overflow-hidden rounded-xl"
              >
                <h3>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => toggle(group.where)}
                    className="hover:bg-ink/[0.03] focus-visible:outline-brand flex w-full items-center gap-2 px-3 py-2.5 text-left -outline-offset-2 transition-colors focus-visible:outline-2"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-label text-ink truncate font-semibold">
                        {group.title}
                      </span>
                      {group.detail && (
                        <span className="text-note text-ink-meta truncate">{group.detail}</span>
                      )}
                    </span>
                    <span className="bg-ink/5 text-ink-muted text-note flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 font-semibold tabular-nums">
                      {group.changes.length}
                    </span>
                    <Chevron open={isOpen} />
                  </button>
                </h3>
                {isOpen && (
                  <ul
                    role="list"
                    className="border-border-subtle divide-border-subtle divide-y border-t"
                  >
                    {group.changes.map((change) => (
                      <li key={change.key}>
                        <Suggestion
                          change={change}
                          bank={bank}
                          choices={choices}
                          lit={focused === change.key}
                          isOpen={active === change.key}
                          saving={saving}
                          onFocus={focus}
                          onToggle={() => open(active === change.key ? null : change.key)}
                          onShow={() => show(change.key)}
                          onAccept={() =>
                            change.edit ? accept(change.edit) : dismissDemo([change.key])
                          }
                          onReject={() =>
                            change.edit ? reject(change.edit) : dismissDemo([change.key])
                          }
                        />
                      </li>
                    ))}
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
      {/* Every change at once, in reach under the list rather than in a
          "…" menu at the top, where nobody found them. Red undoes, green
          keeps, as on each row */}
      {changes.length > 0 && (
        <div className="grid shrink-0 grid-cols-2 gap-2 pt-1">
          <Button
            variant="decline"
            disabled={saving}
            onClick={() => {
              dismissDemo(demoKeys);
              rejectAll();
            }}
          >
            <XIcon aria-hidden /> Reject All
          </Button>
          <Button
            variant="positive"
            disabled={saving}
            onClick={() => {
              dismissDemo(demoKeys);
              acceptAll();
            }}
          >
            <CheckIcon aria-hidden /> Accept All
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * The change types as a filter dropdown in the panel's heading row, drawn
 * as the Resumes page's Type filter is (`facetClasses`, brand-tinted while
 * it holds a pick). Its button names the type shown, with that type's
 * badge; its menu lists All Types and each type present, with its badge
 * and count. The types were a two-by-two legend of coloured pills under
 * the keyword match until 2026-10-26, which took four rows' height.
 */
function TypeFilter({
  only,
  counts,
  onChange,
}: {
  only: ChangeKind | null;
  counts: Map<ChangeKind, number>;
  onChange: (only: ChangeKind | null) => void;
}) {
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Show ${only ? KINDS[only].label : "All Types"}`}
        className={facetClasses(only !== null, "gap-1.5 px-2.5")}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {only ? (
            <KindBadge kind={only} small />
          ) : (
            <FilterIcon className="text-ink-meta size-4 shrink-0" />
          )}
          <span className="truncate">{only ? KINDS[only].label : "All Types"}</span>
        </span>
        <ChevronDownIcon className="text-muted-foreground size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuRadioGroup
          value={only ?? "all"}
          onValueChange={(next) => onChange(next === "all" ? null : (next as ChangeKind))}
        >
          <DropdownMenuRadioItem value="all" className="gap-2">
            <FilterIcon className="text-ink-meta size-4" />
            All Types
            <span className="text-ink-meta ml-auto tabular-nums">{total}</span>
          </DropdownMenuRadioItem>
          {KIND_ORDER.filter((k) => counts.get(k)).map((k) => (
            <DropdownMenuRadioItem key={k} value={k} className="gap-2">
              <KindBadge kind={k} small />
              {KINDS[k].label}
              <span className="text-ink-meta ml-auto tabular-nums">{counts.get(k)}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A section's sign that it folds: a caret at its heading's end, turned
 *  up while open. */
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

/** A suggestion's own toggle: a plus that turns to a minus while open. A
 *  caret here read as a second section heading under the section's own
 *  caret, so only sections fold with a caret. */
function PlusMinus({ open }: { open: boolean }) {
  const Glyph = open ? MinusIcon : PlusIcon;
  return <Glyph aria-hidden className="text-ink-meta ml-auto size-4 shrink-0" />;
}

/** A row's type, as a small round badge in its colour with its glyph. */
function KindBadge({ kind, small = false }: { kind: ChangeKind; small?: boolean }) {
  const { Icon, badge } = KINDS[kind];
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full",
        small ? "size-5" : "size-6",
        badge,
      )}
    >
      <Icon weight="bold" className={small ? "size-3" : "size-3.5"} />
    </span>
  );
}

/**
 * One suggestion, a row in its entry's section: its type's badge, its one
 * line and a plus (`PlusMinus`), and ✓ Accept and ✕ Reject while open or
 * pointed at; open, it shows the change.
 * Grey while pointed at or focused; its lines on the page are highlighted
 * then. Sections were by type (Reworded Bullets, Reordered Bullets, Added
 * Skills) until 2026-10-26: with every type in play, a student read the
 * panel against the page and jumped around it, so sections now follow the
 * page and the type is each row's badge.
 */
function Suggestion({
  change,
  bank,
  choices,
  lit,
  isOpen,
  saving,
  onFocus,
  onToggle,
  onShow,
  onAccept,
  onReject,
}: {
  change: Change;
  bank: Bank;
  choices: Choices;
  lit: boolean;
  isOpen: boolean;
  saving: boolean;
  onFocus: (key: string | null) => void;
  onToggle: () => void;
  onShow: () => void;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div
      data-card={change.key}
      onMouseEnter={() => onFocus(change.key)}
      onMouseLeave={() => onFocus(null)}
      onFocus={() => onFocus(change.key)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onFocus(null);
      }}
      // Grey while pointed at, never brand: an open row in purple read as
      // selected rather than open.
      className={cn("scroll-mt-2 transition-colors", lit && !isOpen && "bg-ink/[0.03]")}
    >
      <div className="flex items-start gap-1 pr-2">
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={onToggle}
          className="focus-visible:outline-brand flex min-w-0 flex-1 items-start gap-2.5 py-2.5 pl-3 text-left -outline-offset-2 focus-visible:outline-2"
        >
          <KindBadge kind={change.kind} />
          {/* Open, the row names the change and the box under it holds the
            words: the line in both read twice */}
          {isOpen ? (
            <span className="text-note text-ink mt-0.5 min-w-0 flex-1 font-semibold">
              {title(change)}
            </span>
          ) : (
            <>
              <span className="sr-only">{title(change)}: </span>
              <span className="text-note text-ink mt-0.5 line-clamp-2 min-w-0 flex-1">
                {summary(change, choices)}
              </span>
            </>
          )}
        </button>
        {/* Accept and Reject as a check and a cross at the row's end, as
          Google Docs answers a suggestion: shown while the row is open,
          pointed at or focused. They were full Accept and Reject buttons
          under the open change, which the user found heavy. Green keeps,
          red undoes */}
        {/* Hidden, not removed, so the row's text keeps its width as they
            come and go; hidden ones leave the tab order, and focus in the
            row shows them */}
        <span
          className={cn(
            "flex shrink-0 items-center gap-0.5 pt-1.5",
            !(isOpen || lit) && "invisible",
          )}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Accept: ${title(change)}`}
            title="Accept"
            disabled={saving}
            onClick={onAccept}
            className="text-positive-ink hover:bg-positive-tint"
          >
            <CheckIcon aria-hidden weight="bold" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Reject: ${title(change)}`}
            title="Reject"
            disabled={saving}
            onClick={onReject}
            className="text-danger hover:bg-danger-tint"
          >
            <XIcon aria-hidden weight="bold" />
          </Button>
        </span>
        {/* The fold sign last, at the row's far right, as a section's caret
            is; the row's own button above names the state for a screen
            reader, so this one is a pointer target only */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={onToggle}
          className="text-ink-meta hover:text-ink mt-1.5 flex size-7 shrink-0 items-center justify-center pt-0.5"
        >
          <PlusMinus open={isOpen} />
        </button>
      </div>
      {isOpen && (
        <div className="flex flex-col gap-2 px-3 pb-3 pl-[2.875rem]">
          <ChangeBody change={change} bank={bank} choices={choices} />
          {/* On a phone the sheet covers the page: this shows the line */}
          <Button variant="ghost" size="xs" className="self-start sm:hidden" onClick={onShow}>
            Show on Resume
          </Button>
        </div>
      )}
    </div>
  );
}

/** An open row's name for its change: "Reworded bullet", "Added skill". */
function title(change: Change) {
  if (change.kind === "moved") return "Bullets moved";
  return `${KINDS[change.kind].label} ${change.where === "skills" ? "skill" : "bullet"}`;
}

/** A closed row's line: the new or reworded line, the line removed, how
 *  many bullets moved, or a skill and its group. */
function summary(change: Change, choices: Choices) {
  if (change.kind === "moved" && change.edit) {
    const n = movesOf(change.edit, choices).length;
    return `${n} ${n === 1 ? "bullet" : "bullets"} moved`;
  }
  const line = change.kind === "removed" ? change.before : change.after;
  return change.group ? `${line} (${change.group})` : (line ?? "");
}

/**
 * The open change as a white card with an outline, one row for each thing
 * that changed, under a hairline: each moved bullet with its place before
 * and after as an amber tag; a rewording's old and new lines, or one line
 * with the changed words marked; an added or removed line. It was one grey
 * box of all of it, which read as a chat message and ran three moves
 * together as one.
 */
function ChangeBody({ change, bank, choices }: { change: Change; bank: Bank; choices: Choices }) {
  // An added or removed line in plain type: its badge and its row's name
  // already say which, and a highlight or a strike over the whole line
  // only made it harder to read. A rewording keeps its marks, which show
  // the words that changed
  if (change.kind === "added") return <ChangeCard rows={[{ key: "line", body: change.after }]} />;
  if (change.kind === "removed")
    return <ChangeCard rows={[{ key: "line", body: change.before }]} />;
  if (change.kind === "moved" && change.edit) {
    const entryId = change.edit.entry_id;
    const bullets = bank.entries.find((e) => e.id === entryId)?.bullets ?? [];
    return (
      <ChangeCard
        rows={movesOf(change.edit, choices).map(({ bulletId, from, to }) => {
          const bullet = bullets.find((b) => b.id === bulletId);
          return {
            key: bulletId,
            tag: (
              <span className="bg-warning-tint text-warning rounded-md px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap tabular-nums">
                <span className="sr-only">
                  From {ordinal(from)} to {ordinal(to)}:{" "}
                </span>
                <span aria-hidden>
                  {from} → {to}
                </span>
              </span>
            ),
            body: <span className="line-clamp-2">{bullet ? wording(choices, bullet) : ""}</span>,
          };
        })}
      />
    );
  }
  const after = change.after ?? "";
  const before = change.before;
  if (!before) return <ChangeCard rows={[{ key: "line", body: after }]} />;
  const diff = wordDiff(before, after);
  if (diff) {
    return (
      <ChangeCard
        rows={[
          {
            key: "line",
            body: (
              <>
                {diff.head} {diff.removed && <Removed>{diff.removed}</Removed>}{" "}
                {diff.added && <Added>{diff.added}</Added>} {diff.tail}
              </>
            ),
          },
        ]}
      />
    );
  }
  return (
    <ChangeCard
      rows={[
        { key: "before", tag: <RowLabel>Before</RowLabel>, body: <Removed>{before}</Removed> },
        { key: "after", tag: <RowLabel>After</RowLabel>, body: <Added>{after}</Added> },
      ]}
    />
  );
}

function ChangeCard({ rows }: { rows: { key: string; tag?: ReactNode; body: ReactNode }[] }) {
  return (
    <ul
      role="list"
      className="bg-panel border-border-subtle divide-border-subtle text-note text-ink divide-y rounded-lg border"
    >
      {rows.map(({ key, tag, body }) => (
        <li key={key} className="flex items-start gap-2.5 px-2.5 py-2">
          {tag && <span className="mt-px flex shrink-0">{tag}</span>}
          <span className="min-w-0 flex-1">{body}</span>
        </li>
      ))}
    </ul>
  );
}

function RowLabel({ children }: { children: ReactNode }) {
  return <span className="text-ink-meta w-11 text-xs font-semibold">{children}</span>;
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
