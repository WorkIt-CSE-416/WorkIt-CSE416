/**
 * The editor's Undo and Redo (KAN-391), the pure half: what an edit's
 * reverse is, and the capped stack of steps. The editor (./editor.tsx)
 * records a step for each edit, and Undo or Redo sends the step's edit
 * through the same render and save as any other edit; when the step kept
 * the state and PDF on its other side, the page goes back to them at once
 * and only the save goes to the API.
 *
 * Everything lives in the tab's memory, never in browser storage: a step
 * describes the database at one moment, and in storage it would outlive
 * it (another tab's edit, a reload). Each step holds only the fields its
 * edit changed and references to the editor's own copies, so 25 steps are
 * a few KB; the PDFs are the weight (about 110 KB each), so only the
 * newest `PDF_STEPS` steps keep theirs.
 */

import type { Bank } from "@/lib/bank-actions";
import type { Choices, ChoicesUpdate } from "@/lib/built-resume-actions";

/** How many steps Undo can go back. A first guess (2026-10-29): tune it,
 *  with `PDF_STEPS`, once students use it. */
export const HISTORY_STEPS = 25;
/** How many of the newest steps keep their PDFs for an instant Undo or
 *  Redo; older ones still undo, through a render. Tunable as above. */
export const PDF_STEPS = 7;

/** An edit as the editor sends it: choice changes or a typed line. */
export type Edit =
  { changes: ChoicesUpdate } | { line: { item_id: string; kind: string; text: string } };

/** One step: the edit (`redo`) and its reverse (`undo`), and, once its
 *  render landed, the editor's state and PDF on each side of it. */
export type Step<State, Pdf> = {
  undo: Edit | null;
  redo: Edit;
  before: State | null;
  after: State | null;
  pdfBefore: Pdf | null;
  pdfAfter: Pdf | null;
};

/** Pushes a step, dropping the oldest past `HISTORY_STEPS` and the PDFs of
 *  every step but the newest `PDF_STEPS`. */
export function push<S, P>(stack: Step<S, P>[], step: Step<S, P>): void {
  stack.push(step);
  if (stack.length > HISTORY_STEPS) stack.splice(0, stack.length - HISTORY_STEPS);
  for (const old of stack.slice(0, -PDF_STEPS)) old.pdfBefore = old.pdfAfter = null;
}

const PLAIN = ["shown", "position", "show_gpa", "show_coursework"] as const;

function oldFields(row: object | undefined, change: object): Record<string, unknown> {
  // An item with no row was not on the resume: the change gives it one,
  // so its reverse hides it
  if (!row) return { shown: false };
  const old: Record<string, unknown> = {};
  for (const key of PLAIN) {
    if (key in change && key in row) old[key] = (row as Record<string, unknown>)[key];
  }
  return old;
}

/** The wording a bullet shows now, as an edit: a switch back to Tailor's
 *  variant, else the text itself (the bank's original typed back drops
 *  the resume's own wording, any other text becomes it). */
function wordingNow(bank: Bank, choices: Choices, bulletId: string): Record<string, unknown> {
  const row = choices.bullets.find((b) => b.bullet_id === bulletId);
  const variant = choices.variants.find((v) => v.id === row?.variant_id);
  if (variant && !variant.local) return { variant_id: variant.id };
  if (row?.text) return { text: row.text };
  const original = bank.entries.flatMap((e) => e.bullets).find((b) => b.id === bulletId);
  return original ? { text: original.text } : { variant_id: null };
}

/** The changes that put back what `changes` changes, read from the
 *  choices before them. */
export function reverseChoices(
  bank: Bank,
  choices: Choices,
  changes: ChoicesUpdate,
): ChoicesUpdate {
  const reverse: ChoicesUpdate = {};
  if (changes.entries?.length) {
    reverse.entries = changes.entries.map((c) => ({
      entry_id: c.entry_id,
      ...oldFields(
        choices.entries.find((r) => r.entry_id === c.entry_id),
        c,
      ),
    }));
  }
  if (changes.bullets?.length) {
    reverse.bullets = changes.bullets.map((c) => {
      const row = choices.bullets.find((r) => r.bullet_id === c.bullet_id);
      const wording =
        "text" in c || "variant_id" in c ? wordingNow(bank, choices, c.bullet_id) : {};
      return { bullet_id: c.bullet_id, ...oldFields(row, c), ...(row ? wording : {}) };
    }) as ChoicesUpdate["bullets"];
  }
  if (changes.skills?.length) {
    reverse.skills = changes.skills.map((c) => ({
      skill_id: c.skill_id,
      ...oldFields(
        choices.skills.find((r) => r.skill_id === c.skill_id),
        c,
      ),
    }));
  }
  return reverse;
}

/** Fit's reverse: its `undo` body with every show turned back to a hide. */
export function hideAgain(undo: ChoicesUpdate): ChoicesUpdate {
  const off = <T extends object>(c: T): T =>
    Object.fromEntries(
      Object.entries(c).map(([k, v]) => [k, PLAIN.includes(k as never) && v === true ? false : v]),
    ) as T;
  return {
    ...(undo.entries && { entries: undo.entries.map(off) }),
    ...(undo.bullets && { bullets: undo.bullets.map(off) }),
    ...(undo.skills && { skills: undo.skills.map(off) }),
  };
}

/** A typed line's reverse, read before it: a bullet's wording as
 *  `wordingNow` reads it; a header link's stored URL (`stored`), since the
 *  page prints it without "https://" or "www."; any other line's printed
 *  text (`printed`), which the API reads back to the same value. */
export function reverseLine(
  bank: Bank,
  choices: Choices,
  line: { item_id: string; kind: string },
  printed: string | undefined,
  stored: string | null | undefined,
): Edit {
  if (line.kind === "bullet") {
    const wording = wordingNow(bank, choices, line.item_id);
    return "text" in wording
      ? { line: { ...line, text: wording.text as string } }
      : {
          changes: {
            bullets: [{ bullet_id: line.item_id, ...wording }] as ChoicesUpdate["bullets"],
          },
        };
  }
  return { line: { ...line, text: stored !== undefined ? (stored ?? "") : (printed ?? "") } };
}
