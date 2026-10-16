"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ComponentType, type ReactNode } from "react";

import {
  JOB_TYPE_OPTIONS,
  NO_FILTERS,
  PAY_OPTIONS,
  payUnits,
  VISA_OPTIONS,
  WORKPLACE_OPTIONS,
  type FeedFilters,
} from "@/app/(seeker)/jobs/filter-query";
import { signOut } from "@/app/actions";
import { SalaryPicker, SearchPicker, type PickOption } from "@/components/filter-controls";
import {
  BriefcaseIcon,
  CoinIcon,
  PinIcon,
  RoleIcon,
  VisaIcon,
  workStyleIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";

import { savePreferences } from "./actions";
import { ChoiceTile } from "./choice-tile";
import { StoryPanel } from "./story-panel";

/**
 * The applicant onboarding wizard (KAN-231): three short steps, Scout asking
 * each one's question on the left (./story-panel) and the fields answering it
 * on the right.
 *
 * THE ANSWERS ARE THE JOBS PAGE'S FILTERS. Role, job type, workplace,
 * location, salary and visa are a `FeedFilters`, with the same options and
 * pickers as All Filters (components/filter-controls). Continue saves them
 * as the seeker's preferences, which marks onboarding done, then opens
 * intake (./bank, KAN-214), which fills the experience bank matching reads
 * and imports a resume; its Finish opens the Jobs page's Recommended view.
 * There is no resume step here: intake asks for one. Date Posted is not
 * asked: a saved "past 24 hours" would empty the feed within days.
 *
 * `initial` is the seeker's saved preferences, so coming back from intake
 * ("Back to Profile") edits them rather than starting over.
 */

type Glyph = ComponentType<{ className?: string }>;

/** Each step's question, and the line Scout types in its bubble above it. */
const STEPS: { question: ReactNode; line: string }[] = [
  {
    question: (
      <>
        To get started, <strong>what type of role</strong> are you looking for?
      </>
    ),
    line: "Hi, I'm Scout. Tell me what you're after and I'll do the digging.",
  },
  {
    question: (
      <>
        Next, <strong>what matters most</strong> in your next job?
      </>
    ),
    line: "Tell me your pay floor and visa needs, and I'll filter for both.",
  },
];

const toggle = <T,>(values: T[], value: T) =>
  values.includes(value) ? values.filter((v) => v !== value) : [...values, value];

export function OnboardingForm({
  roles,
  places,
  initial = NO_FILTERS,
}: {
  roles: PickOption[];
  places: PickOption[];
  initial?: FeedFilters;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const column = useRef<HTMLDivElement>(null);
  const [answers, setAnswers] = useState<FeedFilters>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (change: Partial<FeedFilters>) => setAnswers((a) => ({ ...a, ...change }));
  const last = step === STEPS.length - 1;
  // Only step 1 asks anything required.
  const canNext =
    step > 0 ||
    (answers.roles.length > 0 && answers.jobTypes.length > 0 && answers.workStyles.length > 0);

  function goTo(next: number) {
    setStep(next);
    // The column scrolls from lg, the page below it.
    column.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }

  /** Saving the answers is what finishes onboarding; a failed save leaves
   *  this page to retry from. */
  async function finish() {
    setSaving(true);
    setError(null);
    const { error: saveError } = await savePreferences(answers);
    if (saveError) {
      setSaving(false);
      setError(saveError);
      return;
    }
    // Intake is the next step (KAN-214); its Finish opens the matches.
    router.push("/onboarding/applicant/bank");
  }

  // FROM LG THE SCREEN IS ONE WINDOW TALL AND ONLY THE RIGHT COLUMN SCROLLS,
  // with room for its scrollbar kept on every step. When the page scrolled,
  // step 1 alone overflowed the window and its scrollbar narrowed the whole
  // screen, so the panel and the form sat 6 to 11px off where steps 2 and 3
  // put them.
  return (
    <main className="flex min-h-svh flex-1 flex-col lg:h-svh lg:flex-none lg:flex-row">
      <StoryPanel
        step={step}
        total={STEPS.length}
        question={STEPS[step].question}
        line={STEPS[step].line}
      />

      <div
        ref={column}
        data-panel-scroll
        className="bg-panel flex flex-1 flex-col lg:min-h-0 lg:flex-[7] lg:[scrollbar-gutter:stable_both-edges] lg:overflow-y-auto"
      >
        <form action={signOut} className="flex justify-end px-6 pt-4">
          <Button type="submit" variant="section" size="sm">
            Sign Out
          </Button>
        </form>

        {/* Keyed on the step so each step's fields rise in. */}
        <div
          key={step}
          className="animate-rise mx-auto w-full max-w-2xl flex-1 px-6 py-6 lg:pt-[8vh]"
        >
          {step === 0 && <RoleStep answers={answers} set={set} roles={roles} places={places} />}
          {step === 1 && <PriorityStep answers={answers} set={set} />}
        </div>

        <div className="bg-panel border-border-subtle sticky bottom-0 border-t">
          <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-6 py-4">
            {step > 0 ? (
              <Button variant="outline" size="lg" shape="pill" onClick={() => goTo(step - 1)}>
                Back
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-3">
              {error && (
                <p role="alert" className="text-body text-danger">
                  {error}
                </p>
              )}
              <Button
                size="lg"
                shape="pill"
                className="min-w-32"
                disabled={!canNext || saving}
                onClick={() => (last ? finish() : goTo(step + 1))}
              >
                {saving ? "Saving…" : last ? "Continue" : "Next"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

type StepProps = { answers: FeedFilters; set: (change: Partial<FeedFilters>) => void };

function RoleStep({
  answers,
  set,
  roles,
  places,
}: StepProps & { roles: PickOption[]; places: PickOption[] }) {
  return (
    <>
      <Field Icon={RoleIcon} label="Role" required>
        <SearchPicker
          size="lg"
          label="Roles"
          placeholder="Search a role, like Software Engineer"
          empty="No role by that name."
          options={roles}
          values={answers.roles}
          onChange={(next) => set({ roles: next })}
        />
      </Field>
      <Field Icon={BriefcaseIcon} label="Job Type" required>
        <div className="grid grid-cols-2 gap-2 lg:gap-3">
          {JOB_TYPE_OPTIONS.map((o) => (
            <ChoiceTile
              key={o.value}
              pressed={answers.jobTypes.includes(o.value)}
              onClick={() => set({ jobTypes: toggle(answers.jobTypes, o.value) })}
            >
              {o.label}
            </ChoiceTile>
          ))}
        </div>
      </Field>
      <Field Icon={workStyleIcon("onsite")} label="Workplace" required>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:gap-3">
          {WORKPLACE_OPTIONS.map((o) => (
            <ChoiceTile
              key={o.value}
              Icon={workStyleIcon(o.value)}
              pressed={answers.workStyles.includes(o.value)}
              onClick={() => set({ workStyles: toggle(answers.workStyles, o.value) })}
            >
              {o.label}
            </ChoiceTile>
          ))}
        </div>
      </Field>
      <Field Icon={PinIcon} label="Location">
        <SearchPicker
          size="lg"
          label="Places"
          placeholder="Search a state or country, or leave empty for anywhere"
          empty="No place by that name has jobs."
          options={places}
          values={answers.places}
          onChange={(next) => set({ places: next })}
        />
      </Field>
    </>
  );
}

function PriorityStep({ answers, set }: StepProps) {
  const units = payUnits(answers.jobTypes);
  const payPer = units.length === 1 && answers.minPay == null ? units[0] : answers.payPer;

  return (
    <>
      <Field Icon={CoinIcon} label="Salary Range">
        <SalaryPicker
          size="lg"
          units={units}
          presets={PAY_OPTIONS}
          minPay={answers.minPay}
          maxPay={answers.maxPay}
          payPer={payPer}
          onChange={(minPay, maxPay, per) => set({ minPay, maxPay, payPer: per })}
        />
      </Field>
      <Field Icon={VisaIcon} label="Visa Sponsorship">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:gap-3">
          <ChoiceTile
            kind="radio"
            pressed={answers.visa == null}
            onClick={() => set({ visa: null })}
          >
            I Don&apos;t Need One
          </ChoiceTile>
          {VISA_OPTIONS.map((o) => (
            <ChoiceTile
              key={o.value}
              kind="radio"
              pressed={answers.visa === o.value}
              onClick={() => set({ visa: o.value })}
            >
              {o.label}
            </ChoiceTile>
          ))}
        </div>
      </Field>
    </>
  );
}

/** One question on the right: its glyph and label, a red star when it must be
 *  answered to go on, "Optional" when it need not be.
 *
 *  THE SCREEN HAS THREE TYPE SIZES, AT EVERY WIDTH: 20px for these labels,
 *  16px for every answer (tiles, chips, pills, typed text) and 14px for every
 *  note beside one. The answers' size is text-subtitle, whose own weight is
 *  600, so each answer sets its weight. */
function Field({
  Icon,
  label,
  required = false,
  children,
}: {
  Icon: Glyph;
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  const id = `field-${label.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <section
      aria-labelledby={id}
      className="border-border-subtle border-t py-8 first:border-t-0 first:pt-0"
    >
      <h2 id={id} className="text-title text-ink mb-4 flex items-center gap-2.5 font-semibold">
        <Icon className="text-ink-meta size-5 shrink-0" />
        {label}
        {required ? (
          <span className="text-danger" aria-label="required">
            *
          </span>
        ) : (
          <span className="text-body text-ink-faint ml-auto font-normal">Optional</span>
        )}
      </h2>
      {children}
    </section>
  );
}
