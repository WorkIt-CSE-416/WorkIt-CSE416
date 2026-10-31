"use client";

import { createContext, use, useEffect, useRef, useState } from "react";

import { PencilIcon } from "@/components/icons";
import { renameBuiltResume } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";

/** The title's box, the same as text and as a field, so a click to rename
 *  does not move a letter. */
const BOX = "text-subtitle text-ink rounded-control -mx-2 px-2 py-1 font-semibold";

/** A rename for Undo or Redo to make; `drop` takes its step out of the
 *  history when the save fails. */
export type ApplyName = (name: string, drop: () => void) => void;

/**
 * The editor's Undo and Redo, as the title reaches them (./editor.tsx
 * provides it round the title row). `record` keeps a rename as a step and
 * answers how to drop it again; `attach` hands the editor the title's own
 * rename, which Undo and Redo call with the step's name. Outside an editor
 * there is none, and a rename keeps no step.
 */
export type TitleHistory = {
  record: (from: string, to: string) => () => void;
  attach: (apply: ApplyName | null) => void;
};

export const TitleHistoryContext = createContext<TitleHistory | null>(null);

/**
 * A built resume's name over the page, in the editor's title row, on its
 * own page (an h1, the page's title) and on Tailor's review step (an h2
 * under the step's sr-only h1). Renamed in place as a document's title is
 * (Google Docs): it reads as plain text,
 * shows a faint outline and a pencil when pointed at, and a click turns it
 * into a field with the same box. Enter or a click away saves it
 * (`renameBuiltResume`), Esc puts the old name back, and an empty name is
 * not saved.
 *
 * **A rename shows at once and saves behind it**, as every other edit in
 * the editor does: the field closes on the new name, the save goes, and a
 * save that fails puts back the name before it, with the API's reason
 * under the title. Saves run one at a time, in order, so a quick second
 * rename never lands under the first. While any is on its way the title
 * keeps its own name over the page's: each action renders the page again
 * in its answer (`lib/resume-revalidate.ts`), so the first one's answer
 * would show its name while the second is still saving. It calls no
 * `router.refresh()`, which would compile the PDF a second time.
 *
 * **A rename is a step of the editor's Undo and Redo** (`TitleHistory`):
 * Undo saves the name before it, Redo the name after, and a step whose
 * save fails leaves the history. Until then Undo skipped the title and
 * took back the edit before it. It was a grey small-capitals label,
 * "RESUME · <name>", which the user found hard to read and could not
 * rename. The editor's own page had a plain h1 at heading size until
 * KAN-411 gave it Tailor's title row.
 */
export function ResumeTitle({
  resumeId,
  name,
  as: Heading = "h2",
}: {
  resumeId: string;
  name: string;
  as?: "h1" | "h2";
}) {
  const history = use(TitleHistoryContext);
  // The name the student last gave, ahead of the page's own while saving
  const [shown, setShown] = useState(name);
  const [saving, setSaving] = useState(0);
  const [prev, setPrev] = useState(name);
  if (name !== prev) {
    setPrev(name);
    if (saving === 0) setShown(name);
  }
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The saves, one at a time; `latest` is the newest name sent, so only a
  // failure of that one puts a name back (an older one's is already gone)
  const saves = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef(name);
  // Enter or Esc hands focus back to the title, which the field replaced;
  // a click away leaves it where the click put it
  const refocus = useRef(false);
  // Whether the field is open: Enter closes it at once, and the blur its
  // removal can fire must not save the name a second time
  const open = useRef(false);
  const close = (focus: boolean) => {
    open.current = false;
    refocus.current = focus;
    setDraft(null);
  };

  /** Shows `next` and saves it; `drop` takes its step out of the history
   *  if the save fails. */
  function rename(next: string, before: string, drop?: () => void) {
    setError(null);
    setShown(next);
    latest.current = next;
    setSaving((n) => n + 1);
    saves.current = saves.current.then(async () => {
      const { error } = await renameBuiltResume(resumeId, next);
      setSaving((n) => n - 1);
      if (!error) return;
      drop?.();
      if (latest.current !== next) return;
      latest.current = before;
      setShown(before);
      setError(error);
    });
  }

  useEffect(() => {
    history?.attach((next, drop) => rename(next, latest.current, drop));
    return () => history?.attach(null);
  });

  function save(focus: boolean) {
    if (draft === null || !open.current) return;
    const next = draft.trim();
    close(focus);
    if (!next || next === shown) return;
    rename(next, shown, history?.record(shown, next));
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {draft === null ? (
        <Heading className="flex min-w-0">
          <button
            type="button"
            title="Rename"
            ref={(el) => {
              if (el && refocus.current) {
                refocus.current = false;
                el.focus();
              }
            }}
            onClick={() => {
              open.current = true;
              setDraft(shown);
            }}
            className={cn(
              BOX,
              "group hover:bg-panel hover:ring-border-subtle focus-visible:ring-brand-ring flex min-w-0 items-center gap-2 text-left transition-colors duration-150 hover:ring-1 focus-visible:ring-2 focus-visible:outline-none",
            )}
          >
            <span className="truncate">{shown}</span>
            <PencilIcon className="text-ink-meta size-4 shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
          </button>
        </Heading>
      ) : (
        <input
          aria-label="Resume Name"
          autoFocus
          required
          maxLength={80}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.target.select()}
          onBlur={() => save(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter") save(true);
            if (event.key === "Escape") {
              setError(null);
              close(true);
            }
          }}
          className={cn(
            BOX,
            "bg-panel ring-brand-ring w-full min-w-0 ring-2 outline-none",
          )}
        />
      )}
      {error && (
        <p role="alert" className="text-note text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
