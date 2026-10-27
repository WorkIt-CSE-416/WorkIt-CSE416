"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { PencilIcon } from "@/components/icons";
import { renameBuiltResume } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";

/** The title's box, the same as text and as a field, so a click to rename
 *  does not move a letter. */
const BOX = "text-subtitle text-ink rounded-control -mx-2 px-2 py-1 font-semibold";

/**
 * A built resume's name over the page, in the editor's title row, on its
 * own page (an h1, the page's title) and on Tailor's review step (an h2
 * under the step's sr-only h1). Renamed in place as a document's title is
 * (Google Docs): it reads as plain text,
 * shows a faint outline and a pencil when pointed at, and a click turns it
 * into a field with the same box. Enter or a click away saves it
 * (`renameBuiltResume`), Esc puts the old name back, and an empty name is
 * not saved. The title shows the new name as soon as the save answers:
 * the page reads it again (`router.refresh`) a moment later, and in that
 * moment the old name flashed back. It was a grey
 * small-capitals label, "RESUME · <name>", which the user found hard to
 * read and could not rename. The editor's own page had a plain h1 at
 * heading size until KAN-411 gave it Tailor's title row.
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
  const router = useRouter();
  // The saved name, ahead of the page's own until its refresh lands
  const [shown, setShown] = useState(name);
  const [prev, setPrev] = useState(name);
  if (name !== prev) {
    setPrev(name);
    setShown(name);
  }
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  // Enter or Esc hands focus back to the title, which the field replaced;
  // a click away leaves it where the click put it
  const refocus = useRef(false);
  const close = (focus: boolean) => {
    refocus.current = focus;
    setDraft(null);
  };

  function save(focus: boolean) {
    if (draft === null || saving) return;
    const next = draft.trim();
    if (!next || next === shown) return close(focus);
    setError(null);
    startSaving(async () => {
      const { error } = await renameBuiltResume(resumeId, next);
      if (error) return setError(error);
      setShown(next);
      router.refresh();
      close(focus);
    });
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
            onClick={() => setDraft(shown)}
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
          disabled={saving}
          aria-invalid={error ? true : undefined}
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
            "bg-panel ring-brand-ring aria-invalid:ring-danger w-full min-w-0 ring-2 outline-none disabled:opacity-60",
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
