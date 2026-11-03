"use client";

import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react/ssr";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";

import { Checkbox } from "@/components/shadcn/checkbox";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/text-area-field";
import { OPTION_ROW, RadioRow } from "@/components/ui/radio-row";
import { FIELD_LABEL, RequiredMark } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format-count";

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
 * A one-off choice (KAN-369) shows its options to pick instead of a box.
 */
/** How a "choices" answer joins its options, as the API takes one (backend/app/auto_apply/written.py). */
const JOIN = "; ";

export function AnswerBox({ jobId, question }: { jobId: string; question: WrittenQuestion }) {
  const id = useId();
  const [text, setText] = useState("");
  // A one-off choice's picks, in the options' order. Kept as a list, never
  // split back out of the joined answer: an option can itself hold JOIN.
  const [picked, setPicked] = useState<string[]>([]);
  const options = question.kind ? question.options : null;
  const answer = options ? picked.join(JOIN) : text;
  const [reasons, setReasons] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  // One save at a time: `pending` disables the button a render late.
  const saving = useRef(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (saving.current || !answer.trim()) return;
    saving.current = true;
    start(async () => {
      try {
        const result = await saveWrittenAnswer(jobId, question.name, answer);
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
  const over = limit != null && answer.trim().length > limit;

  function pick(option: string) {
    setPicked((now) =>
      question.kind === "choice"
        ? [option]
        : (options ?? []).filter((o) => (o === option) !== now.includes(o)),
    );
    setReasons(null);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      {options ? (
        // The question names the group: a <label> can't point at a fieldset.
        <fieldset
          className="flex min-w-0 flex-col gap-1.5"
          disabled={saved}
          aria-describedby={reasons ? `${id}-reasons` : undefined}
        >
          <legend className={cn(FIELD_LABEL, "mb-0.5")}>
            {question.label}
            {question.required && <RequiredMark />}
          </legend>
          {options.map((option) =>
            question.kind === "choice" ? (
              <RadioRow
                key={option}
                name={`${id}-option`}
                checked={picked.includes(option)}
                onChange={() => pick(option)}
              >
                {option}
              </RadioRow>
            ) : (
              <label key={option} className={OPTION_ROW}>
                {/* The Checkbox's root is a <span>: the fieldset's disabled
                    doesn't reach it. */}
                <Checkbox
                  className="border-ink-meta"
                  checked={picked.includes(option)}
                  disabled={saved}
                  onCheckedChange={() => pick(option)}
                />
                <span className="min-w-0 break-words">{option}</span>
              </label>
            ),
          )}
        </fieldset>
      ) : (
        <TextAreaField
          id={`${id}-answer`}
          label={question.label}
          required={question.required}
          rows={4}
          grow
          placeholder="Write your answer, or paste one from any AI"
          value={text}
          readOnly={saved}
          aria-describedby={reasons ? `${id}-reasons` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setReasons(null);
          }}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {saved ? (
          <p role="status" className="text-note text-positive-ink flex items-center gap-1.5">
            <CheckCircleIcon aria-hidden className="size-3.5 shrink-0" />
            Saved. It fills into the job&apos;s open tab within a few seconds.
          </p>
        ) : (
          // Secondary until the box has text: a card holds several questions,
          // and a primary Save under each one put five on the screen at once.
          <Button
            type="submit"
            size="sm"
            variant={answer.trim() ? "default" : "secondary"}
            disabled={pending || !answer.trim()}
          >
            Check and Save
          </Button>
        )}
        {limit != null && (
          <span className={cn("text-note", over ? "text-warning" : "text-ink-meta")}>
            {formatCount(answer.trim().length)} / {formatCount(limit)}
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
