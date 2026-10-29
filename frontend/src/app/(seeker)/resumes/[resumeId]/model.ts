import type { Bank, BankEntry, Bullet, Skill } from "@/lib/bank-actions";
import type { ChoicesUpdate, Choices, RenderBox } from "@/lib/built-resume-actions";
import type { ApplicantProfile } from "@/lib/profile-actions";

/**
 * The editor's reading of the bank and one resume's choices (KAN-218): what
 * a selected box points at, what waits in the tray, and the PATCH body for a
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

/** A line from the bank: what the assistant and the tray act on. */
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
 *  with the next request holds it. Wording and new rows wait for the API,
 *  whose answer replaces these. */
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
