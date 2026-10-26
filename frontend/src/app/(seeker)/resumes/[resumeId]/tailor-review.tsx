"use client";

import { useCallback, useEffect, useState } from "react";

import type { Choices, ChoicesUpdate } from "@/lib/built-resume-actions";
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

/** One change's inline Revert action. Order changes name the one bullet the
 * student chose to put back, while wording and skills revert themselves. */
export type RevertTarget = { edit: TailorEdit; bulletId?: string };

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

/** An order change as it stands on `choices`: its entry's shown bullets in
 *  their current order and in their before order, and the ones out of
 *  place. A bullet is out of place whenever it sits at another place than
 *  before, even when a sibling's move pushed it there. */
function placing(edit: TailorEdit, choices: Choices) {
  const at = new Map(choices.bullets.map((choice) => [choice.bullet_id, choice]));
  const before = edit.before_ids.filter((id) => at.get(id)?.shown);
  const order = [...before].sort((a, b) => at.get(a)!.position - at.get(b)!.position);
  return { order, before, moved: new Set(order.filter((id, i) => before[i] !== id)) };
}

/** Each marked line's box key (`pdf-pages.tsx`'s `boxKey`) and its mark. A
 *  new wording wins over a new order on the same bullet. */
export function marksOf(edits: TailorEdit[], choices: Choices): Map<string, Mark> {
  const marks = new Map<string, Mark>();
  for (const edit of edits) {
    if (edit.kind === "order") {
      for (const id of placing(edit, choices).moved) marks.set(`${id}.bullet`, "moved");
    }
  }
  for (const edit of edits) {
    if (edit.kind === "reword" && edit.bullet_id) marks.set(`${edit.bullet_id}.bullet`, "changed");
    if (edit.kind === "skill" && edit.skill_id) marks.set(`${edit.skill_id}.skill`, "changed");
  }
  return marks;
}

/** Each marked line's Revert target. An order change has one target per
 *  bullet out of place, so putting one back leaves the others to revert. */
export function revertsOf(edits: TailorEdit[], choices: Choices): Map<string, RevertTarget> {
  const reverts = new Map<string, RevertTarget>();
  for (const edit of edits) {
    if (edit.kind === "order") {
      for (const bulletId of placing(edit, choices).moved) {
        reverts.set(`${bulletId}.bullet`, { edit, bulletId });
      }
    }
  }
  for (const edit of edits) {
    if (edit.kind === "reword" && edit.bullet_id) reverts.set(`${edit.bullet_id}.bullet`, { edit });
    if (edit.kind === "skill" && edit.skill_id) reverts.set(`${edit.skill_id}.skill`, { edit });
  }
  return reverts;
}

/** The choices PATCH that undoes one change. */
export function revertOf(target: RevertTarget, choices: Choices): ChoicesUpdate {
  const { edit } = target;
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
  if (edit.kind === "order" && target.bulletId) {
    // The bullet goes back to its before place, and its siblings shift
    // around it.
    const { order, before, moved } = placing(edit, choices);
    const bulletId = target.bulletId;
    if (!moved.has(bulletId)) return {};
    const rest = order.filter((id) => id !== bulletId);
    rest.splice(before.indexOf(bulletId), 0, bulletId);
    return { bullets: rest.map((bullet_id, position) => ({ bullet_id, position })) };
  }
  if (edit.kind === "skill" && edit.skill_id) {
    return { skills: [{ skill_id: edit.skill_id, shown: false }] };
  }
  return {};
}

/** The changes left once the student reverts `target`, read on the
 *  `choices` the revert saved. A wording or a skill goes; an order change
 *  stays while any of its bullets is still out of place, since restoring
 *  one bullet can leave its siblings to revert one by one. */
export function reverted(
  edits: TailorEdit[],
  target: RevertTarget,
  choices: Choices,
): TailorEdit[] {
  return edits.filter(
    (edit) =>
      edit !== target.edit || (edit.kind === "order" && placing(edit, choices).moved.size > 0),
  );
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
