import "server-only";

import { revalidatePath } from "next/cache";

/**
 * A resume write that worked clears the router's copies of the pages this
 * tab has visited, so a Back to the Resumes page (or any page that lists
 * resumes) reads the list again instead of showing it as it was. Call it
 * from a server action only: from a route handler it never reaches the
 * browser's copies.
 *
 * In Next 16.3 any `revalidatePath` in an action also renders the page the
 * student is on again and sends it with the answer, whatever path it names
 * (`revalidate.js`: "TODO: only revalidate if the path matches"). So the
 * editor's per-edit saves never call it: each would compile the PDF again.
 * They mark the list stale in the tab instead (`./resumes-stale.ts`).
 * Server-only, not in a "use server" file, where it would be an endpoint.
 */
export function resumesChanged() {
  revalidatePath("/resumes");
}

/** `write`, then `resumesChanged` when it worked. */
export async function revalidatingResumes<T extends { error: string | null }>(
  write: Promise<T>,
): Promise<T> {
  const result = await write;
  if (!result.error) resumesChanged();
  return result;
}
