import type { BankResume } from "@/lib/bank-actions";

/**
 * Which resume the Experiences view shows (KAN-343, docs/bank_by_resume.md):
 * ALL (All Experiences, the whole bank, where it opens, KAN-440) or a resume's
 * id. A student with no resume gets no Showing card. **Every item shows under
 * All Experiences**, which is why Not From an Upload could go (KAN-440): it
 * came back in 2026-10 after 96 entries no upload owned fell out of every
 * view, and All Experiences now holds them. An item's `resume_ids` say which resumes hold it: the upload that owns it
 * (ADR 0005) and the built resumes that show it. The API fills them, so the
 * rules here only read them.
 */
export type Pick = string;
export const ALL = "all";

type Held = { resume_ids: string[] };

/** The pick the page opens on: the URL's `resume` when the bank still lists
 *  it, else All Experiences. It
 *  also reads a pick against the bank, so a resume deleted since reads as
 *  All Experiences. */
export function openingPick(resumes: BankResume[], param: string | undefined): Pick {
  if (param && resumes.some((r) => r.id === param)) return param;
  return ALL;
}

/** Whether the pick shows an entry or skill. */
export function shows(pick: Pick, item: Held): boolean {
  if (pick === ALL) return true;
  return item.resume_ids.includes(pick);
}

/** One row of the page: an entry, and the copies it stands for. */
export type BankRow<T> = { entry: T; copies: T[] };

/**
 * The entries as rows. All Experiences shows a job two uploads list once
 * (`copy_group`, ADR 0005); under any other pick each entry is its own row,
 * since a resume's view reads and edits its own. The row is the copy `prefer`
 * says (what Scout is working on must be on the page), else the primary
 * resume's copy, else the first. The copies stay separate entries: nothing
 * here merges them. A copy no resume holds, with bullets the row does not
 * show, stays a row of its own: no filter could reach it otherwise.
 */
export function rowsOf<
  T extends Held & { id: string; copy_group: string; bullets: { text: string }[] },
>(pick: Pick, entries: T[], resumes: BankResume[], prefer?: (entry: T) => boolean): BankRow<T>[] {
  if (pick !== ALL) return entries.map((entry) => ({ entry, copies: [] }));
  const primary = resumes.find((r) => r.primary)?.id;
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    groups.set(entry.copy_group, [...(groups.get(entry.copy_group) ?? []), entry]);
  }
  return [...groups.values()].flatMap((group) => {
    const entry =
      (prefer && group.find(prefer)) ??
      group.find((e) => primary && e.resume_ids.includes(primary)) ??
      group[0];
    const copies = group.filter((e) => e !== entry);
    const stranded = copies.filter(
      (c) =>
        !resumes.some((r) => c.resume_ids.includes(r.id)) && bulletWords(c) !== bulletWords(entry),
    );
    return [
      { entry, copies: copies.filter((c) => !stranded.includes(c)) },
      ...stranded.map((c) => ({ entry: c, copies: [] })),
    ];
  });
}

/** An entry's bullets as one string, to tell two copies apart. */
function bulletWords(entry: { bullets: { text: string }[] }) {
  return entry.bullets.map((b) => b.text.trim()).join("\n");
}

/** Skills as rows: All Experiences shows a name once, as a resume prints it. */
export function skillRows<T extends { name: string }>(pick: Pick, skills: T[]): T[] {
  if (pick !== ALL) return skills;
  const seen = new Set<string>();
  return skills.filter((s) => {
    const name = s.name.trim().toLowerCase();
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

/** Where a row's copies with other bullets are: each a pick that shows its
 *  copy, for the row's note. A copy with the same bullets hides nothing, and
 *  naming those put the same note on every row of a Generated resume's bank,
 *  as the "Also on" pill did before KAN-363. */
export function otherVersions<T extends Held & { id: string; bullets: { text: string }[] }>(
  row: BankRow<T>,
  resumes: BankResume[],
): { id: Pick; name: string; entryId: string }[] {
  const found = new Map<Pick, { id: Pick; name: string; entryId: string }>();
  for (const copy of row.copies.filter((c) => bulletWords(c) !== bulletWords(row.entry))) {
    for (const r of resumes.filter((r) => copy.resume_ids.includes(r.id))) {
      found.set(r.id, { id: r.id, name: r.name, entryId: copy.id });
    }
  }
  return [...found.values()];
}

/** The words of a search box as a test: every word must appear, in any
 *  order and any case, so "react intern" finds a role that says both. */
function searcher(query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return (parts: (string | null | undefined)[]) => {
    const text = parts.filter(Boolean).join(" ").toLowerCase();
    return words.every((word) => text.includes(word));
  };
}

type Searched = {
  title: string;
  organization: string | null;
  location: string | null;
  degree: string | null;
  field_of_study: string | null;
  honors: string | null;
  coursework: string[];
  bullets: { text: string }[];
};

/** Whether a row answers a search: the words a student would look for in an
 *  entry or any of its copies, bullets included. */
export function rowMatches<T extends Searched>(row: BankRow<T>, query: string): boolean {
  const found = searcher(query);
  return found(
    [row.entry, ...row.copies].flatMap((e) => [
      e.title,
      e.organization,
      e.location,
      e.degree,
      e.field_of_study,
      e.honors,
      ...e.coursework,
      ...e.bullets.map((b) => b.text),
    ]),
  );
}

/** Whether a skill answers a search, by its name or its group. */
export function skillMatches(skill: { name: string; group: string | null }, query: string) {
  return searcher(query)([skill.name, skill.group]);
}

/** A pick that shows the item, to switch to when the current one hides it: a
 *  resume that holds it, else All Experiences, which holds everything. */
export function holderOf(item: Held, resumes: BankResume[]): Pick {
  return item.resume_ids.find((id) => resumes.some((r) => r.id === id)) ?? ALL;
}

/** "A", "A and B", "A, B and 2 more". */
function names(list: string[]): string {
  if (list.length <= 2) return list.join(" and ");
  return `${list.slice(0, 2).join(", ")} and ${list.length - 2} more`;
}

/**
 * The built resumes, other than the pick, that show an entry: the note in
 * its editor (KAN-363), since a save there changes it on them too, and
 * each name in it shows that resume. An upload's entry is never on another
 * upload (ADR 0005), so uploads are never named.
 */
export function usedIn(
  pick: Pick,
  item: Held,
  resumes: BankResume[],
): { id: string; name: string }[] {
  const built = new Map(resumes.filter((r) => r.kind !== "uploaded").map((r) => [r.id, r.name]));
  return item.resume_ids
    .filter((id) => id !== pick && built.has(id))
    .map((id) => ({ id, name: built.get(id)! }));
}

/** How many built resumes show any of the items: what Clear All's confirm
 *  names (KAN-352), as Delete Entry's names its entry's count. */
export function builtShowing(items: Held[], resumes: BankResume[]): number {
  const built = new Set(resumes.filter((r) => r.kind !== "uploaded").map((r) => r.id));
  return new Set(items.flatMap((i) => i.resume_ids.filter((id) => built.has(id)))).size;
}

/** The uploads, other than the pick, that own any of the items: under a
 *  built resume's pick, Clear All deletes them there too (ADR 0005). */
export function uploadsOwning(pick: Pick, items: Held[], resumes: BankResume[]): string | null {
  const uploads = new Map(resumes.filter((r) => r.kind === "uploaded").map((r) => [r.id, r.name]));
  const owners = new Set(
    items.flatMap((i) => i.resume_ids.filter((id) => id !== pick && uploads.has(id))),
  );
  return owners.size ? names([...owners].map((id) => uploads.get(id)!)) : null;
}
