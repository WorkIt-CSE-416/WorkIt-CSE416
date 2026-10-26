"use client";

import { useCallback, useEffect, useState } from "react";

import type { Bank } from "@/lib/bank-actions";
import type { Choices, ChoicesUpdate } from "@/lib/built-resume-actions";
import { readSessionDraft, tailorEditsKey, writeSessionDraft } from "@/lib/local-drafts";
import type { Keyword, TailorEdit, TailorSource } from "@/lib/tailor-actions";

/**
 * Tailor's review in the editor (docs/tailor_resume.md, "Marking and
 * reverting changes"). A Tailor run saves the tailored resume itself and
 * hands the editor what it changed, each with what it replaced, through
 * sessionStorage (the Tailor screen writes it, `tailorEditsKey`). On
 * Tailor's page the editor tints each change's line (`marksOf`) and the
 * Suggestions panel (../../jobs/[jobId]/tailor/tailor-suggestions.tsx)
 * shows one card per change: Accept keeps it and drops it from the record,
 * Reject undoes it through the editor's choices PATCH (`revertOf`) and
 * drops it. The student's own edit of a changed item (`untouched`) drops
 * that change too. The API keeps no record, so a new tab or device has no
 * suggestions.
 */

/** The run's keyword match before and after: how many of `total` the
 *  source resume matched, how many the tailored one does, and the
 *  keywords it added. Kept with the record, which it keeps alive once
 *  every change is handled; the review no longer shows it: the panel's
 *  meter repeated Choose Keywords' match (2026-10-26). */
export type MatchShift = { before: number; after: number; total: number; added: Keyword[] };

/** What the Tailor screen stores: the run's changes, its match, and the
 *  resume it tailored (`source`), for the review's before and after. */
export type TailorReviewRecord = { edits: TailorEdit[]; match?: MatchShift; source?: TailorSource };

/** What the editor hands Tailor's Suggestions panel: the record and the
 *  resume as they stand, and the panel's actions. `focused` is the card
 *  the pointer or focus is on and `active` the card that is open; the page
 *  tints the lines of both. A click on a line or its margin dot opens its
 *  card. Cards carry no number: a numbered card and dot read as an order
 *  the student had to follow, so each group counts its own changes. Whether
 *  the panel shows at all is the editor's (the toolbar's Suggestions). */
export type SuggestionsApi = {
  record: TailorReviewRecord;
  /** A line's place on the page (its first box's index; `pdf-pages.tsx`'s
   *  `boxKey`), so the panel lists entries top to bottom as the page does. */
  pageOrder: (boxKey: string) => number;
  bank: Bank;
  choices: Choices;
  saving: boolean;
  accept: (edit: TailorEdit) => void;
  reject: (edit: TailorEdit) => void;
  acceptAll: () => void;
  rejectAll: () => void;
  focused: string | null;
  focus: (key: string | null) => void;
  /** Opens a card and brings its lines into view (on a phone it also
   *  closes the sheet, which covers the page). */
  show: (key: string) => void;
  active: string | null;
  open: (key: string | null) => void;
};

/** A line's mark, the colour of its change's type (`ChangeKind`): `added`
 *  (an added skill, green), `reworded` (a new wording, blue) or `moved` (an
 *  entry's bullets put in a new order, amber). A removed line is not on the
 *  page, so it has no mark. */
export type Mark = "added" | "reworded" | "moved";

/** What a suggestion does to the resume, each with its own colour and
 *  glyph in the panel and on the page: a line added (a bullet, a skill), a
 *  line reworded, a line removed, or an entry's bullets moved. */
export type ChangeKind = "added" | "reworded" | "removed" | "moved";

/**
 * One suggestion as the panel shows it: its type, the resume entry it sits
 * in (`where`: an entry's id, or "skills"), and its words before and after.
 * A run's change carries its `edit`, which Accept and Reject act on. A
 * sample change has none (./demo-suggestions.ts, temporary): the run makes
 * no added bullet or removed line yet, and the panel's design needed them.
 */
export type Change = {
  key: string;
  kind: ChangeKind;
  where: string;
  edit?: TailorEdit;
  before?: string;
  after?: string;
  /** A skill's group ("Languages"). */
  group?: string;
};

/** The run's changes as the panel shows them. */
export function changesOf(edits: TailorEdit[], bank: Bank): Change[] {
  return edits.map((edit): Change => {
    const key = editKey(edit);
    if (edit.kind === "reword") {
      const entry = bank.entries.find((e) => e.bullets.some((b) => b.id === edit.bullet_id));
      return {
        key,
        kind: "reworded",
        where: entry?.id ?? "skills",
        edit,
        before: edit.before ?? undefined,
        after: edit.text ?? "",
      };
    }
    if (edit.kind === "order") return { key, kind: "moved", where: edit.entry_id ?? "", edit };
    return {
      key,
      kind: "added",
      where: "skills",
      edit,
      after: edit.label ?? "",
      group: edit.group ?? undefined,
    };
  });
}

/** One change to undo. An order change may name one bullet to put back;
 *  without one, the whole entry goes back to its before order. */
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
      const kept = next && worthKeeping(next) ? next : null;
      setRecord(kept);
      writeSessionDraft(tailorEditsKey(resumeId), kept);
    },
    [resumeId],
  );
  return [record, update] as const;
}

/** A record worth keeping: one with changes left, or with the run's match,
 *  which the panel still shows once every change is handled. */
function worthKeeping(record: TailorReviewRecord) {
  return record.edits.length > 0 || record.match != null;
}

/** A stored record, or null for one this editor cannot read: a bare list
 *  of edits (the first shape, before the dropped count), or anything else
 *  in storage, never breaks the editor. */
function readable(stored: unknown): TailorReviewRecord | null {
  if (Array.isArray(stored)) return stored.length ? { edits: stored } : null;
  if (stored && typeof stored === "object" && Array.isArray((stored as TailorReviewRecord).edits)) {
    const { edits, match, source } = stored as TailorReviewRecord;
    const record = { edits, match, source };
    return worthKeeping(record) ? record : null;
  }
  return null;
}

/** A change's identity in the record, for its card: one change per bullet
 *  wording, per entry order and per skill. */
export function editKey(edit: TailorEdit) {
  if (edit.kind === "reword") return `reword.${edit.bullet_id}`;
  if (edit.kind === "order") return `order.${edit.entry_id}`;
  return `skill.${edit.skill_id}`;
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

/** An order change's bullets out of place, each with its place before and
 *  now, counted from 1, for its card. */
export function movesOf(edit: TailorEdit, choices: Choices) {
  const { order, before, moved } = placing(edit, choices);
  return order
    .filter((id) => moved.has(id))
    .map((bulletId) => ({
      bulletId,
      from: before.indexOf(bulletId) + 1,
      to: order.indexOf(bulletId) + 1,
    }));
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
    if (edit.kind === "reword" && edit.bullet_id) marks.set(`${edit.bullet_id}.bullet`, "reworded");
    if (edit.kind === "skill" && edit.skill_id) marks.set(`${edit.skill_id}.skill`, "added");
  }
  return marks;
}

/** The box keys of a change's lines on the page: its bullet, its skill, or
 *  an order change's bullets out of place. */
export function linesOf(edit: TailorEdit, choices: Choices): string[] {
  if (edit.kind === "order") return [...placing(edit, choices).moved].map((id) => `${id}.bullet`);
  if (edit.kind === "reword" && edit.bullet_id) return [`${edit.bullet_id}.bullet`];
  if (edit.kind === "skill" && edit.skill_id) return [`${edit.skill_id}.skill`];
  return [];
}

/** Each marked line's card (`editKey`), for a click on the line. As in
 *  `marksOf`, a new wording wins over a new order on the same bullet. */
export function cardsOf(edits: TailorEdit[], choices: Choices): Map<string, string> {
  const cards = new Map<string, string>();
  for (const edit of [...edits].sort(
    (a, b) => Number(b.kind === "order") - Number(a.kind === "order"),
  )) {
    for (const line of linesOf(edit, choices)) cards.set(line, editKey(edit));
  }
  return cards;
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
  if (edit.kind === "order" && !target.bulletId) {
    // The whole entry goes back to its before order.
    const { before } = placing(edit, choices);
    return { bullets: before.map((bullet_id, position) => ({ bullet_id, position })) };
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

/** One PATCH that undoes every change in `edits` (Reject All), each
 *  bullet's parts merged into one row, since a bullet can hold both a new
 *  wording and a new place. */
export function revertAll(edits: TailorEdit[], choices: Choices): ChoicesUpdate {
  const bullets = new Map<string, NonNullable<ChoicesUpdate["bullets"]>[number]>();
  const skills: NonNullable<ChoicesUpdate["skills"]> = [];
  for (const edit of edits) {
    const one = revertOf({ edit }, choices);
    for (const row of one.bullets ?? []) {
      bullets.set(row.bullet_id, { ...bullets.get(row.bullet_id), ...row });
    }
    skills.push(...(one.skills ?? []));
  }
  return { bullets: [...bullets.values()], skills };
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
