import type { BankResume } from "@/lib/bank-actions";

/**
 * Which resume the Experiences view shows (KAN-343, docs/bank_by_resume.md):
 * a resume's id, "all" (the whole bank) or "none" (Not From an Upload:
 * what no upload's import found). An item's `resume_ids` say which resumes
 * hold it; the API fills them, so the rules here only read them.
 */
export type Pick = string;
export const ALL = "all";
export const NONE = "none";

type Held = { resume_ids: string[] };

/** The pick the page opens on: the URL's `resume` when the bank still
 *  lists it, else the starred resume, else the newest resume of any kind,
 *  else the whole bank (no resumes, no dropdown). */
export function openingPick(resumes: BankResume[], param: string | undefined): Pick {
  if (param === ALL || param === NONE) return param;
  if (param && resumes.some((r) => r.id === param)) return param;
  const primary = resumes.find((r) => r.primary);
  if (primary) return primary.id;
  const newest = resumes.reduce<BankResume | null>(
    (best, r) => (best && best.created_at >= r.created_at ? best : r),
    null,
  );
  return newest?.id ?? ALL;
}

export function uploadIds(resumes: BankResume[]): Set<string> {
  return new Set(resumes.filter((r) => r.kind === "uploaded").map((r) => r.id));
}

/** Whether the pick shows an entry or skill. */
export function shows(pick: Pick, item: Held, uploads: Set<string>): boolean {
  if (pick === ALL) return true;
  if (pick === NONE) return !item.resume_ids.some((id) => uploads.has(id));
  return item.resume_ids.includes(pick);
}

/** "A", "A and B", "A, B and 2 more". */
function names(list: string[]): string {
  if (list.length <= 2) return list.join(" and ");
  return `${list.slice(0, 2).join(", ")} and ${list.length - 2} more`;
}

/**
 * The line under a shared entry's title. One bank entry stands for every
 * resume that holds it (ADR 0003), so an edit changes it on all of them.
 * Under a resume pick it names the others ("Also used in …"); under All
 * Experiences or Not From an Upload there is no current resume, so it names
 * them all ("Used in …"), and only when there are two or more.
 */
export function usedIn(pick: Pick, item: Held, resumes: BankResume[]): string | null {
  const name = new Map(resumes.map((r) => [r.id, r.name]));
  const held = item.resume_ids.filter((id) => name.has(id));
  if (pick === ALL || pick === NONE) {
    return held.length >= 2 ? `Used in ${names(held.map((id) => name.get(id)!))}` : null;
  }
  const others = held.filter((id) => id !== pick);
  return others.length ? `Also used in ${names(others.map((id) => name.get(id)!))}` : null;
}

/** How many built resumes show any of the items: what Clear All's confirm
 *  names (KAN-352), as Delete Entry's names its entry's count. */
export function builtShowing(items: Held[], resumes: BankResume[]): number {
  const built = new Set(resumes.filter((r) => r.kind !== "uploaded").map((r) => r.id));
  return new Set(items.flatMap((i) => i.resume_ids.filter((id) => built.has(id)))).size;
}
