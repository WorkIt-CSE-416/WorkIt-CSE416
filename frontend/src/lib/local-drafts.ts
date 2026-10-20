/**
 * Unsaved work the browser keeps for the signed-in student, in localStorage,
 * so a reload does not lose it: today, intake's draft entry (KAN-213), the
 * sections skipped in its step bar (KAN-214), and the Applications list's
 * column layout (KAN-282), a preference rather than a draft that is kept
 * here so it leaves with the student too. Every
 * key starts with PREFIX, and `clearLocalDrafts` removes them all. Sign Out
 * calls it, and so does the login page, which also catches a session that
 * ran out: the next person in this browser never sees the last one's draft.
 *
 * Storage can be missing or refuse (private windows, blocked site data), so
 * every call here swallows its error; the page then works without it.
 */

const PREFIX = "workit.draft.";

export const INTAKE_DRAFT_KEY = `${PREFIX}intake`;
/** The sections the student skipped in intake's step bar (KAN-214). */
export const INTAKE_SKIPPED_KEY = `${PREFIX}intake-skipped`;

/** The Applications list's column order, hidden columns and widths
 *  ((seeker)/applications/column-layout.ts, KAN-282). */
export const APPLICATIONS_COLUMNS_KEY = `${PREFIX}applications-columns`;

export function readLocalDraft<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeLocalDraft(key: string, value: unknown) {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage refused: the draft lives until the tab closes.
  }
}

export function clearLocalDrafts() {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(PREFIX)) window.localStorage.removeItem(key);
    }
  } catch {
    // Nothing stored, or nothing reachable.
  }
}
