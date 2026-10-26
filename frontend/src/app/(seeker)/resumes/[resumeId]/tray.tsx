"use client";

import { PlusIcon } from "@phosphor-icons/react/ssr";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Button } from "@/components/ui/button";
import type { Bank } from "@/lib/bank-actions";
import type { Choices, ChoicesUpdate } from "@/lib/built-resume-actions";

import { putBack, tray, type TrayItem } from "./model";

/**
 * "Not on This Resume" (KAN-218, user story 65): bank entries this resume
 * does not show (hidden, or added to the bank after Generate), hidden
 * bullets and hidden skills. One click puts an item back; an entry comes
 * back at the end of its section with its bullets.
 */
export function Tray({
  bank,
  choices,
  onPutBack,
}: {
  bank: Bank;
  choices: Choices;
  onPutBack: (changes: ChoicesUpdate) => void;
}) {
  const items = tray(bank, choices);
  if (items.length === 0) return null;
  return (
    <section className="bg-brand-tint/40 ring-border-subtle rounded-2xl p-4 ring-1">
      <h2 className="text-label text-ink mb-2 font-semibold">Not on This Resume</h2>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={`${item.kind}.${id(item)}`} className="max-w-full">
            <Button
              variant="secondary"
              size="sm"
              className="max-w-full"
              onClick={() => onPutBack(putBack(item))}
            >
              <PlusIcon aria-hidden />
              <span className="truncate">{label(item)}</span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The modal's groups, in the resume's own order of parts. */
const KINDS: { kind: TrayItem["kind"]; title: string }[] = [
  { kind: "entry", title: "Entries" },
  { kind: "bullet", title: "Bullets" },
  { kind: "skill", title: "Skills" },
];

/**
 * "Not on This Resume" as a modal, opened from Tailor's toolbar: under the
 * page it sat below a two-page resume, where nobody scrolled to it. The
 * same items, in groups (Entries, Bullets, Skills), each a full-width row
 * that puts it back; the modal stays open, so several come back in a row,
 * and says so once nothing is left.
 */
export function TrayDialog({
  open,
  onOpenChange,
  bank,
  choices,
  saving,
  onPutBack,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bank: Bank;
  choices: Choices;
  saving: boolean;
  onPutBack: (changes: ChoicesUpdate) => void;
}) {
  const items = tray(bank, choices);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-subtitle font-semibold">Not on This Resume</DialogTitle>
          <DialogDescription>
            Lines from your experiences that this resume does not show. Add one to put it back.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {items.length === 0 ? (
            <p className="text-body text-ink-meta">Everything is on this resume.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {KINDS.map(({ kind, title }) => {
                const group = items.filter((item) => item.kind === kind);
                if (group.length === 0) return null;
                return (
                  <section key={kind} aria-label={title} className="flex flex-col gap-1.5">
                    <h3 className="text-note text-ink-meta font-semibold">
                      {title} <span className="tabular-nums">{group.length}</span>
                    </h3>
                    <ul className="divide-border-subtle ring-border-subtle flex flex-col divide-y rounded-xl ring-1">
                      {group.map((item) => (
                        <li
                          key={`${item.kind}.${id(item)}`}
                          className="flex items-center gap-3 px-3 py-2"
                        >
                          <span className="text-note text-ink line-clamp-2 min-w-0 flex-1">
                            {rowLabel(item)}
                          </span>
                          <Button
                            variant="secondary"
                            size="xs"
                            disabled={saving}
                            aria-label={`Add ${label(item)}`}
                            onClick={() => onPutBack(putBack(item))}
                          >
                            <PlusIcon aria-hidden /> Add
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A modal row's words: an entry or a skill by name, a bullet by its text
 *  with its entry after it. */
function rowLabel(item: TrayItem) {
  if (item.kind === "entry") return item.entry.title;
  if (item.kind === "skill") return item.skill.name;
  return (
    <>
      {item.text} <span className="text-ink-meta">· {item.entry.title}</span>
    </>
  );
}

function id(item: TrayItem) {
  return item.kind === "entry"
    ? item.entry.id
    : item.kind === "bullet"
      ? item.bullet.id
      : item.skill.id;
}

function label(item: TrayItem) {
  if (item.kind === "entry") return item.entry.title;
  if (item.kind === "skill") return `Skill: ${item.skill.name}`;
  return `${item.entry.title}: ${item.text}`;
}
