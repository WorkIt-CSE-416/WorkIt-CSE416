import type { ChoicesUpdate } from "@/lib/built-resume-actions";

/** The box key of a bullet being added, which has no id or box of its own
 *  until it is saved (`boxKey`). */
export const NEW_BULLET = { item_id: "new", kind: "bullet", key: "new.bullet" } as const;

/**
 * The PATCH that puts a new bullet on the resume, after `after` among the
 * entry's shown bullets (`shown`, in order), or last with none. Its siblings
 * are renumbered, so ties can never leave it in the wrong place. `shown: true`
 * is for Redo: Undo hides the new bullet (`reverseChoices`, it had no row), and
 * Redo sends this again.
 */
export function bulletPlaced(
  shown: string[],
  id: string,
  after: string | null,
  wording?: string,
): ChoicesUpdate {
  const order = [...shown];
  order.splice(after ? order.indexOf(after) + 1 : order.length, 0, id);
  return {
    bullets: order.map((bullet_id, position) =>
      bullet_id === id
        ? { bullet_id, position, shown: true, ...(wording ? { text: wording } : {}) }
        : { bullet_id, position },
    ),
  };
}
