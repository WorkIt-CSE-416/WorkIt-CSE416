"use client";

import { useCallback, useEffect, useState } from "react";

import type { ChoicesUpdate } from "@/lib/built-resume-actions";
import { readSessionDraft, tailorEditsKey, writeSessionDraft } from "@/lib/local-drafts";
import type { TailorEdit } from "@/lib/tailor-actions";

/**
 * Tailor's review in the editor (docs/tailor_resume.md, "Marking and
 * reverting changes"). A Tailor run saves the tailored resume itself and
 * hands the editor what it changed, each with what it replaced, through
 * sessionStorage (the Tailor screen writes it, `tailorEditsKey`). The editor
 * tints each changed line (`marksOf`) and shows its Revert control on hover
 * or focus. Revert goes through the editor's choices PATCH (`revertOf`). A
 * revert, or the student's own edit of a changed item (`untouched`), drops
 * that change. The API keeps no record, so a new tab or device has no marks.
 */

/** What the Tailor screen stores: the run's changes. */
export type TailorReviewRecord = { edits: TailorEdit[] };

/** A line's mark: `changed` (a new wording or an added skill, green) or
 *  `moved` (an entry's bullets put in a new order, amber). */
export type Mark = "changed" | "moved";

/** The run's record for `resumeId`, read after mount (the server render has
 *  no sessionStorage), and a setter that keeps storage in step. */
export function useTailorReview(resumeId: string) {
  const [record, setRecord] = useState<TailorReviewRecord | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a one-time restore from storage
    setRecord(readable(readSessionDraft<unknown>(tailorEditsKey(resumeId))));
  }, [resumeId]);
  const update = useCallback(
    (next: TailorReviewRecord | null) => {
      const kept = next && next.edits.length > 0 ? next : null;
      setRecord(kept);
      writeSessionDraft(tailorEditsKey(resumeId), kept);
    },
    [resumeId],
  );
  return [record, update] as const;
}

/** A stored record, or null for one this editor cannot read: a bare list
 *  of edits (the first shape, before the dropped count), or anything else
 *  in storage, never breaks the editor. */
function readable(stored: unknown): TailorReviewRecord | null {
  if (Array.isArray(stored)) return stored.length ? { edits: stored } : null;
  if (stored && typeof stored === "object" && Array.isArray((stored as TailorReviewRecord).edits)) {
    const record = stored as TailorReviewRecord;
    return record.edits.length ? { edits: record.edits } : null;
  }
  return null;
}

/** Each marked line's box key (`pdf-pages.tsx`'s `boxKey`) and its mark. A
 *  new wording wins over a new order on the same bullet. */
export function marksOf(edits: TailorEdit[]): Map<string, Mark> {
  const marks = new Map<string, Mark>();
  for (const edit of edits) {
    if (edit.kind === "order") {
      for (const id of edit.bullet_ids) {
        if (!marks.has(`${id}.bullet`)) marks.set(`${id}.bullet`, "moved");
      }
    }
  }
  for (const edit of edits) {
    if (edit.kind === "reword" && edit.bullet_id) marks.set(`${edit.bullet_id}.bullet`, "changed");
    if (edit.kind === "skill" && edit.skill_id) marks.set(`${edit.skill_id}.skill`, "changed");
  }
  return marks;
}

/** Each marked line's Tailor change, so its editor target can offer Revert. */
export function revertsOf(edits: TailorEdit[]): Map<string, TailorEdit> {
  const reverts = new Map<string, TailorEdit>();
  for (const edit of edits) {
    if (edit.kind === "order") {
      for (const id of edit.bullet_ids) reverts.set(`${id}.bullet`, edit);
    }
  }
  for (const edit of edits) {
    if (edit.kind === "reword" && edit.bullet_id) reverts.set(`${edit.bullet_id}.bullet`, edit);
    if (edit.kind === "skill" && edit.skill_id) reverts.set(`${edit.skill_id}.skill`, edit);
  }
  return reverts;
}

/** The choices PATCH that undoes one change. */
export function revertOf(edit: TailorEdit): ChoicesUpdate {
  if (edit.kind === "reword" && edit.bullet_id) {
    // The source showed the bank's own wording (no variant), or a variant:
    // its text again, as this resume's own wording, since a variant local
    // to the source resume cannot be picked on another resume.
    return {
      bullets: [
        edit.before_variant_id == null
          ? { bullet_id: edit.bullet_id, variant_id: null }
          : { bullet_id: edit.bullet_id, text: edit.before ?? "" },
      ],
    };
  }
  if (edit.kind === "order") {
    return { bullets: edit.before_ids.map((bullet_id, position) => ({ bullet_id, position })) };
  }
  if (edit.kind === "skill" && edit.skill_id) {
    return { skills: [{ skill_id: edit.skill_id, shown: false }] };
  }
  return {};
}

/** The changes the student's own `update` leaves alone: one that rewords,
 *  moves or hides an item a change made drops that change, since its mark
 *  and its revert no longer describe the line. */
export function untouched(edits: TailorEdit[], update: ChoicesUpdate): TailorEdit[] {
  const worded = new Set(
    (update.bullets ?? [])
      .filter((b) => "text" in b || "variant_id" in b || b.shown === false)
      .map((b) => b.bullet_id),
  );
  const moved = new Set(
    (update.bullets ?? []).filter((b) => b.position != null).map((b) => b.bullet_id),
  );
  const skills = new Set((update.skills ?? []).map((s) => s.skill_id));
  return edits.filter((edit) => {
    if (edit.kind === "reword") return !worded.has(edit.bullet_id ?? "");
    if (edit.kind === "order") return !edit.bullet_ids.some((id) => moved.has(id));
    return !skills.has(edit.skill_id ?? "");
  });
}
