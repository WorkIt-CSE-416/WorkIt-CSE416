"use client";

import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react/ssr";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { FIELD_CONTROL, FIELD_LABEL, RequiredMark } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

import { saveWrittenAnswer } from "./actions";
import type { WrittenQuestion } from "./questions";

/**
 * One written question with a box for the student's answer, their own draft
 * or text pasted from any AI (KAN-385). Check and Save sends it to the API,
 * which runs WorkIt's checks on it (backend/app/auto_apply/checks.py) before
 * it saves: a failing answer comes back with each reason in the warning
 * amber under the box, is not saved and never reaches the form. A passing
 * one is saved, and the open batch tab fills it within about ten seconds,
 * as it fills one from the student's Claude.
 *
 * The count under the box is the form's own limit, read from the live form;
 * past it the count turns amber, and the API refuses it with the reason.
 */
export function AnswerBox({ jobId, question }: { jobId: string; question: WrittenQuestion }) {
  const id = useId();
  const [text, setText] = useState("");
  const [reasons, setReasons] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  // One save at a time: `pending` disables the button a render late.
  const saving = useRef(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (saving.current || !text.trim()) return;
    saving.current = true;
    start(async () => {
      try {
        const result = await saveWrittenAnswer(jobId, question.name, text);
        if (result.saved) {
          setSaved(true);
          setReasons(null);
        } else {
          setReasons(result.reasons.length > 0 ? result.reasons : [result.error]);
        }
      } finally {
        saving.current = false;
      }
    });
  }

  const limit = question.max_length;
  const over = limit != null && text.trim().length > limit;

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor={`${id}-answer`} className={FIELD_LABEL}>
        {question.label}
        {question.required && <RequiredMark />}
      </label>
      <textarea
        id={`${id}-answer`}
        rows={4}
        placeholder="Write your answer, or paste one from any AI"
        className={cn(
          FIELD_CONTROL,
          "block field-sizing-content min-h-28 resize-none px-3.5 py-2.5",
        )}
        value={text}
        readOnly={saved}
        aria-describedby={reasons ? `${id}-reasons` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setReasons(null);
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        {saved ? (
          <p role="status" className="text-note text-positive-ink flex items-center gap-1.5">
            <CheckCircleIcon aria-hidden className="size-3.5 shrink-0" />
            Saved. It fills into the job&apos;s open tab within a few seconds.
          </p>
        ) : (
          <Button type="submit" size="sm" disabled={pending || !text.trim()}>
            Check and Save
          </Button>
        )}
        {limit != null && (
          <span className={cn("text-note", over ? "text-warning" : "text-ink-meta")}>
            {text.trim().length} / {limit}
          </span>
        )}
      </div>

      {reasons && (
        <div
          id={`${id}-reasons`}
          role="alert"
          className="bg-warning-tint text-warning rounded-control text-note flex items-start gap-2 p-3"
        >
          {/* On the first line's centre: 12px type on a 16px line. */}
          <WarningCircleIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <div className="flex flex-col gap-1">
            <p className="font-semibold">Not saved, so it wasn&apos;t filled:</p>
            <ul className="flex flex-col gap-1">
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </form>
  );
}
