"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { answerIcon, PencilIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/section-heading";
import { SelectField } from "@/components/ui/select-field";
import { PROFILE_QUESTIONS, type AutofillAnswers } from "@/lib/autofill-answers";
import { saveAutofillAnswers } from "@/lib/autofill-answers-actions";
import { cn } from "@/lib/cn";

import { FIELD_GRID, FIELD_HEADING, VALUE_INDENT } from "./field-styles";
import { SectionAction } from "./section-action";

/** The picker's value for an unanswered question: Base UI's Select shows its
 *  placeholder for "", and clearing an answer needs an item to pick. */
const UNANSWERED = "unanswered";

/**
 * Application Questions (KAN-269): the questions most job applications ask
 * (work authorization, sponsorship, citizenship and visa status, clearance,
 * and the voluntary gender, veteran and disability self-identification),
 * with the seeker's answers. Onboarding's Profile step asks them first; this
 * is where they are seen and changed after. Both draw lib/autofill-answers'
 * one list and save through the same PATCH, which merges only the answers
 * sent, so neither screen erases what the other saved.
 *
 * TWO MODES, AS CONTACT & LINKS HAS. Reading, each question is its answer or
 * "Not answered". Edit turns every answer into a picker in place, the first
 * one focused, each over the question as forms word it, with Cancel and Save
 * under them; Escape cancels. "Not Answered" in a picker clears that answer.
 * A picker, not onboarding's tiles: seven questions of up to six tiles made a
 * screen-long form on a page of settings.
 */
export function ApplicationQuestions({
  answers,
  onSaved,
}: {
  answers: AutofillAnswers;
  onSaved: (answers: AutofillAnswers) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(answers);
  // The answers this edit started from. Save sends what differs from these,
  // not from the latest prop: a return visit shows the cached answers and
  // refetches, and a refetch landing mid-edit turned another tab's newer
  // answers into "changes", which Save then overwrote with the cached ones.
  const [base, setBase] = useState(answers);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (editing) document.getElementById(`answer-${PROFILE_QUESTIONS[0].key}`)?.focus();
  }, [editing]);

  function startEditing() {
    setDraft(answers);
    setBase(answers);
    setError(null);
    setEditing(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Only the answers changed here: the API merges them into what it holds.
    const changed = Object.fromEntries(
      Object.entries(draft).filter(([key, value]) => value !== base[key as keyof AutofillAnswers]),
    );
    if (Object.keys(changed).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const { answers: saved, error: err } = await saveAutofillAnswers(changed);
      if (err) {
        setError(err);
        return;
      }
      if (saved) onSaved(saved);
      setEditing(false);
    } catch {
      // The action call itself failed (a dropped connection).
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="application-questions" className="border-border-subtle border-b py-6">
      <div className="flex items-baseline justify-between gap-4">
        <SectionHeading id="application-questions">Application Questions</SectionHeading>
        {!editing && (
          <SectionAction aria-label="Edit Application Questions" onClick={startEditing}>
            <PencilIcon />
            Edit
          </SectionAction>
        )}
      </div>
      <p className="text-body text-ink-meta mt-1">
        The questions most job applications ask, with your answers. WorkIt keeps them ready for your
        applications. Only you can see them here.
      </p>

      {editing ? (
        <form
          ref={form}
          onSubmit={handleSubmit}
          // Escape inside a picker's open list closes the list alone: the list
          // is portalled outside the form, so only a key from the form's own
          // fields cancels the edit.
          onKeyDown={(e) =>
            e.key === "Escape" &&
            !saving &&
            form.current?.contains(e.target as Node) &&
            setEditing(false)
          }
        >
          <div className={FIELD_GRID}>
            {PROFILE_QUESTIONS.map((q) => {
              const Icon = answerIcon(q.key);
              const id = `answer-${q.key}`;
              return (
                <div key={q.key} className="min-w-0">
                  {/* The visible label; the picker is named by its own
                      screen-reader label (SelectField's hideLabel), since a
                      Base UI trigger ignores a <label for>. This one makes
                      a click on the words open the picker's list, as a
                      click on the picker does (checked in Chromium). */}
                  <label htmlFor={id} className={FIELD_HEADING}>
                    <Icon className="text-brand size-5 shrink-0" />
                    {q.label}
                  </label>
                  <div className={cn("mt-1.5", VALUE_INDENT)}>
                    <SelectField
                      id={id}
                      label={q.label}
                      hideLabel
                      value={draft[q.key] ?? UNANSWERED}
                      onValueChange={(value) =>
                        setDraft((d) => ({
                          ...d,
                          [q.key]: value === UNANSWERED || value === "" ? null : value,
                        }))
                      }
                      options={[{ value: UNANSWERED, label: "Not Answered" }, ...q.options]}
                      describedBy={`${id}-question`}
                    />
                    <p id={`${id}-question`} className="text-meta text-ink-meta mt-1">
                      {q.question}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {error && (
            <p role="alert" className="text-meta text-danger mt-4">
              {error}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      ) : (
        <dl className={FIELD_GRID}>
          {PROFILE_QUESTIONS.map((q) => {
            const Icon = answerIcon(q.key);
            const value = answers[q.key];
            const label = q.options.find((o) => o.value === value)?.label;
            return (
              <div key={q.key} className="min-w-0">
                <dt className={FIELD_HEADING}>
                  <Icon className="text-brand size-5 shrink-0" />
                  {q.label}
                </dt>
                <dd className={cn("text-body text-ink-muted mt-1.5 min-w-0", VALUE_INDENT)}>
                  {label ?? <span className="text-ink-meta">Not answered</span>}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}
