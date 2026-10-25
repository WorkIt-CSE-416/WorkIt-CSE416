"use client";

import { ArrowUUpLeftIcon, CheckIcon } from "@phosphor-icons/react/ssr";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Bank } from "@/lib/bank-actions";
import type { ChoicesUpdate } from "@/lib/built-resume-actions";
import { readSessionDraft, tailorEditsKey, writeSessionDraft } from "@/lib/local-drafts";
import type { TailorEdit } from "@/lib/tailor-actions";

/**
 * Tailor's review in the editor (docs/tailor_resume.md, "Marking and
 * reverting changes"). A Tailor run saves the tailored resume itself and
 * hands the editor what it changed, each with what it replaced, through
 * sessionStorage (the Tailor screen writes it, `tailorEditsKey`). Until Save
 * the editor tints each changed line (`marksOf`) and lists each change with
 * Revert, which goes through the editor's own choices PATCH (`revertOf`).
 * A revert, or the student's own edit of a changed item (`untouched`),
 * drops that change; Save drops them all. The API keeps no record, so a new
 * tab, or another device, opens the resume with no marks.
 */

/** What the Tailor screen stores: the run's changes, and how many wordings
 *  the truth rule left out. */
export type TailorReviewRecord = { edits: TailorEdit[]; dropped: number };

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
  if (Array.isArray(stored)) return stored.length ? { edits: stored, dropped: 0 } : null;
  if (stored && typeof stored === "object" && Array.isArray((stored as TailorReviewRecord).edits)) {
    const record = stored as TailorReviewRecord;
    return record.edits.length
      ? { edits: record.edits, dropped: Number(record.dropped) || 0 }
      : null;
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

/** The entry a bullet sits under, as a change names it: "Title, Organization". */
function entryOf(bank: Bank, bulletId: string | null) {
  const entry = bank.entries.find((e) => e.bullets.some((b) => b.id === bulletId));
  return entry ? [entry.title, entry.organization].filter(Boolean).join(", ") : null;
}

/**
 * The card above the page while a run's changes wait for review: each
 * change with Revert, the colours' key, and Save, which ends the review.
 * The resume is already saved; Save only drops the marks and the reverts.
 */
export function TailorReview({
  record,
  bank,
  saving,
  onRevert,
  onSave,
}: {
  record: TailorReviewRecord;
  bank: Bank;
  saving: boolean;
  onRevert: (edit: TailorEdit) => void;
  onSave: () => void;
}) {
  const { edits, dropped } = record;
  return (
    <Card as="section" aria-labelledby="tailor-review">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="tailor-review" className="text-subtitle text-ink">
            Review Tailor&apos;s Changes
          </h2>
          <p className="text-note text-ink-muted mt-1">
            Your tailored resume is saved. Changed lines are{" "}
            <span className="bg-positive/20 rounded-[2px] px-1">green</span>; bullets in a new order
            are <span className="bg-warning-fill/25 rounded-[2px] px-1">amber</span>. Revert any you
            don&apos;t want, then Save.
          </p>
          {dropped > 0 && (
            <p className="text-note text-ink-meta mt-1">
              WorkIt left out {dropped} {dropped === 1 ? "wording" : "wordings"} that added
              something your resume does not say.
            </p>
          )}
        </div>
        <Button size="sm" onClick={onSave} disabled={saving}>
          <CheckIcon aria-hidden /> Save
        </Button>
      </div>
      <ul role="list" className="divide-border-subtle mt-2 flex flex-col divide-y">
        {edits.map((edit) => (
          <li
            key={`${edit.kind}.${edit.bullet_id ?? edit.entry_id ?? edit.skill_id}`}
            className="flex flex-wrap items-start justify-between gap-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="text-note text-ink-meta">
                {edit.kind === "reword" &&
                  `New Wording: ${entryOf(bank, edit.bullet_id) ?? "Bullet"}`}
                {edit.kind === "order" && `New Bullet Order: ${edit.label ?? "Entry"}`}
                {edit.kind === "skill" && "Added Skill"}
              </p>
              {edit.kind === "reword" && (
                <div className="mt-1 grid gap-1 @lg/main:grid-cols-2">
                  <p className="text-body text-ink-muted">
                    <span className="sr-only">Was: </span>
                    {edit.before}
                  </p>
                  <p className="text-body text-ink">
                    <span className="sr-only">Now: </span>
                    {edit.text}
                  </p>
                </div>
              )}
              {edit.kind === "skill" && (
                <p className="text-body text-ink mt-1">
                  {edit.label}
                  {edit.group && <span className="text-ink-muted"> in {edit.group}</span>}
                </p>
              )}
            </div>
            <Button variant="secondary" size="sm" onClick={() => onRevert(edit)} disabled={saving}>
              <ArrowUUpLeftIcon aria-hidden /> Revert
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
