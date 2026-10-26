"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  ListField,
  RankedListField,
  ScreenerCard,
  TermChips,
  YesNoChips,
} from "@/components/answer-fields";
import { ANSWER_GROUP_ICON, PencilIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/section-heading";
import { TextField } from "@/components/ui/text-field";
import {
  AVAILABILITY,
  changedAnswers,
  SCREENERS,
  screenerChoice,
  SUGGESTED_LANGUAGES,
  termLabel,
  type AutofillAnswers,
  type YesNo,
} from "@/lib/autofill-answers";
import { saveAutofillAnswers } from "@/lib/autofill-answers-actions";
import { cn } from "@/lib/cn";
import { schoolYear, type SchoolYear } from "@/lib/school-year";

import { FIELD_GRID, FIELD_HEADING, VALUE_INDENT } from "./field-styles";
import { SectionAction } from "./section-action";

/**
 * Application Answers (KAN-369): the facts screening questions ask, beside
 * Application Questions and edited the same way (two modes, one Edit at the
 * top right, Cancel and Save under the fields, Escape cancels). Six groups:
 * Availability, Start Window, Relocation, Address, Languages and Screener
 * Facts, then School Year, which WorkIt works out from the latest education
 * entry (lib/school-year) and never asks.
 *
 * Languages lists English until the student says otherwise: a suggestion,
 * saved only with a Save. The screener facts are never answered for them;
 * None of These Apply (components/answer-fields) answers the unanswered ones
 * when pressed. Save sends only what changed (changedAnswers), lists by value.
 */
export function ApplicationAnswers({
  answers,
  education,
  onSaved,
}: {
  answers: AutofillAnswers;
  /** The experience bank's entries (the page loads them); School Year reads
   *  the education ones. */
  education: { section: string; end_month: string | null }[];
  onSaved: (answers: AutofillAnswers) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(answers);
  // What this edit started from, as Application Questions keeps it.
  const [base, setBase] = useState(answers);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (editing) document.getElementById("answers-onsite_ok")?.focus();
  }, [editing]);

  const set = (change: Partial<AutofillAnswers>) => setDraft((d) => ({ ...d, ...change }));
  const year = schoolYear(education, new Date(), editing ? draft : answers);

  function startEditing() {
    // The suggested language is in the draft, so a Save keeps it unless removed.
    setDraft({ ...answers, languages: answers.languages ?? SUGGESTED_LANGUAGES });
    setBase(answers);
    setError(null);
    setEditing(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Typed text is trimmed here, not as it is typed, so a space can be typed.
    const typed = { ...draft };
    for (const key of ["internship_location", "address_line1", "postal_code"] as const) {
      typed[key] = typed[key]?.trim() || null;
    }
    const changed = changedAnswers(typed, base);
    if (Object.keys(changed).length === 0) return setEditing(false);
    setSaving(true);
    try {
      const { answers: saved, error: err } = await saveAutofillAnswers(changed);
      if (err) return setError(err);
      if (saved) onSaved(saved);
      setEditing(false);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="application-answers" className="border-border-subtle border-b py-6">
      <div className="flex items-baseline justify-between gap-4">
        <SectionHeading id="application-answers">Application Answers</SectionHeading>
        {!editing && (
          <SectionAction aria-label="Edit Application Answers" onClick={startEditing}>
            <PencilIcon />
            Edit
          </SectionAction>
        )}
      </div>
      <p className="text-body text-ink-meta mt-1">
        The facts screening questions ask. WorkIt fills them in for you. Only you can see them here.
      </p>

      {editing ? (
        <form
          ref={form}
          onSubmit={handleSubmit}
          onKeyDown={(e) =>
            e.key === "Escape" &&
            !saving &&
            form.current?.contains(e.target as Node) &&
            setEditing(false)
          }
        >
          <div className={FIELD_GRID}>
            <Group icon="availability" title="Availability">
              {AVAILABILITY.map((q) => (
                <Question key={q.key} id={`answers-${q.key}-label`} label={q.question}>
                  <YesNoChips
                    labelledBy={`answers-${q.key}-label`}
                    value={draft[q.key]}
                    onChange={(next) => set({ [q.key]: next })}
                  />
                </Question>
              ))}
            </Group>

            <Group icon="startWindow" title="Start Window">
              <div className="grid gap-3">
                <TextField
                  id="answers-earliest_start"
                  label="Earliest Start"
                  type="date"
                  value={draft.earliest_start ?? ""}
                  onChange={(e) => set({ earliest_start: e.target.value || null })}
                />
                <TextField
                  id="answers-latest_end"
                  label="Latest End"
                  type="date"
                  value={draft.latest_end ?? ""}
                  onChange={(e) => set({ latest_end: e.target.value || null })}
                />
              </div>
              <Question id="answers-terms-label" label="Terms you can work">
                <TermChips
                  labelledBy="answers-terms-label"
                  value={draft.available_terms}
                  onChange={(available_terms) => set({ available_terms })}
                />
              </Question>
            </Group>

            <Group icon="relocation" title="Relocation">
              <Question id="answers-relocate-label" label="Are you willing to relocate?">
                <YesNoChips
                  labelledBy="answers-relocate-label"
                  value={draft.willing_to_relocate}
                  onChange={(willing_to_relocate) => set({ willing_to_relocate })}
                />
              </Question>
              <RankedListField
                id="answers-location_preferences"
                label="Where You'd Like to Work, Best First"
                placeholder="City, State"
                value={draft.location_preferences}
                onChange={(location_preferences) => set({ location_preferences })}
              />
              <TextField
                id="answers-internship_location"
                label="Where You'll Live During the Internship"
                placeholder="City, State"
                value={draft.internship_location ?? ""}
                onChange={(e) => set({ internship_location: e.target.value || null })}
              />
            </Group>

            <Group icon="address" title="Address">
              <TextField
                id="answers-address_line1"
                label="Street Address"
                autoComplete="address-line1"
                value={draft.address_line1 ?? ""}
                onChange={(e) => set({ address_line1: e.target.value || null })}
              />
              <TextField
                id="answers-postal_code"
                label="ZIP Code"
                autoComplete="postal-code"
                value={draft.postal_code ?? ""}
                onChange={(e) => set({ postal_code: e.target.value || null })}
              />
              <Note>Your city and state come from your location in Contact & Links.</Note>
            </Group>

            <Group icon="languages" title="Languages">
              <ListField
                id="answers-languages"
                label="Languages You Speak and Write Fluently"
                value={draft.languages}
                onChange={(names) => set({ languages: names.length ? names : null })}
              />
            </Group>
          </div>

          <div className="mt-6">
            <Group icon="screeners" title="Screener Facts">
              <ScreenerCard answers={draft} set={set} />
            </Group>
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
        <div className={FIELD_GRID}>
          <Group icon="availability" title="Availability">
            <dl className="grid gap-2">
              {AVAILABILITY.map((q) => (
                <Fact key={q.key} label={q.label} value={yesNo(answers[q.key])} />
              ))}
            </dl>
          </Group>
          <Group icon="startWindow" title="Start Window">
            <dl className="grid gap-2">
              <Fact label="Earliest Start" value={day(answers.earliest_start)} />
              <Fact label="Latest End" value={day(answers.latest_end)} />
              <Fact label="Terms" value={answers.available_terms?.map(termLabel).join(", ")} />
            </dl>
          </Group>
          <Group icon="relocation" title="Relocation">
            <dl className="grid gap-2">
              <Fact label="Willing to Relocate" value={yesNo(answers.willing_to_relocate)} />
              <Fact label="Places" value={answers.location_preferences?.join(" · ")} />
              <Fact label="During the Internship" value={answers.internship_location} />
            </dl>
          </Group>
          <Group icon="address" title="Address">
            <dl className="grid gap-2">
              <Fact label="Street" value={answers.address_line1} />
              <Fact label="ZIP Code" value={answers.postal_code} />
            </dl>
          </Group>
          <Group icon="languages" title="Languages">
            <p className="text-body text-ink-muted">
              {(answers.languages ?? SUGGESTED_LANGUAGES).join(", ")}
              {!answers.languages && <span className="text-ink-meta"> (suggested)</span>}
            </p>
          </Group>
          <Group icon="screeners" title="Screener Facts">
            <dl className="grid gap-2">
              {SCREENERS.map((s) => {
                const value = answers[s.key];
                const choice = screenerChoice(answers, s.key);
                return (
                  <Fact
                    key={s.key}
                    label={s.label}
                    value={
                      Array.isArray(value) && value.length
                        ? `Yes: ${value.join(", ")}`
                        : yesNo(choice)
                    }
                  />
                );
              })}
            </dl>
          </Group>
          <SchoolYearGroup year={year} />
        </div>
      )}
    </section>
  );
}

/** School Year: worked out, never asked, so it shows only when reading;
 *  the one line under it says where it comes from. */
function SchoolYearGroup({ year }: { year: SchoolYear }) {
  return (
    <Group icon="schoolYear" title="School Year">
      <dl className="grid gap-2">
        <Fact label="Class Year" value={year.classYear} empty="Unknown" />
        <Fact
          label="Back to School After the Internship"
          value={year.returnsToSchool == null ? null : year.returnsToSchool ? "Yes" : "No"}
          empty={year.graduation ? "Add a start window" : undefined}
        />
      </dl>
      <Note>
        {year.graduation
          ? `From your education: graduating ${month(year.graduation)}.`
          : "From your education: add your school's end date in Experiences to fill these in."}
      </Note>
    </Group>
  );
}

function Group({
  icon,
  title,
  children,
}: {
  icon: keyof typeof ANSWER_GROUP_ICON;
  title: string;
  children: ReactNode;
}) {
  const Icon = ANSWER_GROUP_ICON[icon];
  return (
    <div className="min-w-0">
      <h3 className={FIELD_HEADING}>
        <Icon className="text-brand size-5 shrink-0" />
        {title}
      </h3>
      <div className={cn("mt-2 grid gap-3", VALUE_INDENT)}>{children}</div>
    </div>
  );
}

function Question({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div>
      <p id={id} className="text-label text-ink-muted mb-1.5">
        {label}
      </p>
      {children}
    </div>
  );
}

function Fact({
  label,
  value,
  empty = "Not answered",
}: {
  label: string;
  value: string | null | undefined;
  /** What an empty value says. */
  empty?: string;
}) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-label text-ink-meta">{label}</dt>
      <dd className="text-body text-ink-muted min-w-0">
        {value || <span className="text-ink-meta">{empty}</span>}
      </dd>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-meta text-ink-meta">{children}</p>;
}

const yesNo = (v: YesNo | null) => (v === "yes" ? "Yes" : v === "no" ? "No" : null);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2028-05" as "May 2028", the same on server and client. */
function month(ym: string) {
  return `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}

/** "2027-06-01" as "Jun 1, 2027". */
function day(d: string | null) {
  if (!d) return null;
  return `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;
}
