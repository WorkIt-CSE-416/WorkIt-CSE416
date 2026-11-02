import { NO_CUTS, type FitCuts } from "./model";

/*
 * What Fit to One Page cut, kept in sessionStorage per resume, so a reload
 * in the same tab still offers Cut From Resume; a new tab starts without
 * it. Safe to outlive the page, unlike Undo's steps: Cut From Resume reads
 * it against the resume's choices each time, so an item already back on the
 * page only shows ticked. sessionStorage can be off (a private window): then
 * the list lasts as long as the page.
 */

const key = (resumeId: string) => `workit:fit-cuts:${resumeId}`;

const ids = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

export function readFitCuts(resumeId: string): FitCuts {
  try {
    const kept = JSON.parse(sessionStorage.getItem(key(resumeId)) ?? "null") as Partial<
      Record<keyof FitCuts, unknown>
    > | null;
    if (!kept) return NO_CUTS;
    return {
      entries: ids(kept.entries),
      bullets: ids(kept.bullets),
      coursework: ids(kept.coursework),
      // A list kept before Fit cut skills has none
      skills: ids(kept.skills),
    };
  } catch {
    return NO_CUTS;
  }
}

export function keepFitCuts(resumeId: string, cuts: FitCuts) {
  try {
    sessionStorage.setItem(key(resumeId), JSON.stringify(cuts));
  } catch {
    /* storage off: the list lasts only as long as the page */
  }
}
