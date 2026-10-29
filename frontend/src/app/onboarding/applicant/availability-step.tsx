import { ScreenerCard, TermChips, YesNoChips } from "@/components/answer-fields";
import { ANSWER_GROUP_ICON } from "@/components/icons";
import { DateField } from "@/components/date-field";
import { AVAILABILITY, type AutofillAnswers } from "@/lib/autofill-answers";

import { Field, fieldId } from "./role-step";

/**
 * Step 4, Availability (KAN-369): the Application answers most screeners
 * need first, and nothing more. The two availability questions, the start
 * window (earliest start and the terms) and the screener facts card
 * (components/answer-fields, shared with My Profile). Every one is optional
 * and the step has Skip; relocation, address, languages and the latest end
 * live on My Profile's Application Answers.
 */
export function AvailabilityStep({
  answers,
  set,
}: {
  answers: AutofillAnswers;
  set: (change: Partial<AutofillAnswers>) => void;
}) {
  return (
    <>
      <Field Icon={ANSWER_GROUP_ICON.availability} label="Availability">
        <div className="grid gap-5">
          {AVAILABILITY.map((q) => (
            <div key={q.key}>
              <p id={`${fieldId(q.label)}-q`} className="text-body text-ink-muted mb-2">
                {q.question}
              </p>
              <YesNoChips
                labelledBy={`${fieldId(q.label)}-q`}
                value={answers[q.key]}
                onChange={(next) => set({ [q.key]: next })}
              />
            </div>
          ))}
        </div>
      </Field>
      <Field
        Icon={ANSWER_GROUP_ICON.startWindow}
        label="Start Window"
        hint="When can you start, and which terms can you work?"
      >
        <div className="grid gap-4">
          <div className="max-w-xs">
            {/* WorkIt's own date picker, never the browser's
                (docs/design.md, Components). */}
            <DateField
              id="onboarding-earliest_start"
              label="Earliest Start"
              value={answers.earliest_start ?? ""}
              onValueChange={(value) => set({ earliest_start: value || null })}
              clearable
            />
          </div>
          <TermChips
            labelledBy={fieldId("Start Window")}
            value={answers.available_terms}
            onChange={(available_terms) => set({ available_terms })}
          />
        </div>
      </Field>
      <Field Icon={ANSWER_GROUP_ICON.screeners} label="Screener Facts">
        <ScreenerCard answers={answers} set={set} />
      </Field>
    </>
  );
}
