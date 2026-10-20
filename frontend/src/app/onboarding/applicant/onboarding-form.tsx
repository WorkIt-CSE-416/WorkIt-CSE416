"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";

import {
  EXPERIENCE_OPTIONS,
  JOB_TYPE_OPTIONS,
  NO_FILTERS,
  PAY_OPTIONS,
  payUnits,
  statesNarrowCountries,
  WORKPLACE_OPTIONS,
  type FeedFilters,
} from "@/app/(seeker)/jobs/filter-query";
import { SalaryPicker, SearchPicker, type PickOption } from "@/components/filter-controls";
import {
  BriefcaseIcon,
  CalendarIcon,
  CoinIcon,
  LevelIcon,
  PinIcon,
  RoleIcon,
  VisaIcon,
  workStyleIcon,
} from "@/components/icons";
import { Stepper } from "@/components/stepper";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import { saveAutofillAnswers, savePreferences } from "./actions";
import {
  CLEARANCE_OPTIONS,
  DISABILITY_OPTIONS,
  GENDER_OPTIONS,
  NO_ANSWERS,
  STATUS_OPTIONS,
  VETERAN_OPTIONS,
  YES_NO,
  type AutofillAnswers,
} from "./answers";
import { ChoiceTile } from "./choice-tile";
import {
  AuthorizationIcon,
  ClearanceIcon,
  DisabilityIcon,
  GenderIcon,
  StatusIcon,
  VeteranIcon,
} from "./icons";
import { SignedInAs } from "./signed-in-as";
import { ONBOARDING_STEPS } from "./steps";
import { StoryPanel } from "./story-panel";

/**
 * The applicant onboarding wizard (KAN-231): two short steps, each one's
 * question on the left (./story-panel) and the fields answering it on the
 * right, under the step rail that counts intake as the third step
 * (./steps.ts). Each new question takes focus, so a screen reader hears it.
 *
 * STEP 1'S ANSWERS ARE THE JOBS PAGE'S FILTERS. Role, experience, job type,
 * start date, workplace, location and salary are a `FeedFilters`, with the
 * same options and pickers as All Filters (components/filter-controls). Start
 * Date is asked only once Internship is picked, and dropping Internship
 * clears it: a saved season keeps only the jobs that name one, which a
 * new-grad role rarely does.
 *
 * STEP 2 IS WHAT EVERY APPLICATION ASKS (KAN-283): work authorization,
 * sponsorship, citizenship and visa status, clearance, and the voluntary
 * gender, veteran and disability self-identification (./answers). They are no
 * filter: they go to the seeker's answer bank, which auto apply fills forms
 * from. It used to be Pay & Visa; pay moved to step 1 with the rest of the
 * role, and the visa filter question left onboarding (a saved one is kept,
 * and the Jobs page still sets it).
 *
 * Continue saves step 1 as the seeker's preferences, which marks onboarding
 * done, and step 2 to the answer bank, then opens
 * intake (./bank, KAN-214), which fills the experience bank matching reads
 * and imports a resume; its Finish opens the Jobs page's Recommended view.
 * There is no resume step here: intake asks for one. Date Posted is not
 * asked: a saved "past 24 hours" would empty the feed within days.
 *
 * `initial` and `initialAnswers` are what the seeker saved, so coming back
 * from intake ("Back to Profile") edits them rather than starting over.
 */

type Glyph = ComponentType<{ className?: string }>;

/** Each step's question, and the tip Scout types in its bubble below it: a
 *  tip, not the question again, which is what made the two hard to tell
 *  apart (KAN-259). */
const STEPS: { question: ReactNode; line: string }[] = [
  {
    question: (
      <>
        To get started, <strong>what type of role</strong> are you looking for?
      </>
    ),
    line: "Hi, I'm Scout. Pick everything that fits, and I'll do the digging.",
  },
  {
    question: (
      <>
        Next, the questions <strong>every application asks</strong>.
      </>
    ),
    line: "All optional. Answer once, and I'll fill them in on every application.",
  },
];

const toggle = <T,>(values: T[], value: T) =>
  values.includes(value) ? values.filter((v) => v !== value) : [...values, value];

export function OnboardingForm({
  roles,
  places,
  seasons,
  initial = NO_FILTERS,
  initialAnswers = NO_ANSWERS,
  email,
  startStep = 0,
}: {
  roles: PickOption[];
  places: PickOption[];
  /** The Start Date options, GET /jobs/facets' seasons. */
  seasons: PickOption[];
  initial?: FeedFilters;
  /** The answer bank as saved (./saved-answers), for step 2. */
  initialAnswers?: AutofillAnswers;
  /** Who is signed in, for the line at the foot (./signed-in-as). */
  email: string | null;
  /** The step to open on: Profile when intake's Back returns here. */
  startStep?: number;
}) {
  const router = useRouter();
  const [step, setStep] = useState(startStep);
  const column = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  /** Set once the seeker changes step. The question the page opens on is not
   *  focused: nothing has changed under the reader yet. */
  const moved = useRef(false);
  const [answers, setAnswers] = useState<FeedFilters>(initial);
  const [profile, setProfile] = useState<AutofillAnswers>(initialAnswers);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (change: Partial<FeedFilters>) => setAnswers((a) => ({ ...a, ...change }));
  const last = step === STEPS.length - 1;
  // Only step 1 asks anything required.
  const canNext =
    step > 0 ||
    (answers.roles.length > 0 && answers.jobTypes.length > 0 && answers.workStyles.length > 0);

  // EACH NEW QUESTION TAKES FOCUS, so a screen reader reads it out. Focus used
  // to stay on the footer's button, which only changed its label, and the new
  // question went unannounced.
  useEffect(() => {
    if (moved.current) heading.current?.focus({ preventScroll: true });
  }, [step]);

  function goTo(next: number) {
    moved.current = true;
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
    // Only the answers changed here go to the bank: it merges them into
    // what it holds, so one this page didn't load is never erased.
    const changed = Object.fromEntries(
      Object.entries(profile).filter(
        ([key, value]) => value !== initialAnswers[key as keyof AutofillAnswers],
      ),
    );
    const [prefs, bank] = await Promise.all([
      // A picked state narrows its country, as All Filters' Apply does.
      savePreferences(statesNarrowCountries(answers)),
      saveAutofillAnswers(changed),
    ]);
    // Both writes are whole or per key, so Continue again redoes either.
    const saveError = prefs.error ?? bank.error;
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
        question={STEPS[step].question}
        line={STEPS[step].line}
        headingRef={heading}
      />

      <div
        ref={column}
        data-panel-scroll
        className="bg-panel flex flex-1 flex-col lg:min-h-0 lg:flex-[7] lg:[scrollbar-gutter:stable_both-edges] lg:overflow-y-auto"
      >
        {/* THE RAIL HEADS THE FIELDS, beside where the work is done. It was a
            thin bar and 14px grey "Step 1 of 2" at the foot of the left
            panel, the screen's smallest type, and went unnoticed (KAN-259). */}
        <div className="mx-auto w-full max-w-2xl px-6 pt-6 lg:pt-10">
          <Stepper size="lg" steps={ONBOARDING_STEPS} current={step} />
        </div>

        {/* Keyed on the step so each step's fields rise in. */}
        <div key={step} className="animate-rise mx-auto w-full max-w-2xl flex-1 px-6 py-8 lg:pt-12">
          {step === 0 && (
            <RoleStep answers={answers} set={set} roles={roles} places={places} seasons={seasons} />
          )}
          {step === 1 && (
            <ProfileStep
              answers={profile}
              set={(change) => setProfile((a) => ({ ...a, ...change }))}
            />
          )}
        </div>

        <SignedInAs email={email} className="px-6 pb-6" />

        <div className="bg-panel border-border-subtle sticky bottom-0 border-t">
          <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-6 py-4">
            {step > 0 ? (
              <Button variant="outline" size="lg" onClick={() => goTo(step - 1)}>
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
              {/* lg and rectangular, as every page's one main action is
                  (KAN-251); the wizard's two buttons were pills. */}
              <Button
                size="lg"
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
  seasons,
}: StepProps & { roles: PickOption[]; places: PickOption[]; seasons: PickOption[] }) {
  const interns = answers.jobTypes.includes("internship");
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
      <Field Icon={LevelIcon} label="Experience">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:gap-3">
          {EXPERIENCE_OPTIONS.map((o) => (
            <ChoiceTile
              key={o.value}
              pressed={answers.levels.includes(o.value)}
              onClick={() => set({ levels: toggle(answers.levels, o.value) })}
            >
              {o.label}
            </ChoiceTile>
          ))}
        </div>
      </Field>
      <Field Icon={BriefcaseIcon} label="Job Type" required>
        <div className="grid grid-cols-2 gap-2 lg:gap-3">
          {JOB_TYPE_OPTIONS.map((o) => (
            <ChoiceTile
              key={o.value}
              pressed={answers.jobTypes.includes(o.value)}
              onClick={() => {
                const jobTypes = toggle(answers.jobTypes, o.value);
                const units = payUnits(jobTypes);
                // The salary's unit starts on the one these job types fit
                // (interns /hr), and a typed range keeps its own. It is set
                // here, not forced on the picker, so the /hr /yr toggle can
                // still change it and the unit saved is the one shown.
                const unset = answers.minPay == null && answers.maxPay == null;
                set({
                  jobTypes,
                  ...(units.length === 1 && unset ? { payPer: units[0] } : {}),
                  ...(jobTypes.includes("internship") ? {} : { startTerms: [] }),
                });
              }}
            >
              {o.label}
            </ChoiceTile>
          ))}
        </div>
      </Field>
      {interns && (
        <Field Icon={CalendarIcon} label="Start Date">
          {seasons.length === 0 ? (
            <p className="text-body text-ink-meta">No start dates in the feed yet.</p>
          ) : (
            <SearchPicker
              size="lg"
              label="Start Dates"
              placeholder="Search a season, or leave empty for any"
              empty="No season by that name has jobs."
              options={seasons}
              values={answers.startTerms}
              onChange={(next) => set({ startTerms: next })}
            />
          )}
        </Field>
      )}
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
      {/* Pay is part of the role (KAN-283): its units follow the job types
          picked above. */}
      <Field Icon={CoinIcon} label="Salary Range">
        <SalaryPicker
          size="lg"
          units={payUnits(answers.jobTypes)}
          presets={PAY_OPTIONS}
          minPay={answers.minPay}
          maxPay={answers.maxPay}
          payPer={answers.payPer}
          onChange={(minPay, maxPay, per) => set({ minPay, maxPay, payPer: per })}
        />
      </Field>
    </>
  );
}

/** One of the Profile step's questions: one answer of a group, as dots. A
 *  pressed answer pressed again is cleared, since every one is optional. */
function OneOf<V extends string>({
  options,
  value,
  onChange,
  columns = 1,
}: {
  options: { value: V; label: string }[];
  value: V | null;
  onChange: (next: V | null) => void;
  columns?: 1 | 2 | 3;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-2 lg:gap-3",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-3",
      )}
    >
      {options.map((o) => (
        <ChoiceTile
          key={o.value}
          kind="radio"
          pressed={value === o.value}
          onClick={() => onChange(value === o.value ? null : o.value)}
        >
          {o.label}
        </ChoiceTile>
      ))}
    </div>
  );
}

/** Step 2 (KAN-283): what applications ask, in the order forms ask it, the
 *  voluntary self-identification last. Each hint is the question as a form
 *  words it, so the seeker knows what their answer will fill in. */
function ProfileStep({
  answers,
  set,
}: {
  answers: AutofillAnswers;
  set: (change: Partial<AutofillAnswers>) => void;
}) {
  return (
    <>
      <Field
        Icon={AuthorizationIcon}
        label="Authorization to Work"
        hint="Are you legally authorized to work in the United States?"
      >
        <OneOf
          columns={2}
          options={YES_NO}
          value={answers.work_authorized_us}
          onChange={(work_authorized_us) => set({ work_authorized_us })}
        />
      </Field>
      <Field
        Icon={VisaIcon}
        label="Visa Sponsorship"
        hint="Will you now or in the future require sponsorship for employment visa status (e.g., H-1B)?"
      >
        <OneOf
          columns={2}
          options={YES_NO}
          value={answers.needs_sponsorship}
          onChange={(needs_sponsorship) => set({ needs_sponsorship })}
        />
      </Field>
      <Field
        Icon={StatusIcon}
        label="Citizenship and Visa Status"
        hint="What is your current U.S. citizenship or visa status?"
      >
        <OneOf
          columns={2}
          options={STATUS_OPTIONS}
          value={answers.work_authorization_status}
          onChange={(work_authorization_status) => set({ work_authorization_status })}
        />
      </Field>
      <Field
        Icon={ClearanceIcon}
        label="Security Clearance"
        hint="Do you hold an active U.S. government security clearance? Most students pick None."
      >
        <OneOf
          columns={3}
          options={CLEARANCE_OPTIONS}
          value={answers.security_clearance}
          onChange={(security_clearance) => set({ security_clearance })}
        />
      </Field>
      <Field
        Icon={GenderIcon}
        label="Gender"
        hint="Voluntary self-identification. Employers ask it to meet U.S. reporting rules."
      >
        <OneOf
          columns={2}
          options={GENDER_OPTIONS}
          value={answers.gender}
          onChange={(gender) => set({ gender })}
        />
      </Field>
      <Field
        Icon={VeteranIcon}
        label="Veteran Status"
        hint="Voluntary self-identification. Employers ask it to meet U.S. reporting rules."
      >
        <OneOf
          options={VETERAN_OPTIONS}
          value={answers.veteran_status}
          onChange={(veteran_status) => set({ veteran_status })}
        />
      </Field>
      <Field
        Icon={DisabilityIcon}
        label="Disability"
        hint="Voluntary self-identification of disability (Form CC-305)."
      >
        <OneOf
          options={DISABILITY_OPTIONS}
          value={answers.disability_status}
          onChange={(disability_status) => set({ disability_status })}
        />
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
  hint,
  required = false,
  children,
}: {
  Icon: Glyph;
  label: string;
  /** A 14px note under the label: the question as forms word it. */
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  const id = `field-${label.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <section
      aria-labelledby={id}
      aria-describedby={hint ? `${id}-hint` : undefined}
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
      {hint && (
        <p id={`${id}-hint`} className="text-body text-ink-meta -mt-2 mb-4">
          {hint}
        </p>
      )}
      {children}
    </section>
  );
}
