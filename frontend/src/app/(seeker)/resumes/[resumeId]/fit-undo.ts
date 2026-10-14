import type { ChoicesUpdate } from "@/lib/built-resume-actions";

/*
 * Fit to One Page's Undo, kept in sessionStorage per resume so a reload in
 * the same tab still offers it; a new tab starts without one. sessionStorage
 * can be off (a private window): then Undo lasts only as long as the page.
 */

const key = (resumeId: string) => `workit:fit-undo:${resumeId}`;

export function readFitUndo(resumeId: string): ChoicesUpdate | null {
  try {
    return JSON.parse(sessionStorage.getItem(key(resumeId)) ?? "null") as ChoicesUpdate | null;
  } catch {
    return null;
  }
}

/** Keeps `undo` for the resume, or forgets it with null. */
export function keepFitUndo(resumeId: string, undo: ChoicesUpdate | null) {
  try {
    if (undo) sessionStorage.setItem(key(resumeId), JSON.stringify(undo));
    else sessionStorage.removeItem(key(resumeId));
  } catch {
    /* storage off: Undo lasts only as long as the page */
  }
}
