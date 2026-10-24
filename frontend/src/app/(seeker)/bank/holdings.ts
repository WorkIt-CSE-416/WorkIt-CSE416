import type { BankResume } from "@/lib/bank-actions";

/**
 * Which resume the Experiences view shows (KAN-343, docs/bank_by_resume.md):
 * a resume's id, NONE (Not From an Upload: what no upload owns), or ALL
 * (the whole bank) for a student with no resume, who gets no dropdown. An
 * item's `resume_ids` say which resumes hold it: the upload that owns it
 * (ADR 0005) and the built resumes that show it. The API fills them, so the
 * rules here only read them.
 */
export type Pick = string;
export const ALL = "all";
export const NONE = "none";

type Held = { resume_ids: string[] };

/** The pick the page opens on: the URL's `resume` when the bank still
 *  lists it (or "none" while there is a resume), else the starred resume,
 *  else the newest resume of any kind, else the whole bank (no resumes, no
 *  dropdown). The old "all" pick names no resume, so it opens the same way. */
export function openingPick(resumes: BankResume[], param: string | undefined): Pick {
  if (param === NONE && resumes.length > 0) return NONE;
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

/** Whether the pick shows an entry or skill. Not From an Upload shows what
 *  no upload owns: the student's own items, and those that came from
 *  several uploads before ADR 0005, which the migration left unowned.
 *  Without it they show under no pick unless a built resume shows them. */
export function shows(pick: Pick, item: Held, uploads: Set<string>): boolean {
  if (pick === ALL) return true;
  if (pick === NONE) return !item.resume_ids.some((id) => uploads.has(id));
  return item.resume_ids.includes(pick);
}

/** A pick that shows the item, to switch to when the current one hides it:
 *  a resume that holds it, else Not From an Upload. */
export function holderOf(item: Held, resumes: BankResume[]): Pick {
  return item.resume_ids.find((id) => resumes.some((r) => r.id === id)) ?? NONE;
}

/** "A", "A and B", "A, B and 2 more". */
function names(list: string[]): string {
  if (list.length <= 2) return list.join(" and ");
  return `${list.slice(0, 2).join(", ")} and ${list.length - 2} more`;
}

/**
 * The line under an entry's title: the built resumes, other than the pick,
 * that show it, since an edit here changes it there too. An upload's entry
 * is never on another upload (ADR 0005), so uploads are never named.
 * Under Not From an Upload every built resume that shows it is "other".
 */
export function usedIn(pick: Pick, item: Held, resumes: BankResume[]): string | null {
  const built = new Map(resumes.filter((r) => r.kind !== "uploaded").map((r) => [r.id, r.name]));
  const others = item.resume_ids.filter((id) => id !== pick && built.has(id));
  return others.length ? `Also used in ${names(others.map((id) => built.get(id)!))}` : null;
}
