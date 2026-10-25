"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  NO_FILTERS,
  statesNarrowCountries,
  type FeedFilters,
} from "@/app/(seeker)/jobs/filter-query";
import type { PickOption } from "@/components/filter-controls";
import { answerIcon } from "@/components/icons";
import { Stepper } from "@/components/stepper";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { previewResume, uploadResume, type ResumePreview } from "@/lib/resume-actions";

import { saveAutofillAnswers } from "@/lib/autofill-answers-actions";
import { NO_ANSWERS, PROFILE_QUESTIONS, type AutofillAnswers } from "@/lib/autofill-answers";

import { savePreferences } from "./actions";
import { ChoiceTile } from "./choice-tile";
import { ResumeStep } from "./resume-step";
import { Field, fieldId, RoleStep } from "./role-step";
import { SignedInAs } from "./signed-in-as";
import { ONBOARDING_STEPS } from "./steps";
import { StoryPanel } from "./story-panel";

/**
 * The applicant onboarding wizard (KAN-231): three short steps, each one's
 * question on the left (./story-panel) and the fields answering it on the
 * right, under the step rail (./steps.ts). Each new question takes focus, so
 * a screen reader hears it.
 *
 * STEP 1'S ANSWERS ARE THE JOBS PAGE'S FILTERS. Role, job type, start date,
 * experience level, workplace, location and salary are a `FeedFilters`, with the
 * same options and pickers as All Filters (components/filter-controls), but
 * Start Date offers upcoming seasons only (KAN-275, ./page). Start Date is
 * asked only once Internship is picked, and dropping Internship clears it: a
 * saved season keeps only the jobs that name one, which a new-grad role
 * rarely does. Date Posted is not asked: a saved "past 24 hours" would empty
 * the feed within days.
 *
 * STEP 2 IS THE RESUME, CHECKED BEFORE IT IS SAVED (KAN-372, ADR 0006;
 * ./resume-step). Read Resume shows what the parser found and saves nothing;
 * Save Resume uploads the file with `replace=matching`, so a second resume
 * replaces the first one's copies of the same entries instead of adding
 * them again. The upload saves at once, before onboarding is done; Skip goes
 * on without one. It replaced intake's chat (KAN-275 put the resume last).
 *
 * STEP 3 IS WHAT EVERY APPLICATION ASKS (KAN-283), right after the resume
 * (KAN-372): work authorization,
 * sponsorship, citizenship and visa status, clearance, and the voluntary
 * gender, Hispanic or Latino, race, veteran and disability
 * self-identification (lib/autofill-answers). They are no
 * filter: they go to the seeker's answer bank, which auto apply fills forms
 * from. It used to be Pay & Visa; pay moved to step 1 with the rest of the
 * role, and the visa filter question left onboarding (a saved one is kept,
 * and the Jobs page still sets it).
 *
 * FINISH saves step 3 to the answer bank, then step 1 as the seeker's
 * preferences, which marks onboarding done, and opens the Jobs page in its
 * Best Match order. The answer bank saves first because a finished seeker
 * is never sent back here, and only My Profile's Application Questions asks
 * them again; a failed save leaves this step to retry from, and saving again
 * changes nothing.
 *
 * `initial` and `initialAnswers` are what the seeker saved, so a finished
 * seeker who comes back edits them rather than starting over.
 */

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
        Next, <strong>upload your resume</strong> and check what I read.
      </>
    ),
    line: "Nothing is saved until you say so. No resume yet? Skip it.",
  },
  {
    question: (
      <>
        Last, the questions <strong>every application asks</strong>.
      </>
    ),
    line: "All optional. Answer once, and I'll keep them ready for your applications.",
  },
];

/** The steps by name, in ONBOARDING_STEPS' order. */
const ROLE = 0;
const RESUME = 1;
const PROFILE = 2;

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
  /** The answer bank as saved (lib/autofill-answers-actions), for step 3. */
  initialAnswers?: AutofillAnswers;
  /** Who is signed in, for the line at the foot (./signed-in-as). */
  email: string | null;
  /** The step to open on: Profile for ?step=2 (./page). */
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
  /** What the bank holds as far as this page knows: the saved answers it
   *  opened on, then whatever its last save sent. Continue sends only what
   *  differs, so after a save whose next step failed, un-picking an answer
   *  still clears it. Against the page's first props it sent nothing, and
   *  the bank kept the answer the seeker took back. */
  const bankSaved = useRef<AutofillAnswers>(initialAnswers);
  const [resume, setResume] = useState<File | null>(null);
  /** The picked file's reading, from Read Resume; cleared with the file. */
  const [preview, setPreview] = useState<ResumePreview | null>(null);
  /** The file name this visit saved, for the resume step's "Saved" line. */
  const [savedResume, setSavedResume] = useState<string | null>(null);
  // What is in flight. "reading" alone shows on the dropzone, so it never
  // says "Uploading…" for a save.
  const [busy, setBusy] = useState<"reading" | "saving" | null>(null);
  const saving = busy != null;
  const [error, setError] = useState<string | null>(null);

  const set = (change: Partial<FeedFilters>) => setAnswers((a) => ({ ...a, ...change }));
  const last = step === PROFILE;
  // Step 1 asks the required answers; the resume step's Read Resume needs a
  // file, and Skip is the way on without one.
  const canNext =
    step === ROLE
      ? answers.roles.length > 0 && answers.jobTypes.length > 0 && answers.workStyles.length > 0
      : step !== RESUME || resume != null || savedResume != null;

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

  function pickResume(file: File | null) {
    setResume(file);
    setPreview(null);
    setError(null);
  }

  function resumeForm() {
    const fd = new FormData();
    fd.append("file", resume!);
    return fd;
  }

  /** Read Resume: what the parser finds in the picked file, saving nothing. */
  async function readResume() {
    setBusy("reading");
    setError(null);
    try {
      const { preview: reading, error: readError } = await previewResume(resumeForm());
      if (!reading) return fail(readError ?? "Could not read the resume.");
      setPreview(reading);
      setBusy(null);
    } catch {
      fail("Could not reach the server. Check your connection and try again.");
    }
  }

  /** Save Resume: the confirmed upload, replacing earlier copies (ADR 0006). */
  async function saveResume() {
    setBusy("saving");
    setError(null);
    try {
      const { error: uploadError, duplicateOf } = await uploadResume(resumeForm(), {
        replaceMatching: true,
      });
      // A duplicate is already uploaded (KAN-267): an upload that reached
      // the API before a dropped connection, sent again on retry. Not a
      // reason to keep the student here.
      if (uploadError && !duplicateOf) return fail(uploadError);
      setSavedResume(resume!.name);
      pickResume(null);
      setBusy(null);
      goTo(PROFILE);
    } catch {
      fail("Could not reach the server. Check your connection and try again.");
    }
  }

  /** The resume step's main button: read the picked file, save a reading,
   *  or go on once there is nothing new to save. */
  function resumeNext() {
    if (preview?.duplicate_of) {
      setSavedResume(preview.duplicate_of.name);
      pickResume(null);
      goTo(PROFILE);
    } else if (preview) saveResume();
    else if (resume) readResume();
    else goTo(PROFILE);
  }

  const resumeLabel =
    busy === "reading"
      ? "Reading…"
      : preview
        ? preview.duplicate_of
          ? "Next"
          : "Save Resume"
        : resume || !savedResume
          ? "Read Resume"
          : "Next";

  /** Saves the answer bank, then the preferences, which finish onboarding.
   *  A failure leaves this page to retry from. */
  async function finish() {
    setBusy("saving");
    setError(null);
    // Each action catches its own API failures, but the call to the action
    // can itself fail (the connection drops, the Next server is down). That
    // left Continue disabled on "Saving…" with no message.
    try {
      // Only the answers changed here go to the bank: it merges them into
      // what it holds, so one this page didn't load is never erased.
      const sent = profile;
      const changed = Object.fromEntries(
        Object.entries(sent).filter(
          ([key, value]) => value !== bankSaved.current[key as keyof AutofillAnswers],
        ),
      );
      const { error: bankError } = await saveAutofillAnswers(changed);
      if (bankError) return fail(bankError);
      bankSaved.current = sent;
      // A picked state narrows its country, as All Filters' Apply does.
      const { error: saveError } = await savePreferences(statesNarrowCountries(answers));
      if (saveError) return fail(saveError);
      router.push("/jobs");
    } catch {
      fail("Could not reach the server. Check your connection and try again.");
    }
  }

  function fail(message: string) {
    setBusy(null);
    setError(message);
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
          {step === ROLE && (
            <RoleStep answers={answers} set={set} roles={roles} places={places} seasons={seasons} />
          )}
          {step === RESUME && (
            <ResumeStep
              file={resume}
              onFileChange={pickResume}
              onRemove={() => pickResume(null)}
              reading={busy === "reading"}
              preview={preview}
              savedName={savedResume}
            />
          )}
          {step === PROFILE && (
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
              <Button variant="outline" size="lg" disabled={saving} onClick={() => goTo(step - 1)}>
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
              {step === RESUME && preview && (
                <Button
                  variant="outline"
                  size="lg"
                  disabled={saving}
                  onClick={() => pickResume(null)}
                >
                  Choose Another File
                </Button>
              )}
              {step === RESUME && !preview && !savedResume && (
                <Button
                  variant="outline"
                  size="lg"
                  disabled={saving}
                  onClick={() => {
                    pickResume(null);
                    goTo(PROFILE);
                  }}
                >
                  Skip
                </Button>
              )}
              {/* lg and rectangular, as every page's one main action is
                  (KAN-251); the wizard's two buttons were pills. */}
              <Button
                size="lg"
                className="min-w-32"
                disabled={!canNext || saving}
                onClick={() => (last ? finish() : step === RESUME ? resumeNext() : goTo(step + 1))}
              >
                {busy === "saving"
                  ? "Saving…"
                  : last
                    ? "Finish"
                    : step === RESUME
                      ? resumeLabel
                      : "Next"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

/** One of the Profile step's questions: one answer of a group, as dots. A
 *  pressed answer pressed again is cleared, since every one is optional. */
function OneOf<V extends string>({
  options,
  value,
  onChange,
  columns = 1,
  labelledBy,
  describedBy,
}: {
  options: { value: V; label: string }[];
  value: V | null;
  onChange: (next: V | null) => void;
  columns?: 1 | 2 | 3;
  /** The Field's heading and question (fieldId), named on the group itself:
   *  a screen reader reads a group's name and description as focus enters
   *  it, where it skipped a description on the section around it, and
   *  "Yes" was read with no question. */
  labelledBy: string;
  describedBy: string;
}) {
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
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

/** Step 3 (KAN-283): lib/autofill-answers' PROFILE_QUESTIONS, each under the question as
 *  forms word it, so the seeker knows what their answer will fill in. */
function ProfileStep({
  answers,
  set,
}: {
  answers: AutofillAnswers;
  set: (change: Partial<AutofillAnswers>) => void;
}) {
  return (
    <>
      {PROFILE_QUESTIONS.map((q) => (
        <Field key={q.key} Icon={answerIcon(q.key)} label={q.label} hint={q.question}>
          <OneOf
            labelledBy={fieldId(q.label)}
            describedBy={`${fieldId(q.label)}-hint`}
            columns={q.columns}
            options={q.options}
            value={answers[q.key]}
            // The key's own options, so the value is one of its answers.
            onChange={(next) => set({ [q.key]: next } as Partial<AutofillAnswers>)}
          />
        </Field>
      ))}
    </>
  );
}
