"use client";

import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react/ssr";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { FIELD_CONTROL, FIELD_LABEL } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

import { saveEssayFact } from "./actions";

/** How the API opens the question of an Essay fact (backend/app/auto_apply/written.py, ASK). */
const ASK = "Essay fact: ";

/**
 * The fact the student's Claude asked for one written question (KAN-369,
 * an Essay fact): a slot the answer needs that nothing in the student's
 * experience states, which their Claude asks for rather than invents.
 * Save to My Experience sends the student's answer to the API, which adds
 * it as a bullet of the experience entry it is about (`about`), where they
 * can edit it; the question then goes back to their Claude, which writes
 * the answer on its next run. The answer box below stays, for a student who
 * would rather write the whole answer themselves.
 */
export function FactBox({
  jobId,
  name,
  ask,
  about,
}: {
  jobId: string;
  name: string;
  ask: string;
  about: string | null;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // One save at a time: `pending` disables the button a render late.
  const saving = useRef(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (saving.current || !text.trim()) return;
    saving.current = true;
    start(async () => {
      try {
        const result = await saveEssayFact(jobId, name, text);
        if (result.saved) {
          setSavedTo(result.entry);
          setError(null);
        } else {
          setError(result.error);
        }
      } finally {
        saving.current = false;
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="bg-brand-tint rounded-control flex flex-col gap-2 p-3"
      aria-labelledby={`${id}-ask`}
    >
      <p id={`${id}-ask`} className={FIELD_LABEL}>
        Your Claude Needs a Fact
      </p>
      <label htmlFor={`${id}-fact`} className="text-body text-ink">
        {ask.startsWith(ASK) ? ask.slice(ASK.length) : ask}
      </label>
      <textarea
        id={`${id}-fact`}
        rows={2}
        placeholder="Answer in a sentence or two, in your own words"
        className={cn(
          FIELD_CONTROL,
          "block field-sizing-content min-h-16 resize-none px-3.5 py-2.5",
        )}
        value={text}
        readOnly={savedTo != null}
        maxLength={500}
        aria-describedby={`${id}-where`}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
      />
      <p id={`${id}-where`} className="text-note text-ink-meta">
        {about
          ? `It's saved to ${about} in your experience, and your Claude then writes this answer.`
          : "It's saved to your experience, and your Claude then writes this answer."}
      </p>
      {savedTo != null ? (
        <p role="status" className="text-note text-positive-ink flex items-center gap-1.5">
          <CheckCircleIcon aria-hidden className="size-3.5 shrink-0" />
          Saved to {savedTo}. Your Claude writes this answer the next time it runs.
        </p>
      ) : (
        <Button type="submit" size="sm" className="self-start" disabled={pending || !text.trim()}>
          Save to My Experience
        </Button>
      )}
      {error && (
        <p role="alert" className="text-note text-warning flex items-start gap-2">
          <WarningCircleIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </form>
  );
}
