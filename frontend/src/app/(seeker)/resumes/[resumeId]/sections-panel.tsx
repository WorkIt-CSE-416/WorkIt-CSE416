"use client";

import { CaretDownIcon, DotsSixVerticalIcon } from "@phosphor-icons/react/ssr";
import { useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";

import type { Bank } from "@/lib/bank-actions";
import type { Choices, ChoicesUpdate } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";

import { moveItem, printedSections, type PrintedEntry } from "./model";

/**
 * The resume's order as an outline (KAN-435), as Jobright keeps it: sections
 * that fold to their entries, and entries to their bullets, each dragged by
 * its handle. It replaced the toolbar's up and down buttons, which moved one
 * line one step and could not move a section at all. A phone keeps those
 * buttons, since a drag there fights the scroll.
 *
 * Only the handle is `draggable`, so a press on a row still folds it, and a
 * handle is a button: its arrow keys move the row, for a student with no
 * mouse. A section's order is a page setting, and an entry's or bullet's a
 * choice, so each saves and renders as any edit does, and Undo takes it back.
 * It orders what prints: what shows is the Experiences picker's.
 */

/** One list's rows, in order: a drop line while one is dragged over it.
 *  Each list keeps its own drag, so a bullet dropped on a section does
 *  nothing. */
function SortableList<T>({
  items,
  idOf,
  labelOf,
  onMove,
  row,
  className,
}: {
  items: T[];
  idOf: (item: T) => string;
  labelOf: (item: T) => string;
  onMove: (from: number, to: number) => void;
  /** A row, given its handle. */
  row: (item: T, handle: ReactNode) => ReactNode;
  className?: string;
}) {
  const [dragged, setDragged] = useState<number | null>(null);
  // Where the row would land: before the row at this index
  const [gap, setGap] = useState<number | null>(null);

  const over = (event: DragEvent<HTMLLIElement>, at: number) => {
    if (dragged === null) return;
    event.preventDefault();
    event.stopPropagation();
    const box = event.currentTarget.getBoundingClientRect();
    setGap(event.clientY < box.top + box.height / 2 ? at : at + 1);
  };
  const drop = (event: DragEvent) => {
    if (dragged === null || gap === null) return;
    event.preventDefault();
    event.stopPropagation();
    // Taking the row out moves every later row up one
    const to = gap > dragged ? gap - 1 : gap;
    if (to !== dragged) onMove(dragged, to);
    setDragged(null);
    setGap(null);
  };
  const keys = (event: KeyboardEvent, at: number) => {
    const to = event.key === "ArrowUp" ? at - 1 : event.key === "ArrowDown" ? at + 1 : null;
    if (to === null) return;
    event.preventDefault();
    if (to >= 0 && to < items.length) onMove(at, to);
  };

  return (
    <ul role="list" className={cn("flex flex-col", className)} onDrop={drop}>
      {items.map((item, at) => (
        <li
          key={idOf(item)}
          onDragOver={(event) => over(event, at)}
          onDrop={drop}
          className={cn(
            "relative",
            dragged === at && "opacity-50",
            gap === at &&
              "before:bg-brand before:absolute before:inset-x-0 before:-top-px before:h-0.5",
            gap === at + 1 &&
              at === items.length - 1 &&
              "after:bg-brand after:absolute after:inset-x-0 after:-bottom-px after:h-0.5",
          )}
        >
          {row(
            item,
            <button
              type="button"
              draggable
              aria-label={`Move ${labelOf(item)}`}
              title="Drag to move, or use the arrow keys"
              className="text-ink-meta hover:text-ink focus-visible:ring-brand-ring flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded-xs focus-visible:ring-2 focus-visible:outline-none active:cursor-grabbing"
              onDragStart={(event) => {
                event.stopPropagation();
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", labelOf(item));
                const shown = event.currentTarget.closest("li");
                if (shown) event.dataTransfer.setDragImage(shown, 12, 12);
                setDragged(at);
              }}
              onDragEnd={() => {
                setDragged(null);
                setGap(null);
              }}
              onKeyDown={(event) => keys(event, at)}
            >
              <DotsSixVerticalIcon aria-hidden weight="bold" className="size-4" />
            </button>,
          )}
        </li>
      ))}
    </ul>
  );
}

function Fold({ open, label, onToggle }: { open: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? "Close" : "Open"} ${label}`}
      className="text-ink-meta hover:bg-ink/5 hover:text-ink focus-visible:ring-brand-ring flex size-7 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
      onClick={onToggle}
    >
      <CaretDownIcon
        aria-hidden
        className={cn("size-4 transition-transform duration-150", open && "rotate-180")}
      />
    </button>
  );
}

export function SectionsOutline({
  bank,
  choices,
  order,
  onOrder,
  onApply,
}: {
  bank: Bank;
  choices: Choices;
  /** The sections in print order: a page setting. */
  order: string[];
  onOrder: (order: string[]) => void;
  onApply: (changes: ChoicesUpdate) => void;
}) {
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => {
    const next = new Set(opened);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpened(next);
  };
  const sections = printedSections(bank, choices, order);

  const entryRow = (entry: PrintedEntry, handle: ReactNode) => {
    const open = opened.has(entry.id);
    return (
      <div>
        <div className="flex items-start gap-1 py-1">
          {handle}
          <button
            type="button"
            className="focus-visible:outline-brand mt-0.5 min-w-0 flex-1 text-left focus-visible:outline-2"
            onClick={() => toggle(entry.id)}
          >
            <span className="text-note text-ink block truncate font-semibold">{entry.title}</span>
            {entry.detail && (
              <span className="text-note text-ink-meta block truncate">{entry.detail}</span>
            )}
          </button>
          {entry.bullets.length > 1 && (
            <Fold open={open} label={entry.title} onToggle={() => toggle(entry.id)} />
          )}
        </div>
        {open && (
          <SortableList
            items={entry.bullets}
            idOf={(bullet) => bullet.id}
            labelOf={(bullet) => bullet.text.slice(0, 40)}
            className="gap-0.5 pb-1 pl-6"
            onMove={(from, to) =>
              onApply({
                bullets: moveItem(entry.bullets, from, to).map(({ id }, position) => ({
                  bullet_id: id,
                  position,
                })),
              })
            }
            row={(bullet, handle) => (
              <div className="flex items-start gap-1">
                {handle}
                <span className="text-note text-ink-muted mt-1 line-clamp-2 min-w-0 flex-1">
                  {bullet.text}
                </span>
              </div>
            )}
          />
        )}
      </div>
    );
  };

  return (
    <SortableList
      items={sections}
      idOf={(section) => section.id}
      labelOf={(section) => section.label}
      className="gap-2"
      onMove={(from, to) => {
        // Only the sections that print are here; the rest keep their places
        // after them, so a section the student adds later lands in its usual spot
        const moved = moveItem(sections, from, to).map((section) => section.id);
        onOrder([...moved, ...order.filter((id) => !moved.includes(id))]);
      }}
      row={(section, handle) => {
        const open = opened.has(section.id);
        return (
          <section className="bg-panel max-sm:bg-app rounded-xl px-2 py-1.5">
            <div className="flex items-center gap-1">
              {handle}
              <button
                type="button"
                className="text-label text-ink focus-visible:outline-brand min-w-0 flex-1 truncate py-0.5 text-left font-semibold focus-visible:outline-2"
                onClick={() => toggle(section.id)}
              >
                {section.label}
              </button>
              {section.entries.length > 0 && (
                <Fold open={open} label={section.label} onToggle={() => toggle(section.id)} />
              )}
            </div>
            {open && section.entries.length > 0 && (
              <SortableList
                items={section.entries}
                idOf={(entry) => entry.id}
                labelOf={(entry) => entry.title}
                className="border-border-subtle mt-1 gap-0.5 border-t pt-1"
                onMove={(from, to) =>
                  onApply({
                    entries: moveItem(section.entries, from, to).map(({ id }, position) => ({
                      entry_id: id,
                      position,
                    })),
                  })
                }
                row={entryRow}
              />
            )}
          </section>
        );
      }}
    />
  );
}
