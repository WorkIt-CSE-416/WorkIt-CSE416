import {
  addBullet,
  deleteBullet,
  updateBullet,
  updateEntry,
  type BankEntry,
} from "@/lib/bank-actions";

import { changesOf, type EntryDraft } from "./sections";

export type SaveStep = () => Promise<{ error: string | null }>;

/**
 * The calls that turn a saved entry into the edited draft: its fields in one
 * PATCH first, then the bullet deletes, adds and edits. Run them in order;
 * when the first fails nothing has saved, and when a later one fails some
 * changes have, so a retry from the same draft would repeat them. Shared by
 * the bank's editor and intake's visit to an entry already in the bank.
 */
export function editSteps(entry: BankEntry, draft: EntryDraft): SaveStep[] {
  const { bullets } = draft;
  return [
    () => updateEntry(entry.id, changesOf(draft)),
    ...entry.bullets
      .filter((saved) => !bullets.some((b) => b.id === saved.id))
      .map((saved) => () => deleteBullet(saved.id)),
    ...bullets.flatMap((b) => {
      if (!b.id) return b.text.trim() ? [() => addBullet(entry.id, b.text)] : [];
      const saved = entry.bullets.find((s) => s.id === b.id);
      return saved && saved.text !== b.text ? [() => updateBullet(b.id!, { text: b.text })] : [];
    }),
  ];
}
