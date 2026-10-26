import { termEnd } from "./autofill-answers.ts";

/**
 * The school-year facts forms ask that WorkIt works out instead of asking
 * (KAN-369, My Profile's Application answers): the student's class year and
 * whether they go back to school after the internship. Both come from the
 * latest education entry's end month (the expected graduation), so they stay
 * right as the years pass, with nothing to keep up to date.
 *
 * - Class year counts the school years left to graduation, by its calendar
 *   year (a December graduate is the class of that year): Senior in the
 *   school year that ends in the graduation year, then Junior, Sophomore and
 *   Freshman before it. Past graduation it is Graduate.
 * - Back to school: graduation after the latest end date the student gave,
 *   else after the end of the latest term they can work; unknown with neither.
 *
 * Pure, and relative imports only, so `node --test` runs it (frontend/CLAUDE.md).
 */

export type ClassYear = "Freshman" | "Sophomore" | "Junior" | "Senior" | "Graduate";

export type SchoolYear = {
  /** The latest education entry's end month, "YYYY-MM"; null without one. */
  graduation: string | null;
  classYear: ClassYear | null;
  /** null when there is no graduation or no end date or term to compare. */
  returnsToSchool: boolean | null;
};

const BEFORE_GRADUATION: ClassYear[] = ["Senior", "Junior", "Sophomore", "Freshman"];

export function schoolYear(
  entries: { section: string; end_month: string | null }[],
  today: Date,
  window: { latest_end?: string | null; available_terms?: string[] | null },
): SchoolYear {
  const graduation =
    entries
      .filter((e) => e.section === "education" && /^\d{4}-\d{2}$/.test(e.end_month ?? ""))
      .map((e) => e.end_month!)
      .sort()
      .at(-1) ?? null;
  if (!graduation) return { graduation: null, classYear: null, returnsToSchool: null };

  const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  // The school year runs September to August, named by the year it ends in.
  const schoolYearEnd = today.getFullYear() + (today.getMonth() >= 8 ? 1 : 0);
  const left = Math.max(0, Number(graduation.slice(0, 4)) - schoolYearEnd);
  const classYear =
    graduation < month
      ? "Graduate"
      : BEFORE_GRADUATION[Math.min(left, BEFORE_GRADUATION.length - 1)];

  const end =
    window.latest_end ??
    (window.available_terms ?? [])
      .map(termEnd)
      .filter((d): d is string => d != null)
      .sort()
      .at(-1) ??
    null;
  return {
    graduation,
    classYear,
    returnsToSchool: end ? graduation > end.slice(0, 7) : null,
  };
}
