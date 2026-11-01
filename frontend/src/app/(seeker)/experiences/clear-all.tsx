"use client";

import { useState } from "react";

import type { BankResume } from "@/lib/bank-actions";

import { DeleteConfirm } from "../resumes/delete-confirm";
import { builtShowing, uploadsOwning, type Pick } from "./holdings";

/**
 * Clear All's confirm (KAN-352): deletes every entry or skill a section
 * shows, in one call, after the student says yes. It deletes from the bank,
 * as Delete Entry does: the items come off every built resume that shows
 * them, and under a built resume's pick they leave the uploads that own
 * them too (ADR 0005), which the line names. The counts read the bank's
 * `resume_ids` (`holdings.ts`), so the confirm needs no call of its own,
 * unlike Delete Entry's.
 */
export function ClearAll({
  items,
  resumes,
  noun,
  bullets = false,
  pick,
  remove,
  onCleared,
  onKeep,
}: {
  items: { id: string; resume_ids: string[] }[];
  resumes: BankResume[];
  /** One and many: ["Projects entry", "Projects entries"]. */
  noun: [string, string];
  /** Entries carry bullets, which go with them. */
  bullets?: boolean;
  pick: Pick;
  remove: (ids: string[]) => Promise<{ error: string | null }>;
  onCleared: () => void;
  onKeep: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const one = items.length === 1;
  const showing = builtShowing(items, resumes);
  const owners = uploadsOwning(pick, items, resumes);
  const them = one ? "it" : "them";

  async function clear() {
    setBusy(true);
    setError(null);
    const { error } = await remove(items.map((i) => i.id));
    setBusy(false);
    if (error) return setError(error);
    onCleared();
  }

  return (
    <>
      <DeleteConfirm label="Clear All" busy={busy} onDelete={clear} onKeep={onKeep}>
        Delete {one ? "this" : items.length === 2 ? "both" : `all ${items.length}`}{" "}
        {noun[one ? 0 : 1]}
        {bullets && (one ? " and its bullets" : " and their bullets")}?{" "}
        {owners && `${one ? "It is" : "They are"} deleted from ${owners} too. `}
        {showing === 0
          ? `No built resume shows ${them}.`
          : `${one ? "It comes" : "They come"} off ${showing === 1 ? "the 1 built resume that shows" : `all ${showing} built resumes that show`} ${them}.`}
      </DeleteConfirm>
      {error && (
        <p role="alert" className="text-note text-danger mt-1">
          {error}
        </p>
      )}
    </>
  );
}
