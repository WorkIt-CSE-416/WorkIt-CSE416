"use client";

import { useState, type FormEvent } from "react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Button } from "@/components/ui/button";

import {
  EntryField,
  SECTIONS,
  draftToEntry,
  entryToDraft,
  type SectionKey,
} from "./resume-edit-dialog";

/**
 * Edits one entry of a saved resume from the profile — today a single skill;
 * roles are edited together in resume-edit-dialog.tsx — with the same fields
 * that dialog uses. Every handler
 * resolves to an error message (kept in the dialog) or null (the caller
 * closes it).
 */
type EntryDialogProps = {
  section: SectionKey;
  /** null when adding a new entry. */
  entry: object | null;
  onSave: (entry: Record<string, unknown>) => Promise<string | null>;
  /** Absent when adding — there is nothing to delete yet. */
  onDelete?: () => Promise<string | null>;
  onCancel: () => void;
};

export function EntryDialog({ section, entry, onSave, onDelete, onCancel }: EntryDialogProps) {
  const { noun, fields } = SECTIONS.find((s) => s.key === section)!;
  const [draft, setDraft] = useState(() => entryToDraft(fields, entry));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<string | null>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setError(await action());
    } catch {
      setError("Could not save. Refresh the page and try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(() => onSave(draftToEntry(fields, draft)));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{`${entry ? "Edit" : "Add"} ${noun}`}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {fields.map((f) => (
              <EntryField
                key={f.key}
                id={`entry-${section}-${f.key}`}
                field={f}
                value={draft[f.key]}
                onChange={(value) => setDraft((prev) => ({ ...prev, [f.key]: value }))}
              />
            ))}
          </div>

          {error && <p className="text-meta text-red-600">{error}</p>}

          <DialogFooter className="sm:justify-between">
            {onDelete ? (
              <Button variant="destructive" disabled={busy} onClick={() => run(onDelete)}>
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="secondary" disabled={busy} onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
