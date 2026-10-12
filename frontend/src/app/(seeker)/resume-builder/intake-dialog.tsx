"use client";

import { useState } from "react";

import { SparkleIcon } from "@/components/icons";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Button } from "@/components/ui/button";
import { FIELD_CONTROL, FIELD_LABEL } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";
import { readExperience, saveEntry, type EntryDraft } from "@/lib/experience-actions";

import { EntryEditor } from "./entry-editor";
import { INFO, detailLine, span } from "./sections";

/**
 * "Tell us what you've done": a paragraph in the applicant's own words, read
 * by the model into proposed entries. Nothing is saved until the applicant
 * adds one; each can be added as it is or opened in the editor first. What
 * the model wasn't told (a city, a month) it leaves out rather than guess
 * (scout/workit_scout/builder.py), so an entry may need its dates filled in.
 */
export function IntakeDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const [proposed, setProposed] = useState<EntryDraft[] | null>(null);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRead() {
    setReading(true);
    setError(null);
    const { data, error: err } = await readExperience(text);
    setReading(false);
    if (err != null) {
      setError(err);
      return;
    }
    setProposed(data.entries);
    setAdded(new Set());
  }

  async function handleAdd(i: number) {
    if (!proposed) return;
    const { error: err } = await saveEntry(proposed[i]);
    if (err != null) {
      setError(err);
      return;
    }
    setAdded((s) => new Set(s).add(i));
    onAdded();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-subtitle font-semibold">
            Describe Your Experience
          </DialogTitle>
          <DialogDescription>
            Jobs, clubs, volunteering, projects, awards: write it the way you&apos;d tell a friend,
            and we&apos;ll turn it into entries you can check and add.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1">
          <label htmlFor="intake-text" className={FIELD_LABEL}>
            What You&apos;ve Done
          </label>
          <textarea
            id="intake-text"
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={4000}
            placeholder="I was treasurer of the chess club from September 2023, ran its $3,000 budget and organized two tournaments…"
            className={cn(FIELD_CONTROL, "px-3.5 py-2.5")}
          />
        </div>
        <Button
          onClick={handleRead}
          disabled={reading || !text.trim()}
          className="justify-self-start"
        >
          <SparkleIcon className="size-4" />
          {reading ? "Reading…" : "Find Entries"}
        </Button>

        {error && (
          <p role="alert" className="text-meta text-danger">
            {error}
          </p>
        )}

        {proposed && (
          <ol className="flex flex-col gap-2">
            {proposed.map((entry, i) => (
              <li
                key={i}
                className="border-border-subtle rounded-control flex flex-col gap-2 border p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-body text-ink font-medium">
                    {entry.title}
                    {entry.organization && (
                      <span className="text-ink-muted font-normal"> · {entry.organization}</span>
                    )}
                  </p>
                  <span className="text-meta text-ink-meta">
                    {INFO[entry.section].noun}
                    {span(entry.start_date, entry.end_date) &&
                      ` · ${span(entry.start_date, entry.end_date)}`}
                  </span>
                </div>
                {detailLine(entry) && (
                  <p className="text-note text-ink-meta">{detailLine(entry)}</p>
                )}
                {entry.bullets.length > 0 && (
                  <ul className="text-note text-ink-muted list-disc pl-5">
                    {entry.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
                {added.has(i) ? (
                  <p className="text-meta text-positive-ink">Added to your Experience Bank.</p>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleAdd(i)}>
                      Add
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(i)}>
                      Edit First
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Done</Button>} />
        </DialogFooter>

        {editing != null && proposed && (
          <EntryEditor
            open
            onOpenChange={(o) => !o && setEditing(null)}
            entry={proposed[editing]}
            onSaved={() => {
              setAdded((s) => new Set(s).add(editing));
              onAdded();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
