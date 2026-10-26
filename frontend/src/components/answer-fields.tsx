"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip, RemovableChip } from "@/components/ui/chip";
import { TextField } from "@/components/ui/text-field";
import {
  noneOfTheseApply,
  parseList,
  SCREENERS,
  screenerChoice,
  termLabel,
  upcomingTerms,
  type AutofillAnswers,
  type YesNo,
} from "@/lib/autofill-answers";

/**
 * The Application answers' controls (KAN-369), shared by My Profile's
 * Application Answers and onboarding's Availability step, so one answer looks
 * and behaves the same on both. Each edits a draft of the answer bank
 * through `set`; the screen saves it.
 */

type Set = (change: Partial<AutofillAnswers>) => void;

/** Yes and No as two choice chips. Pressing the pressed one again clears
 *  the answer, since every one is optional. */
export function YesNoChips({
  value,
  onChange,
  labelledBy,
}: {
  value: YesNo | null;
  onChange: (next: YesNo | null) => void;
  /** The question's heading, which names the group. */
  labelledBy: string;
}) {
  return (
    <div role="group" aria-labelledby={labelledBy} className="flex gap-2">
      {(["yes", "no"] as const).map((v) => (
        <Chip key={v} pressed={value === v} onClick={() => onChange(value === v ? null : v)}>
          {v === "yes" ? "Yes" : "No"}
        </Chip>
      ))}
    </div>
  );
}

/** A list typed as names with commas between ("Acme, Globex"). The text is
 *  kept as typed, so a trailing comma survives; `onChange` gets the names. */
export function ListField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string[] | null;
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState((value ?? []).join(", "));
  return (
    <TextField
      id={id}
      label={label}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseList(e.target.value));
      }}
    />
  );
}

/** A ranked list whose items hold commas ("New York, NY"): each added with
 *  Enter or Add, shown as a numbered chip in order, best first, and taken
 *  off with its cross. */
export function RankedListField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const items = value ?? [];
  function add() {
    const item = text.trim();
    if (item && !items.some((i) => i.toLowerCase() === item.toLowerCase())) {
      onChange([...items, item]);
    }
    setText("");
  }
  return (
    <div className="grid gap-2">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <TextField
            id={id}
            label={label}
            value={text}
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              add();
            }}
          />
        </div>
        <Button type="button" variant="secondary" disabled={!text.trim()} onClick={add}>
          Add
        </Button>
      </div>
      {items.length > 0 && (
        <ol className="flex flex-wrap gap-2">
          {items.map((item, i) => (
            <li key={item}>
              <RemovableChip
                removeLabel={`Remove ${item}`}
                onRemove={() => {
                  const next = items.filter((x) => x !== item);
                  onChange(next.length ? next : null);
                }}
              >
                {i + 1}. {item}
              </RemovableChip>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The next six terms as choice chips, any number pressed, with a saved term
 *  that has passed kept on the list so it can be taken off. */
export function TermChips({
  value,
  onChange,
  labelledBy,
}: {
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  labelledBy: string;
}) {
  // Worked out once, so the list never shifts while the student picks.
  const [upcoming] = useState(() => upcomingTerms(new Date(), 6));
  const picked = value ?? [];
  const terms = [...picked.filter((t) => !upcoming.includes(t)), ...upcoming];
  return (
    <div role="group" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
      {terms.map((term) => {
        const on = picked.includes(term);
        return (
          <Chip
            key={term}
            pressed={on}
            onClick={() => {
              const next = on ? picked.filter((t) => t !== term) : [...picked, term];
              onChange(next.length ? next : null);
            }}
          >
            {termLabel(term)}
          </Chip>
        );
      })}
    </div>
  );
}

/**
 * The screener facts, one card: each question with Yes and No, and a Yes
 * on a list question asks which companies. None of These Apply sets every
 * one still unanswered to No in one press; it is the student's answer, so
 * nothing is pressed for them before it.
 *
 * A Yes with no company typed yet is held here, not saved: an empty list is
 * the student's "none", so it would read as No.
 */
export function ScreenerCard({ answers, set }: { answers: AutofillAnswers; set: Set }) {
  const [yesHeld, setYesHeld] = useState<ReadonlySet<string>>(new Set());
  const unanswered = SCREENERS.some((s) => answers[s.key] == null && !yesHeld.has(s.key));
  return (
    <Card as="section" padding="lg" elevated={false} aria-label="Screener Facts">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-ink-meta max-w-md">
          Questions some forms ask to screen. Answer each, or press None of These Apply.
        </p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!unanswered}
          onClick={() => set(noneOfTheseApply(answers))}
        >
          None of These Apply
        </Button>
      </div>
      <ul className="mt-2">
        {SCREENERS.map((s) => {
          const id = `screener-${s.key}`;
          const held = yesHeld.has(s.key);
          const choice = held ? "yes" : screenerChoice(answers, s.key);
          const hold = (on: boolean) =>
            setYesHeld((all) => {
              const next = new Set(all);
              if (on) next.add(s.key);
              else next.delete(s.key);
              return next;
            });
          return (
            <li key={s.key} className="border-border-subtle border-t py-4 first:border-t-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p id={id} className="text-label text-ink">
                    {s.label}
                  </p>
                  <p className="text-meta text-ink-meta mt-0.5">{s.question}</p>
                </div>
                <YesNoChips
                  labelledBy={id}
                  value={choice}
                  onChange={(next) => {
                    if (!s.companies) return set({ [s.key]: next });
                    // A list's Yes waits for a company; its No is "none".
                    hold(next === "yes" && !(answers[s.key] as string[] | null)?.length);
                    if (next === "no") set({ [s.key]: [] });
                    else if (next === null) set({ [s.key]: null });
                  }}
                />
              </div>
              {s.companies && choice === "yes" && (
                <div className="mt-3">
                  <ListField
                    id={`${id}-companies`}
                    label={s.companies}
                    placeholder="Company names, with commas between"
                    value={answers[s.key] as string[] | null}
                    onChange={(names) => {
                      hold(names.length === 0);
                      set({ [s.key]: names.length ? names : null });
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
