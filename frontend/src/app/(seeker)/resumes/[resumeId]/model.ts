import type { Bank, BankEntry, Bullet, Skill } from "@/lib/bank-actions";
import type { ChoicesUpdate, Choices, RenderBox } from "@/lib/built-resume-actions";

/**
 * The editor's reading of the bank and one resume's choices (KAN-218): what
 * a selected box points at, what waits in the tray, and the PATCH body for a
 * move. The API's view (backend `resume_view.py`) decides what the PDF shows;
 * this only mirrors its order rule, by position and then the bank's order,
 * to number siblings for a move.
 */

export type Line =
  | { kind: "bullet"; entry: BankEntry; bullet: Bullet }
  | { kind: "entry"; entry: BankEntry; field: string }
  | { kind: "skill"; skill: Skill };

/** The entry fields typed in place; they change the bank (user story 61). */
export const TYPED_FIELDS = new Set(["title", "organization", "location"]);

export function lineOf(bank: Bank, box: Pick<RenderBox, "item_id" | "kind">): Line | null {
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
  if (line.kind === "skill") return null;
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

export type TrayItem =
  | { kind: "entry"; entry: BankEntry }
  | { kind: "bullet"; entry: BankEntry; bullet: Bullet; text: string }
  | { kind: "skill"; skill: Skill };

/** "Not on This Resume": bank entries with no row or hidden, hidden bullets
 *  of the entries that show (a hidden entry's bullets come back with it),
 *  and hidden skills. Each comes back with one click. */
export function tray(bank: Bank, choices: Choices): TrayItem[] {
  const entry = new Map(choices.entries.map((c) => [c.entry_id, c]));
  const bullet = new Map(choices.bullets.map((c) => [c.bullet_id, c]));
  const skill = new Map(choices.skills.map((c) => [c.skill_id, c]));
  const items: TrayItem[] = [];
  for (const e of bank.entries) {
    if (!entry.get(e.id)?.shown) {
      items.push({ kind: "entry", entry: e });
      continue;
    }
    for (const b of e.bullets) {
      const c = bullet.get(b.id);
      if (!c?.shown) items.push({ kind: "bullet", entry: e, bullet: b, text: c?.text ?? b.text });
    }
  }
  for (const s of bank.skills) if (!skill.get(s.id)?.shown) items.push({ kind: "skill", skill: s });
  return items;
}

/** The PATCH that puts a tray item back on the resume. */
export function putBack(item: TrayItem): ChoicesUpdate {
  if (item.kind === "entry") return { entries: [{ entry_id: item.entry.id, shown: true }] };
  if (item.kind === "bullet") return { bullets: [{ bullet_id: item.bullet.id, shown: true }] };
  return { skills: [{ skill_id: item.skill.id, shown: true }] };
}

/** The page-count chip: "1 page", or "2 pages · 3 lines over 1 page". */
export function pageLabel(pages: number, linesOver: number) {
  if (pages <= 1) return "1 page";
  const over =
    linesOver > 0 ? ` · ${linesOver} ${linesOver === 1 ? "line" : "lines"} over 1 page` : "";
  return `${pages} pages${over}`;
}
