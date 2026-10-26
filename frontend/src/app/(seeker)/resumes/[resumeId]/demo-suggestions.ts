"use client";

import { useSyncExternalStore } from "react";

import type { Bank } from "@/lib/bank-actions";

import type { Change } from "./tailor-review";

/**
 * TEMPORARY (2026-10-26): sample suggestions, so the Suggestions panel's
 * design can be judged with every change type. A Tailor run makes no added
 * bullet and no removed line yet, only rewordings, moves and added skills.
 * They are built from the resume's own entries, shown only beside a run's
 * real changes, and Accept or Reject only drops them. Remove this file and
 * its two uses (editor.tsx's count, tailor-suggestions.tsx's list) before
 * the branch opens a PR.
 */

let dismissed = new Set<string>();
let version = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Drops sample changes, as Accept and Reject do to a real one. */
export function dismissDemo(keys: string[]) {
  dismissed = new Set([...dismissed, ...keys]);
  version++;
  for (const listener of listeners) listener();
}

/** The sample changes still shown, for the entries on the page. */
export function useDemoChanges(bank: Bank, onPage: (entryId: string) => boolean): Change[] {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
  return samples(bank, onPage).filter((change) => !dismissed.has(change.key));
}

function samples(bank: Bank, onPage: (entryId: string) => boolean): Change[] {
  const work = bank.entries.filter(
    (e) => (e.section === "experience" || e.section === "projects") && onPage(e.id),
  );
  if (work.length < 2) return [];
  const at = (i: number) => work[i % work.length];
  const last = (i: number) => at(i).bullets[at(i).bullets.length - 1]?.text ?? "";
  const first = at(3).bullets[0]?.text ?? "";
  return [
    {
      key: "demo.added.1",
      kind: "added",
      where: at(1).id,
      after:
        "Built a Python and SQL reporting pipeline that cut the weekly status report from six hours to forty minutes.",
    },
    { key: "demo.removed.1", kind: "removed", where: at(2).id, before: last(2) },
    {
      key: "demo.added.2",
      kind: "added",
      where: at(2).id,
      after:
        "Shipped a Docker preview environment so editors could check every change before it went live.",
    },
    {
      key: "demo.reworded.1",
      kind: "reworded",
      where: at(3).id,
      before: first,
      after: `${first.replace(/\.$/, "")}, cutting onboarding time by 30%.`,
    },
    { key: "demo.removed.2", kind: "removed", where: at(4).id, before: last(4) },
    { key: "demo.removed.3", kind: "removed", where: "skills", before: "Figma", group: "Tools" },
  ];
}
