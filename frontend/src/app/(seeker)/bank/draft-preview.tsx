"use client";

import { Check, ChevronDown, ChevronRight, Pencil } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { BankEntry } from "@/lib/bank-actions";
import { cn } from "@/lib/cn";

import { entryDetails, formatDates, neededFacts, sectionOf, type EntryDraft } from "./sections";

/**
 * Intake's draft as Scout's panel shows it (KAN-202): a read-only preview,
 * pinned between the step bar and the chat, of the entry as the bank will
 * list it. It is not a form. The form opens over the panel on Edit, so the
 * chat keeps the panel's height and the card never sits on WorkIt's lines.
 *
 * After Cloudscape's split of inline previews (quick to read, one or two
 * actions in the card) from canvas previews (opened to edit), and the
 * context block chat guides recommend: what WorkIt has understood so far,
 * in plain view. Each line is keyed by its text, so a line WorkIt fills in
 * or changes fades in, and the student sees the answer land. "Still needed"
 * names the facts a resume line wants that the draft lacks yet
 * (`neededFacts`), never an optional field.
 *
 * THE STAGE CARD (KAN-249). The panel's one block above the chat: the
 * section's icon and name, "Step 1 of 6", Skip at the right, and the step
 * bar's segments (`progress`, the compact StepBar) under them. Once WorkIt
 * has a title, the draft opens under a hairline: its title and state dot,
 * the entry as the bank lists it, and Edit and Save Entry. Before that there
 * is nothing to show or save, and the chat's question is the next step; Edit
 * sits beside Skip then, so the form can still be filled in by hand.
 * Folded, the draft is its title row alone.
 *
 * It replaced two blocks that read as unrelated: the step bar with its own
 * Back, "Step 1 of 6 · Education" and Skip, and a draft card under it with
 * a second Skip, the section named again, a hint line repeating the panel's
 * subtitle and a disabled Save Entry. At 800px tall the chat kept about
 * 300px. Skip stays with the section it skips, from the first question: a
 * student happy with a visited entry had only the step bar's small Skip and
 * asked where "next" was.
 */

const SHOWN_BULLETS = 2;

export function DraftPreview({
  draft,
  done,
  folded,
  saving,
  error,
  duplicate,
  step,
  progress,
  onFold,
  onEdit,
  onSave,
  onSkip,
  skipLabel,
  skipDisabled,
  icon,
}: {
  draft: EntryDraft;
  done: boolean;
  folded: boolean;
  saving: boolean;
  error: string | null;
  duplicate: BankEntry | null;
  /** Where the walk is, "Step 1 of 6". */
  step: string;
  /** The step bar's segments. */
  progress: ReactNode;
  onFold: () => void;
  onEdit: () => void;
  onSave: () => void;
  /** Moves on without saving. */
  onSkip: () => void;
  skipLabel: string;
  /** While WorkIt answers or a save runs: a late reply must not land on the
   *  next section. Disabled rather than hidden, so the header holds still. */
  skipDisabled: boolean;
  icon: ReactNode;
}) {
  const meta = sectionOf(draft.section);
  const dates = formatDates(draft);
  const place = [draft.organization, draft.location].filter(Boolean).join(" · ");
  const bullets = draft.bullets.map((b) => b.text.trim()).filter(Boolean);
  const needed = neededFacts(draft);
  const titled = draft.title.trim() !== "";

  return (
    <section
      aria-label={`${meta.label}, ${step}`}
      className="bg-panel ring-brand-tint shadow-card animate-fade shrink-0 rounded-2xl ring-1"
    >
      <div className="flex flex-col gap-1.5 px-3.5 pt-3 pb-1.5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="bg-brand-tint text-brand flex size-8 shrink-0 items-center justify-center rounded-xl"
          >
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-label text-ink truncate font-semibold">{meta.label}</p>
            <p className="text-note text-ink-meta">{step}</p>
          </div>
          {/* No title yet, so no preview and no Edit below it: the form is
              still the way to fill the entry in by hand, which the API's own
              "Fill in the card yourself" asks for when WorkIt cannot answer. */}
          {!titled && (
            <Button size="sm" variant="ghost" className="shrink-0" onClick={onEdit}>
              <Pencil /> Edit
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 gap-0.5"
            disabled={skipDisabled}
            onClick={onSkip}
          >
            {skipLabel} <ChevronRight aria-hidden className="size-4" />
          </Button>
        </div>
        {progress}
      </div>

      {titled && (
        <div className="border-border-subtle flex items-center gap-2 border-t py-2 pr-2 pl-3.5">
          <button
            type="button"
            onClick={onFold}
            aria-expanded={!folded}
            className="focus-visible:ring-brand-ring min-w-0 flex-1 rounded-md text-left focus-visible:ring-2 focus-visible:outline-none"
          >
            <span
              key={draft.title}
              className="text-label text-ink animate-fade block truncate font-semibold"
            >
              {draft.title}
            </span>
            <span className="text-note text-ink-meta flex items-center gap-1.5">
              <Dot ready={done} />
              {done ? "Ready to save" : "Filling in as you talk"}
            </span>
          </button>
          <button
            type="button"
            onClick={onFold}
            aria-label={folded ? "Show the draft" : "Fold the draft"}
            className="text-ink-meta hover:bg-hover focus-visible:ring-brand-ring flex size-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <ChevronDown
              aria-hidden
              className={cn(
                "ease-glide size-4 transition-transform duration-200",
                folded && "-rotate-90",
              )}
            />
          </button>
        </div>
      )}

      {titled && !folded && (
        <div className="flex flex-col gap-2.5 px-3.5 pb-3">
          {/* The entry as the bank lists it. */}
          <div className="min-w-0 empty:hidden">
            {(place || dates) && (
              <p
                key={`${place}|${dates}`}
                className="text-note text-ink-muted animate-fade flex flex-wrap justify-between gap-x-3"
              >
                <span className="min-w-0 break-words">{place}</span>
                {dates && <span className="text-ink-meta shrink-0">{dates}</span>}
              </p>
            )}
            {entryDetails(draft).map((line) => (
              <p key={line} className="text-note text-ink-meta animate-fade break-words">
                {line}
              </p>
            ))}
            {bullets.length > 0 && (
              <ul className="text-note text-ink-muted mt-1 flex list-disc flex-col gap-0.5 pl-4">
                {bullets.slice(0, SHOWN_BULLETS).map((text) => (
                  // The text clips, not the <li>: clipping the <li> hides its marker.
                  <li key={text} className="animate-fade">
                    <span className="block truncate">{text}</span>
                  </li>
                ))}
                {bullets.length > SHOWN_BULLETS && (
                  <li className="text-ink-meta list-none">
                    +{bullets.length - SHOWN_BULLETS} more
                  </li>
                )}
              </ul>
            )}
          </div>

          {needed.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-meta text-ink-meta">Still needed:</span>
              {needed.map((n) => (
                <span
                  key={n}
                  className="text-meta text-ink-muted border-border rounded-full border border-dashed px-2 py-0.5"
                >
                  {n}
                </span>
              ))}
            </div>
          )}

          {(error || duplicate) && (
            <p role="alert" className="text-note text-danger">
              {duplicate
                ? "This looks like an entry already in your bank. Edit to compare."
                : error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={onEdit}>
              <Pencil /> Edit
            </Button>
            <Button size="sm" onClick={onSave} disabled={saving}>
              <Check /> {saving ? "Saving…" : "Save Entry"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Whether WorkIt has more to ask: a pulsing brand dot, or a still green
 *  one once the draft is ready. Intake's other draft views share it. */
export function Dot({ ready }: { ready: boolean }) {
  return (
    <span aria-hidden className="relative flex size-2.5 shrink-0">
      {!ready && (
        <span className="bg-brand absolute inset-0 animate-ping rounded-full opacity-40" />
      )}
      <span className={cn("relative size-2.5 rounded-full", ready ? "bg-positive" : "bg-brand")} />
    </span>
  );
}
