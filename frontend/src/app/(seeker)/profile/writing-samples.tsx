"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { PlusIcon, TrashIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/section-heading";
import { FIELD_CONTROL, FIELD_LABEL } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";
import {
  addWritingSample,
  getWritingSamples,
  removeWritingSample,
  type WritingSample,
} from "@/lib/writing-samples-actions";

import { SectionAction } from "./section-action";

/** The API's limits (backend/app/schemas/writing.py). */
const MAX_SAMPLES = 3;
const MAX_LENGTH = 10_000;
/** The link the extension's ask opens, after a student's first written batch (KAN-387). */
const WRITING_SAMPLES_ID = "writing-samples";

/**
 * Writing Samples (KAN-384, KAN-387): up to three pieces of the student's own
 * writing, a class essay or a cover letter, from which their own Claude
 * builds a style card, so the answers it writes read the way they write.
 * Optional: without samples, Claude writes plainly. WorkIt's own AI never
 * reads them. The extension asks for them once, after a student's first
 * batch whose answers their Claude wrote, and opens /profile#writing-samples,
 * which opens Add Sample at once.
 *
 * Each sample is shown as its first lines, with Remove. Add opens a text box
 * in place, with Cancel and Save under it, as the sections above edit. A
 * sample is replaced by removing it and adding the new one.
 */
export function WritingSamples() {
  const [samples, setSamples] = useState<WritingSample[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    getWritingSamples()
      .then(({ samples: s, error: err }) => {
        if (err) setLoadError(err);
        else setSamples(s);
        // The extension's ask lands here: open the box the student came for.
        if (s && s.length < MAX_SAMPLES && window.location.hash === `#${WRITING_SAMPLES_ID}`) {
          setAdding(true);
        }
      })
      .catch(() => setLoadError("Could not reach the server."));
  }, []);

  useEffect(() => {
    if (adding) box.current?.focus();
  }, [adding]);

  function startAdding() {
    setText("");
    setError(null);
    setAdding(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) {
      setError("Paste a piece of your own writing first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { sample, error: err } = await addWritingSample(text.trim());
      if (err || !sample) {
        setError(err ?? "WorkIt couldn't save it. Try again.");
        return;
      }
      setSamples((s) => [...(s ?? []), sample]);
      setAdding(false);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const { error: err } = await removeWritingSample(id).catch(() => ({
      error: "Could not reach the server.",
    }));
    if (err) setError(err);
    else setSamples((s) => (s ?? []).filter((x) => x.id !== id));
  }

  const room = samples !== null && samples.length < MAX_SAMPLES;
  return (
    <section
      id={WRITING_SAMPLES_ID}
      aria-labelledby="writing-samples-heading"
      className="border-border-subtle scroll-mt-6 border-b py-6"
    >
      <div className="flex items-baseline justify-between gap-4">
        <SectionHeading id="writing-samples-heading">Writing Samples</SectionHeading>
        {room && !adding && (
          <SectionAction aria-label="Add Writing Sample" onClick={startAdding}>
            <PlusIcon />
            Add
          </SectionAction>
        )}
      </div>
      <p className="text-body text-ink-meta mt-1">
        Up to three pieces of your own writing, such as a class essay or a cover letter. Your Claude
        reads them so the answers it writes sound like you. Optional, and only your Claude reads
        them.
      </p>

      {loadError && (
        <p role="status" className="text-meta text-ink-meta mt-4">
          Your writing samples didn&apos;t load. Refresh the page to try again.
        </p>
      )}

      {samples && samples.length > 0 && (
        <ul className="mt-5 flex flex-col gap-3">
          {samples.map((s, n) => (
            <li
              key={s.id}
              className="bg-panel border-border rounded-card flex items-start gap-4 border p-4"
            >
              <p className="text-body text-ink-muted line-clamp-3 min-w-0 flex-1 whitespace-pre-line">
                {s.text}
              </p>
              <SectionAction
                aria-label={`Remove Writing Sample ${n + 1}`}
                onClick={() => remove(s.id)}
              >
                <TrashIcon />
                Remove
              </SectionAction>
            </li>
          ))}
        </ul>
      )}
      {samples && samples.length === 0 && !adding && (
        <p className="text-body text-ink-meta mt-4">No writing samples yet.</p>
      )}

      {adding && (
        <form onSubmit={handleSubmit} className="mt-5">
          <label htmlFor="writing-sample" className={FIELD_LABEL}>
            Writing Sample
          </label>
          <textarea
            id="writing-sample"
            ref={box}
            rows={8}
            maxLength={MAX_LENGTH}
            placeholder="Paste something you wrote yourself."
            className={cn(FIELD_CONTROL, "mt-1.5 block resize-y px-3.5 py-2.5")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && !saving && setAdding(false)}
          />
          {error && (
            <p role="alert" className="text-meta text-danger mt-2">
              {error}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      )}
      {!adding && error && (
        <p role="alert" className="text-meta text-danger mt-4">
          {error}
        </p>
      )}
    </section>
  );
}
