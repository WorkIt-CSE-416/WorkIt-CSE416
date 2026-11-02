import type { Bank, BankEntry, Bullet, Skill } from "@/lib/bank-actions";
import type { ChoicesUpdate, Choices, RenderBox } from "@/lib/built-resume-actions";
import type { ApplicantProfile } from "@/lib/profile-actions";

import { ALL, rowsOf, type BankRow } from "../../experiences/holdings.ts";

/**
 * The editor's reading of the bank and one resume's choices (KAN-218): what
 * a selected box points at, what the Experiences picker lists, and the PATCH body for a
 * move. The API's view (backend `resume_view.py`) decides what the PDF shows;
 * this only mirrors its order rule, by position and then the bank's order,
 * to number siblings for a move.
 */

/** The profile columns the resume's header prints; a header box's `kind`. */
export type HeaderField =
  | "full_name"
  | "phone_number"
  | "email"
  | "linkedin_url"
  | "github_url"
  | "portfolio_url"
  | "other_url";
export type Header = Pick<ApplicantProfile, HeaderField>;

export type Line =
  | { kind: "bullet"; entry: BankEntry; bullet: Bullet }
  | { kind: "entry"; entry: BankEntry; field: string }
  | { kind: "skill"; skill: Skill }
  | { kind: "header"; field: HeaderField };

/** A line from the bank: what the assistant acts on. */
export type BankLine = Exclude<Line, { kind: "header" }>;

/** The header's lines come from the profile, not the bank (the API's
 *  `HEADER` item id). */
export const HEADER = "header";

/** The header's link fields, in the order the header prints them. */
export const LINK_FIELDS = ["linkedin_url", "github_url", "portfolio_url", "other_url"] as const;

/** The entry fields typed in place; they change the bank (user story 61).
 *  The API reads what is typed (`PUT .../lines`, KAN-391): a GPA must be a
 *  number, a label typed back is dropped. */
const TYPED_ENTRY = new Set(["title", "organization", "location", "honors", "coursework", "gpa"]);

/** The header fields typed in place; they change the profile. The email is
 *  the profile's contact email, else the sign-in address, so it is set on
 *  My Profile, not typed here. */
const TYPED_HEADER = new Set<string>(["full_name", "phone_number", ...LINK_FIELDS]);

/** True when the line's text is typed in place. */
export function typed(line: Line) {
  if (line.kind === "bullet") return true;
  if (line.kind === "entry") return TYPED_ENTRY.has(line.field);
  if (line.kind === "header") return TYPED_HEADER.has(line.field);
  return false;
}

/** What the line is, for a heading: the entry's title, the skill, or the
 *  header field. */
export function lineName(line: Line) {
  if (line.kind === "skill") return line.skill.name;
  if (line.kind === "header") return "Header";
  return line.entry.title;
}

export function lineOf(bank: Bank, box: Pick<RenderBox, "item_id" | "kind">): Line | null {
  if (box.item_id === HEADER) return { kind: "header", field: box.kind as HeaderField };
  if (box.kind === "skill") {
    const skill = bank.skills.find((s) => s.id === box.item_id);
    return skill ? { kind: "skill", skill } : null;
  }
  for (const entry of bank.entries) {
    if (box.kind === "bullet") {
      const bullet = entry.bullets.find((b) => b.id === box.item_id);
      if (bullet) return { kind: "bullet", entry, bullet };
    } else if (entry.id === box.item_id) {
      return { kind: "entry", entry, field: box.kind };
    }
  }
  return null;
}

/** The text a bullet shows on this resume: its variant's, else the bank's. */
export function wording(choices: Choices, bullet: Bullet) {
  return choices.bullets.find((c) => c.bullet_id === bullet.id)?.text ?? bullet.text;
}

/** Shown siblings in resume order: by position, ties in bank order. */
function ordered<T extends { id: string }>(
  items: T[],
  choice: (id: string) => { shown: boolean; position: number } | undefined,
): T[] {
  return items
    .map((item, i) => ({ item, i, c: choice(item.id) }))
    .filter((x) => x.c?.shown)
    .sort((a, b) => a.c!.position - b.c!.position || a.i - b.i)
    .map((x) => x.item);
}

/** The PATCH that moves a line one place up (-1) or down (1) among its
 *  shown siblings, renumbering them all so ties can never stall a move; null
 *  at either end. Entries move within their section, bullets within their
 *  entry. */
export function move(bank: Bank, choices: Choices, line: Line, by: -1 | 1): ChoicesUpdate | null {
  if (line.kind === "skill" || line.kind === "header") return null;
  const siblings =
    line.kind === "bullet"
      ? ordered(line.entry.bullets, (id) => choices.bullets.find((c) => c.bullet_id === id))
      : ordered(
          bank.entries.filter((e) => e.section === line.entry.section),
          (id) => choices.entries.find((c) => c.entry_id === id),
        );
  const id = line.kind === "bullet" ? line.bullet.id : line.entry.id;
  const at = siblings.findIndex((s) => s.id === id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= siblings.length) return null;
  const order = siblings.map((s) => s.id);
  [order[at], order[to]] = [order[to], order[at]];
  return line.kind === "bullet"
    ? { bullets: order.map((bullet_id, position) => ({ bullet_id, position })) }
    : { entries: order.map((entry_id, position) => ({ entry_id, position })) };
}

/** The choices with a change's plain fields (shown, position, the GPA
 *  and coursework toggles) set at once, for rows the resume already has
 *  (KAN-391): a second move computes from the first, and the copy sent
 *  with the next request holds it. Wording and new rows wait for the
 *  render's answer, which replaces these. */
export function mergeChoices(choices: Choices, changes: ChoicesUpdate): Choices {
  const plain = <T extends object>(row: T, change: object) => ({
    ...row,
    ...Object.fromEntries(
      Object.entries(change).filter(
        ([k, v]) =>
          v !== undefined && ["shown", "position", "show_gpa", "show_coursework"].includes(k),
      ),
    ),
  });
  const entries = new Map(changes.entries?.map((c) => [c.entry_id, c]));
  const bullets = new Map(changes.bullets?.map((c) => [c.bullet_id, c]));
  const skills = new Map(changes.skills?.map((c) => [c.skill_id, c]));
  return {
    ...choices,
    entries: choices.entries.map((r) =>
      entries.has(r.entry_id) ? plain(r, entries.get(r.entry_id)!) : r,
    ),
    bullets: choices.bullets.map((r) =>
      bullets.has(r.bullet_id) ? plain(r, bullets.get(r.bullet_id)!) : r,
    ),
    skills: choices.skills.map((r) =>
      skills.has(r.skill_id) ? plain(r, skills.get(r.skill_id)!) : r,
    ),
  };
}

/** The choices with a typed bullet's saved wording (KAN-391): the save
 *  answers the resume's local variant (`variantId`, null when the original
 *  was typed back), which the render, made before the write, could not
 *  know. Applied only while the bullet still shows those words. */
export function withWording(
  choices: Choices,
  bulletId: string,
  variantId: string | null,
  text: string,
): Choices {
  const row = choices.bullets.find((b) => b.bullet_id === bulletId);
  if (!row || (row.text ?? null) !== (variantId ? text : null)) return choices;
  return {
    ...choices,
    bullets: choices.bullets.map((b) =>
      b.bullet_id === bulletId ? { ...b, variant_id: variantId } : b,
    ),
    variants: [
      ...choices.variants.filter((v) => !(v.local && v.bullet_id === bulletId)),
      ...(variantId
        ? [{ id: variantId, bullet_id: bulletId, text, job_posting_id: null, local: true }]
        : []),
    ],
  };
}

/** Two neighbours a change swaps: an entry within its section, or a
 *  bullet within its entry, `a` the one above before the change. Null for
 *  any other change. The page shows the swap at once (KAN-391). */
export type Swap = { kind: "entry" | "bullet"; a: string; b: string };

export function swapOf(bank: Bank, choices: Choices, changes: ChoicesUpdate): Swap | null {
  const renumber = (list: { position?: number | null }[] | undefined) =>
    list &&
    list.length >= 2 &&
    list.every((c) => Object.keys(c).length === 2 && c.position != null);
  const swapped = (before: string[], after: string[]): [string, string] | null => {
    const at = before.findIndex((id, i) => id !== after[i]);
    if (at < 0 || at + 1 >= before.length) return null;
    const same = before.every((id, i) =>
      i === at ? after[i + 1] === id : i === at + 1 ? after[i - 1] === id : after[i] === id,
    );
    return same ? [before[at], before[at + 1]] : null;
  };
  if (renumber(changes.bullets) && !changes.entries?.length && !changes.skills?.length) {
    const ids = changes.bullets!.map((c) => c.bullet_id);
    const entry = bank.entries.find((e) => e.bullets.some((b) => b.id === ids[0]));
    if (!entry) return null;
    const before = ordered(entry.bullets, (id) => choices.bullets.find((c) => c.bullet_id === id));
    const after = [...changes.bullets!].sort((x, y) => x.position! - y.position!);
    const pair = swapped(
      before.map((b) => b.id),
      after.map((c) => c.bullet_id),
    );
    return pair && { kind: "bullet", a: pair[0], b: pair[1] };
  }
  if (renumber(changes.entries) && !changes.bullets?.length && !changes.skills?.length) {
    const first = bank.entries.find((e) => e.id === changes.entries![0].entry_id);
    if (!first) return null;
    const before = ordered(
      bank.entries.filter((e) => e.section === first.section),
      (id) => choices.entries.find((c) => c.entry_id === id),
    );
    const after = [...changes.entries!].sort((x, y) => x.position! - y.position!);
    const pair = swapped(
      before.map((e) => e.id),
      after.map((c) => c.entry_id),
    );
    return pair && { kind: "entry", a: pair[0], b: pair[1] };
  }
  return null;
}

/** A bullet in the Experiences picker: its words on this resume, and whether
 *  they print. */
export type PickedBullet = { id: string; text: string; on: boolean };

/** One row of the Experiences picker: an entry and its copies, on when any
 *  copy prints. `shownIds` are the copies that do. */
export type PickedEntry = BankRow<BankEntry> & {
  on: boolean;
  shownIds: string[];
  bullets: PickedBullet[];
};

/** A skill name in the picker: the skills that hold it, on when one prints. */
export type PickedSkill = { skill: Skill; copies: Skill[]; on: boolean; shownIds: string[] };

/**
 * The whole bank as the Experiences picker shows it (KAN-440): the resume is
 * the part of the bank that is on. Copies are one row, as in All Experiences,
 * and the row is the copy that prints, so a row and the page agree. Bullets
 * keep their place whether on or off: the resume's order for a bullet with a
 * row on it, then the rest in the bank's order. Off bullets went to the end
 * until 2026-11-01, so a tick moved the list under the pointer and the next
 * click landed on another bullet. A bullet's words are this resume's own
 * where it has them.
 */
export function pickerEntries(bank: Bank, choices: Choices): PickedEntry[] {
  const entry = new Map(choices.entries.map((c) => [c.entry_id, c]));
  const bullet = new Map(choices.bullets.map((c) => [c.bullet_id, c]));
  const prints = (e: BankEntry) => entry.get(e.id)?.shown === true;
  return rowsOf(ALL, bank.entries, bank.resumes, prints).map((row) => {
    const shownIds = [row.entry, ...row.copies].filter(prints).map((e) => e.id);
    const placed = ordered(row.entry.bullets, (id) => {
      const c = bullet.get(id);
      return c && { ...c, shown: true };
    });
    const rowless = row.entry.bullets.filter((b) => !bullet.has(b.id));
    return {
      ...row,
      on: shownIds.length > 0,
      shownIds,
      bullets: [...placed, ...rowless].map((b) => ({
        id: b.id,
        text: bullet.get(b.id)?.text ?? b.text,
        on: bullet.get(b.id)?.shown === true,
      })),
    };
  });
}

/** The skills, a name once: uploads can each hold one, and the page would
 *  print it twice. */
export function pickerSkills(bank: Bank, choices: Choices): PickedSkill[] {
  const skill = new Map(choices.skills.map((c) => [c.skill_id, c]));
  const names = new Map<string, Skill[]>();
  for (const s of bank.skills) {
    const name = s.name.trim().toLowerCase();
    names.set(name, [...(names.get(name) ?? []), s]);
  }
  return [...names.values()].map((held) => {
    const shown = held.filter((s) => skill.get(s.id)?.shown);
    const first = shown[0] ?? held[0];
    return {
      skill: first,
      copies: held.filter((s) => s !== first),
      on: shown.length > 0,
      shownIds: shown.map((s) => s.id),
    };
  });
}

/** The PATCH that turns a row on or off. Off takes every copy that prints,
 *  so the row does not stay on through a second copy. */
export function pickEntry(row: PickedEntry, on: boolean): ChoicesUpdate {
  return {
    entries: on
      ? [{ entry_id: row.entry.id, shown: true }]
      : row.shownIds.map((entry_id) => ({ entry_id, shown: false })),
  };
}

export function pickBullet(bullet_id: string, on: boolean): ChoicesUpdate {
  return { bullets: [{ bullet_id, shown: on }] };
}

export function pickSkill(row: PickedSkill, on: boolean): ChoicesUpdate {
  return {
    skills: on
      ? [{ skill_id: row.skill.id, shown: true }]
      : row.shownIds.map((skill_id) => ({ skill_id, shown: false })),
  };
}

/** What Fit to One Page cut from this resume, read from each fit's `undo`
 *  body: whole entries, bullets and skills (docs/cut_to_one_page.md), and
 *  Education's coursework lines, which fits before KAN-320 cut. */
export type FitCuts = {
  entries: string[];
  bullets: string[];
  coursework: string[];
  skills: string[];
};

export const NO_CUTS: FitCuts = { entries: [], bullets: [], coursework: [], skills: [] };

/** `cuts` with one more fit's cuts added: a second fit adds to the first. */
export function addCuts(cuts: FitCuts, undo: ChoicesUpdate): FitCuts {
  const add = (list: string[], ids: string[]) => [...new Set([...list, ...ids])];
  const entries = undo.entries ?? [];
  return {
    entries: add(
      cuts.entries,
      entries.filter((e) => e.shown !== undefined).map((e) => e.entry_id),
    ),
    coursework: add(
      cuts.coursework,
      entries.filter((e) => e.show_coursework !== undefined).map((e) => e.entry_id),
    ),
    bullets: add(
      cuts.bullets,
      (undo.bullets ?? []).map((b) => b.bullet_id),
    ),
    skills: add(
      cuts.skills,
      (undo.skills ?? []).map((s) => s.skill_id),
    ),
  };
}

/** One row of Cut From Resume: a picker row with only the bullets Fit cut,
 *  the copies Fit cut whole (`cutIds`), and its coursework line if Fit cut
 *  that. */
export type CutEntry = PickedEntry & {
  cutIds: string[];
  coursework: { entry_id: string; on: boolean } | null;
};

/**
 * Cut From Resume's rows: each entry Fit cut something from, as the
 * Experiences picker shows it (`pickerEntries`), so a row says whether it
 * is back on the page. A row stays after it is added back, ticked, so a
 * click that put the wrong one back can take it off again.
 */
export function cutRows(bank: Bank, choices: Choices, cuts: FitCuts): CutEntry[] {
  const entry = new Map(choices.entries.map((c) => [c.entry_id, c]));
  return pickerEntries(bank, choices).flatMap((row) => {
    const ids = [row.entry, ...row.copies].map((e) => e.id);
    const cutIds = ids.filter((id) => cuts.entries.includes(id));
    const bullets = row.bullets.filter((b) => cuts.bullets.includes(b.id));
    const course = ids.find((id) => cuts.coursework.includes(id));
    if (cutIds.length === 0 && bullets.length === 0 && !course) return [];
    return [
      {
        ...row,
        bullets,
        cutIds,
        coursework: course
          ? { entry_id: course, on: entry.get(course)?.show_coursework === true }
          : null,
      },
    ];
  });
}

/** True when everything Fit cut from the row is on the page again. */
export function isBack(row: CutEntry) {
  return (
    (row.cutIds.length === 0 || row.on) &&
    row.bullets.every((b) => b.on) &&
    (!row.coursework || row.coursework.on)
  );
}

/** One skill Fit cut, and whether it is on the page again. It is the skill
 *  Fit cut, not the picker's row of its copies, so it comes back as itself. */
export type CutSkill = { skill: Skill; on: boolean };

/** Cut From Resume's skills, in the bank's order. Like an entry's row, one
 *  stays once it is back, ticked. */
export function cutSkills(bank: Bank, choices: Choices, cuts: FitCuts): CutSkill[] {
  const shown = new Map(choices.skills.map((c) => [c.skill_id, c.shown]));
  return bank.skills
    .filter((s) => cuts.skills.includes(s.id))
    .map((skill) => ({ skill, on: shown.get(skill.id) === true }));
}

/** True while anything Fit cut is still off the page: Cut From Resume's
 *  button shows only then (or while its panel is open). */
export function cutLeft(bank: Bank, choices: Choices, cuts: FitCuts) {
  return (
    !cutRows(bank, choices, cuts).every(isBack) || cutSkills(bank, choices, cuts).some((s) => !s.on)
  );
}

/** The page-count chip: "1 page", or "2 pages · 3 lines over 1 page". */
/** The phone's short count, "3 lines over" (or "2 pages" with no estimate),
 *  for its top bar beside the back arrow. */
export function shortPageLabel(pages: number, linesOver: number) {
  return linesOver > 0
    ? `${linesOver} ${linesOver === 1 ? "line" : "lines"} over`
    : `${pages} pages`;
}

export function pageLabel(pages: number, linesOver: number) {
  if (pages <= 1) return "1 page";
  const over =
    linesOver > 0 ? ` · ${linesOver} ${linesOver === 1 ? "line" : "lines"} over 1 page` : "";
  return `${pages} pages${over}`;
}
