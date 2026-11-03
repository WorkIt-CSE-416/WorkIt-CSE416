"use client";

import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react/ssr";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { answerIcon, PencilIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { SelectField } from "@/components/ui/select-field";
import { type AutofillAnswers, type ProfileQuestion } from "@/lib/autofill-answers";
import { saveAutofillAnswers } from "@/lib/autofill-answers-actions";
import { cn } from "@/lib/cn";

import { FIELD_GRID, FIELD_HEADING, SECTION_CARD, VALUE_INDENT } from "../../profile/field-styles";
import { SectionAction } from "../../profile/section-action";

/** The picker's value for an unanswered question: Base UI's Select shows its
 *  placeholder for "", and clearing an answer needs an item to pick. */
const UNANSWERED = "unanswered";

/**
 * A card of the questions most job applications ask (KAN-269), with the
 * seeker's answers. Application Info draws it twice: Work Authorization
 * (authorization, sponsorship, citizenship and visa status, clearance) and
 * Voluntary Self-Identification (SELF_ID_KEYS: gender, Hispanic or Latino,
 * race, veteran, disability and the EEO extras). Onboarding's Profile step
 * asks the first card's questions; the extension asks the self-identification
 * on the first form that does. All draw lib/autofill-answers' one list and
 * save through the same PATCH, which merges only the answers sent, so no
 * screen erases what another saved, and neither card what the other saved.
 *
 * TWO MODES, AS CONTACT & LINKS HAS. Reading, each question is its answer or
 * "Not answered", and a card with no answer at all is one "Not answered"
 * line. Each question's glyph is grey (`ink-meta`): it only informs. Edit
 * turns every answer into a picker in place, the first one focused, each
 * over the question as forms word it, with Cancel and Save under them;
 * Escape cancels. "Not Answered" in a picker clears that answer. A picker,
 * not onboarding's tiles: nine questions of up to seven tiles made a
 * screen-long form on a page of settings.
 *
 * `concealed` CLOSES THE ANSWERS WHILE READING (KAN-550): the card says how
 * many are answered, and Show Answers opens them until the page is left.
 * Self-identification in plain view on My Profile, a page students open often
 * and show on shared screens, told anyone looking their race and disability.
 */
export function ApplicationQuestions({
  id,
  title,
  description,
  questions,
  concealed = false,
  answers,
  onSaved,
}: {
  /** The heading's id; the card is `section-<id>`, the page nav's target. */
  id: string;
  title: string;
  description: string;
  questions: ProfileQuestion[];
  concealed?: boolean;
  answers: AutofillAnswers;
  onSaved: (answers: AutofillAnswers) => void;
}) {
  const [shown, setShown] = useState(!concealed);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(answers);
  // The answers this edit started from. Save sends what differs from these,
  // not from the latest prop: a refetch landing mid-edit turned another
  // tab's newer answers into "changes", which Save then overwrote.
  const [base, setBase] = useState(answers);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const first = questions[0].key;

  useEffect(() => {
    if (editing) document.getElementById(`answer-${first}`)?.focus();
  }, [editing, first]);

  function startEditing() {
    setDraft(answers);
    setBase(answers);
    setError(null);
    setEditing(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Only this card's changed answers: the API merges them into what it
    // holds, so the other card's are never sent.
    const changed = Object.fromEntries(
      questions.filter((q) => draft[q.key] !== base[q.key]).map((q) => [q.key, draft[q.key]]),
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

  const answered = questions.filter((q) => answers[q.key] != null).length;

  return (
    <Card
      as="section"
      padding="none"
      id={`section-${id}`}
      aria-labelledby={id}
      className={SECTION_CARD}
    >
      <div className="flex items-baseline justify-between gap-4">
        <SectionHeading id={id}>{title}</SectionHeading>
        {!editing && (
          <div className="flex shrink-0 items-baseline gap-4">
            {concealed && (
              <SectionAction
                aria-label={`${shown ? "Hide" : "Show"} ${title} Answers`}
                aria-expanded={shown}
                aria-controls={`${id}-answers`}
                onClick={() => setShown((s) => !s)}
              >
                {shown ? <EyeSlashIcon /> : <EyeIcon />}
                {shown ? "Hide Answers" : "Show Answers"}
              </SectionAction>
            )}
            <SectionAction aria-label={`Edit ${title}`} onClick={startEditing}>
              <PencilIcon />
              Edit
            </SectionAction>
          </div>
        )}
      </div>
      <p className="text-body text-ink-meta mt-1">{description}</p>

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
            {questions.map((q) => {
              const Icon = answerIcon(q.key);
              const fieldId = `answer-${q.key}`;
              return (
                <div key={q.key} className="min-w-0">
                  {/* The visible label; the picker is named by its own
                      screen-reader label (SelectField's hideLabel), since a
                      Base UI trigger ignores a <label for>. This one makes
                      a click on the words open the picker's list, as a
                      click on the picker does (checked in Chromium). */}
                  <label htmlFor={fieldId} className={FIELD_HEADING}>
                    <Icon aria-hidden className="text-ink-meta size-5 shrink-0" />
                    {q.label}
                  </label>
                  <div className={cn("mt-1.5", VALUE_INDENT)}>
                    <SelectField
                      id={fieldId}
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
                      describedBy={`${fieldId}-question`}
                    />
                    <p id={`${fieldId}-question`} className="text-note text-ink-meta mt-1">
                      {q.question}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {error && (
            <p role="alert" className="text-note text-danger mt-4">
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
      ) : shown && answered === 0 ? (
        // One line for a card with no answers, not "Not answered" per question.
        <p id={`${id}-answers`} className="text-body text-ink-meta mt-4">
          Not answered
        </p>
      ) : shown ? (
        <dl id={`${id}-answers`} className={FIELD_GRID}>
          {questions.map((q) => {
            const Icon = answerIcon(q.key);
            const value = answers[q.key];
            const label = q.options.find((o) => o.value === value)?.label;
            return (
              <div key={q.key} className="min-w-0">
                <dt className={FIELD_HEADING}>
                  <Icon aria-hidden className="text-ink-meta size-5 shrink-0" />
                  {q.label}
                </dt>
                <dd className={cn("text-body text-ink-muted mt-1.5 min-w-0", VALUE_INDENT)}>
                  {label ?? <span className="text-ink-meta">Not answered</span>}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p id={`${id}-answers`} className="text-body text-ink-muted mt-4">
          {answered} of {questions.length} answered. Hidden so they stay private on a shared screen.
        </p>
      )}
    </Card>
  );
}
