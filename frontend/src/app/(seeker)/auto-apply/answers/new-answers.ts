/**
 * New on Your Answers (KAN-369): an answer the student typed into a batch
 * tab's form is saved as they type, and the tab's panel says "Saved N new
 * answers" with Review, which opens this page. Here each of their own
 * answers saved since their last visit is marked New, so Review lands on
 * what was just captured. The last visit is the `answers_seen` cookie: the
 * newest answer's save time the page showed, in ms (the API's clock, so a
 * browser's wrong clock can't hide one), which ./seen-now.tsx writes once
 * the page has shown; ./page.tsx reads it before the next render. A student who never
 * opened the page has every own answer New. Their Claude's answers, and
 * those saved on this page, are never New: they did not come from a form.
 */
export const SEEN_COOKIE = "answers_seen";

/** The last visit's time in ms, from the cookie's value, or null. */
export function seenAt(value: string | undefined): number | null {
  const at = Number(value);
  return value && Number.isFinite(at) ? at : null;
}

/** The newest save time among the answers listed, in ms, or null when none says. */
export function newestSaved(
  postings: { questions: { answered_at: string | null }[] }[],
): number | null {
  const times = postings.flatMap((p) =>
    p.questions.map((q) => (q.answered_at ? Date.parse(q.answered_at) : NaN)),
  );
  const newest = Math.max(...times.filter(Number.isFinite));
  return Number.isFinite(newest) ? newest : null;
}

/** Whether an answer is New: the student's own, saved after `seen` (ms), or the page never seen. */
export function isNew(
  answer: { own: boolean; answered_at: string | null },
  seen: number | null,
): boolean {
  if (!answer.own) return false;
  if (seen == null) return true;
  return answer.answered_at != null && Date.parse(answer.answered_at) > seen;
}
