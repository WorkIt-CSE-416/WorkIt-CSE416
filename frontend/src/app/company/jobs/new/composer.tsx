"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type MouseEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { TextField } from "@/components/ui/text-field";
import { changeJobStatus, saveJob, type JobPayload } from "@/lib/job-actions";
import type { CompanyJob } from "@/lib/job-queries";

import {
  DEPARTMENTS,
  EMPTY_DRAFT,
  EXPERIENCE_LEVELS,
  INITIAL_QUESTIONS,
  JOB_TYPES,
  SALARY_PERIODS,
  SALARY_TYPES,
  CURRENCIES,
  SAVED_LOCATIONS,
  STEPS,
  WORK_STYLES,
  type JobDraft,
  type SavedLocation,
  type ScreeningQuestion,
} from "./data";
import { SelectField } from "@/components/ui/select-field";

import { DateField, LocationField, TextAreaField } from "./fields";
import { EyeIcon } from "./icons";
import { fromCompanyJob, toJobPayload } from "./payload";
import { JobPreview } from "./preview";
import { ScreeningQuestions } from "./screening-questions";
import { Stepper } from "./stepper";
import { CloseJobDialog } from "../close-job-dialog";
import { STATUS_LABEL, STATUS_TONE } from "../data";

/** STEPS for a job that is already live: nothing is left to publish. */
const LIVE_STEPS = ["Basic Details", "Screening", "Review"] as const;

/**
 * /company/jobs/new — the screen behind the top bar's "Post a Job".
 *
 * WHY THIS IS ONE CLIENT COMPONENT RATHER THAN SERVER MARKUP: the preview is
 * live. It reads the same draft the form writes to, so the draft has to live
 * above both of them. The page file stays a server component and this is the
 * only thing it renders.
 *
 * ALL THREE STEPS EXIST NOW, so moving between them (`step` state) is real
 * navigation, not the single dead rail the mockup drew. The Live Preview only
 * mounts on Publish — see `isPublishStep` — because it has nothing to show
 * before then and would otherwise sit above every step with nothing to
 * preview yet. It is stacked above the form rather than beside it: what it
 * shows is the thing being confirmed before Publish, not a running sidebar
 * for a field still being typed into. `Save Draft` and `Publish` both save
 * through /company/jobs (see `save`), differing only in the status they ask
 * for, and land back on /company/jobs so the saved row is the first thing seen.
 * Screening questions are not sent: no table holds them yet.
 *
 * SAVED LOCATIONS LIVE HERE, NOT IN THE DRAFT. A location a recruiter adds
 * belongs to the company, not to this one posting — it has to survive if the
 * draft is discarded and be there the next time someone posts a role. Real
 * data would fetch and mutate it server-side; this fixture keeps it in a
 * sibling `useState` so <LocationField>'s "Add a new location" is not a dead
 * end.
 *
 * WHAT IS SCHEMA-SHAPED NOW, AND WHY, is explained field by field at the top
 * of ./data.ts. The short version: Department stays its own field, kept
 * internal and off the job card a seeker sees; Location is picked rather than
 * free text; Employment Type split into Job Type and Experience Level; and
 * Salary gained a type toggle plus currency and period.
 *
 * EDITING REUSES THIS SCREEN. /company/jobs/[jobId]/edit passes the saved
 * `job`, which fills the form and makes both buttons update it instead of
 * creating a new one. The form is built from it here, in the browser, not on
 * the server: `closes_at` becomes a calendar day in the recruiter's own
 * timezone, and a UTC server would hand back the next day to anyone in the
 * Americas, so every save would push the date a day later. The initializer
 * runs again during hydration, and the date only renders on the last step,
 * so the server's version never reaches the screen. A published job can't go back to draft, and
 * is already live, so editing one drops the publishing language entirely: the
 * last step is Review, and the one primary action is Update Job, offered on
 * every step so a quick fix needn't walk through all three.
 *
 * STATUS SITS UNDER THE TITLE, APART FROM THE FORM. Pause, Resume and Close
 * act at once through their own route and never save form edits along with
 * them, so they live beside the status badge rather than among the save
 * buttons, and unsaved edits survive a pause. A closed job is final: the form
 * still opens so it can be read, but nothing saves.
 */
export function Composer({ job }: { job?: CompanyJob }) {
  const [editing, setEditing] = useState(
    () =>
      job && {
        id: job.id,
        status: job.status,
        updatedAt: job.updated_at,
        ...fromCompanyJob(job),
      },
  );
  const initialDraft = editing?.draft ?? EMPTY_DRAFT;
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<JobDraft>(initialDraft);
  const [questions, setQuestions] = useState<ScreeningQuestion[]>(INITIAL_QUESTIONS);
  const [locations, setLocations] = useState<SavedLocation[]>(
    editing ? [editing.location, ...SAVED_LOCATIONS] : SAVED_LOCATIONS,
  );
  const isLive = editing !== undefined && editing.status !== "draft";
  const steps = isLive ? LIVE_STEPS : STEPS;
  const isClosed = editing?.status === "closed";
  const [isClosing, setIsClosing] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isChangingStatus, startChangingStatus] = useTransition();

  /** Pause or Resume. The badge and the next save's updatedAt both follow
   *  the response, since `editing` is built once and a refresh wouldn't
   *  reach it; the form's own edits are left alone. */
  function setStatus(id: string, status: "published" | "paused") {
    setStatusError(null);
    startChangingStatus(async () => {
      const result = await changeJobStatus(id, status);
      if (result.error || !result.updatedAt) {
        setStatusError(result.error);
        return;
      }
      const updatedAt = result.updatedAt;
      setEditing((current) => current && { ...current, status, updatedAt });
    });
  }
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();
  const router = useRouter();

  /** Questions count too, though they aren't saved yet: losing them to a
   *  stray reload is still losing work. A closed job can't be saved, so
   *  there is nothing to lose there. */
  const isDirty =
    !isClosed &&
    (JSON.stringify(draft) !== JSON.stringify(initialDraft) || questions !== INITIAL_QUESTIONS);

  // Reloading or closing the tab with unsaved edits asks first. In-app links
  // don't fire beforeunload, so Cancel asks for itself (see `confirmLeave`).
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  function confirmLeave(event: MouseEvent) {
    if (isDirty && !window.confirm("Discard your unsaved changes?")) event.preventDefault();
  }

  function set<K extends keyof JobDraft>(key: K, value: JobDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function addLocation(location: Omit<SavedLocation, "id">) {
    const id = `${location.city.toLowerCase().replace(/\s+/g, "-")}-${location.country.toLowerCase()}`;
    setLocations((current) => [...current, { id, ...location }]);
    return id;
  }

  const isRemote = draft.workStyle === "Remote";
  const isHourly = draft.salaryPeriod === "Hour";
  /** The preview simulates the posting as a seeker will see it once it is
   *  live — it has nothing to show before Publish exists, so it only mounts
   *  there rather than trailing every step as a permanent sidebar. */
  const isPublishStep = step === STEPS.length - 1;

  /**
   * What `job_postings` actually requires — see EMPTY_DRAFT in ./data.ts for
   * why Work Style/Job Type/Experience Level can be blank here at all (Currency
   * and Pay Period are NOT NULL too, but the schema itself defaults them, so
   * this form does too, and there is nothing to catch for them). Location is
   * required even for Remote because `location_country` is NOT NULL: a remote
   * posting still names the country it hires in. The salary amount fields
   * follow the `salary_exist` CHECK, which wants either `salary` alone or
   * `salary_min` AND `salary_max` together.
   */
  const missingFields: string[] = [];
  if (!draft.title.trim()) missingFields.push("Job Title");
  if (!draft.workStyle) missingFields.push("Work Style");
  if (!draft.locationId) missingFields.push("Location");
  if (!draft.jobType) missingFields.push("Job Type");
  if (!draft.experienceLevel) missingFields.push("Experience Level");
  if (draft.salaryType === "Exact figure") {
    if (isBlankNumber(draft.salary)) missingFields.push("Salary Amount");
  } else {
    if (isBlankNumber(draft.salaryMin)) missingFields.push("Salary Min");
    if (isBlankNumber(draft.salaryMax)) missingFields.push("Salary Max");
  }
  if (!draft.description.trim()) missingFields.push("Job Description");

  /** The API's other limits, caught here so they name the field. Its 422s
   *  only say "Input should be less than or equal to 50", and the preview
   *  would otherwise show "$150k – $100k" before that. Title's 200 is held by
   *  the input's maxLength. */
  const invalidFields: string[] = [];
  if (
    draft.salaryType === "Range" &&
    !isBlankNumber(draft.salaryMin) &&
    !isBlankNumber(draft.salaryMax) &&
    Number(draft.salaryMin) > Number(draft.salaryMax)
  )
    invalidFields.push("Salary Min can't be more than Salary Max");
  if (draft.experienceLevel === "Experienced" && Number(draft.minYearsExperience) > 50)
    invalidFields.push("Min Years Experience can be at most 50");
  const canLeaveBasicDetails = missingFields.length === 0 && invalidFields.length === 0;

  /** Every required field lives on Basic Details, so a draft that can leave
   *  it is one the API will accept. Pending blocks a second click from
   *  posting the same job twice. */
  function save(status: JobPayload["status"]) {
    setSaveError(null);
    startSaving(async () => {
      const { error } = await saveJob(
        toJobPayload(draft, locations, status),
        editing && { id: editing.id, updatedAt: editing.updatedAt },
      );
      if (error) {
        setSaveError(error);
        return;
      }
      router.push("/company/jobs");
    });
  }

  return (
    <div className="max-w-app mx-auto w-full flex-1 px-6 py-6 sm:px-12">
      <div className="min-w-0">
        <header>
          <h1 className="text-heading text-ink">{editing ? "Edit Job" : "Post a New Job"}</h1>
          <p className="text-body text-ink-meta mt-1">
            {editing
              ? "Change the details below, then save."
              : "Fill out the details below to create a new job posting."}
          </p>

          {editing && isLive && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Badge variant="status" tone={STATUS_TONE[STATUS_LABEL[editing.status]]}>
                {STATUS_LABEL[editing.status]}
              </Badge>
              {isClosed ? (
                <p className="text-meta text-ink-meta">
                  This job is closed, so it can no longer be edited.
                </p>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isChangingStatus}
                    onClick={() =>
                      setStatus(editing.id, editing.status === "paused" ? "published" : "paused")
                    }
                  >
                    {editing.status === "paused" ? "Resume" : "Pause"}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setIsClosing(true)}>
                    Close job
                  </Button>
                  <CloseJobDialog
                    jobId={editing.id}
                    title={editing.draft.title}
                    open={isClosing}
                    onOpenChange={setIsClosing}
                    onClosed={() => router.push("/company/jobs")}
                  />
                </>
              )}
              {statusError && <p className="text-meta text-danger">{statusError}</p>}
            </div>
          )}
        </header>

        <Stepper steps={steps} current={step} className="mt-4" />

        {/* Above the form on Publish, not beside it — it is what the posting
            will look like once it is live, which reads as the thing being
            confirmed rather than as a sidebar chasing the field being typed
            into. */}
        {isPublishStep && (
          <div className="mt-5">
            <h2 className="text-title text-ink flex items-center gap-2">
              <EyeIcon className="text-ink-meta size-4.5" />
              Live Preview
            </h2>

            <div className="mt-4">
              <JobPreview draft={draft} locations={locations} />
            </div>
          </div>
        )}

        {/* padding="none" because the card's own rules have to sit inside the
              padding, not run edge to edge — so each block pads itself. */}
        <Card padding="none" className="mt-5">
          {step === 0 && (
            <section className="p-4.5">
              <SectionHeading as="h2" className="border-border-subtle border-b pb-3">
                Basic Information
              </SectionHeading>

              <div className="mt-4 flex flex-col gap-4">
                <TextField
                  id="job-title"
                  label="Job Title"
                  placeholder="e.g. Senior Frontend Engineer"
                  required
                  maxLength={200}
                  value={draft.title}
                  onChange={(event) => set("title", event.target.value)}
                />

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* No column holds department or city yet, so both are
                      labelled rather than silently dropped on save. */}
                  <SelectField
                    id="department"
                    label="Department (not saved yet)"
                    value={draft.department}
                    onValueChange={(department) => set("department", department)}
                    options={DEPARTMENTS}
                  />

                  <SelectField
                    id="work-style"
                    label="Work Style"
                    placeholder="Choose Work Style"
                    required
                    value={draft.workStyle}
                    onValueChange={(workStyle) => set("workStyle", workStyle)}
                    options={WORK_STYLES}
                  />
                </div>

                {/* Required for Remote too: "remote" usually means "remote,
                    but based in the United States", and the table stores a
                    country for every posting. On a Remote posting the preview
                    shows just the country (see ./preview.tsx's
                    `locationLabel`), since a remote hire isn't tied to the
                    city a saved location happens to carry. */}
                <LocationField
                  id="location"
                  label="Location"
                  placeholder={isRemote ? "Where hires must be based" : "Select a location"}
                  required
                  value={draft.locationId}
                  onValueChange={(locationId) => set("locationId", locationId)}
                  options={locations}
                  onAddLocation={addLocation}
                />
                <p className="text-meta text-ink-faint -mt-3">
                  Only the country is saved for now. The city isn&apos;t stored yet.
                </p>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <SelectField
                    id="job-type"
                    label="Job Type"
                    placeholder="Choose Job Type"
                    required
                    value={draft.jobType}
                    onValueChange={(jobType) => set("jobType", jobType)}
                    options={JOB_TYPES}
                  />

                  <SelectField
                    id="experience-level"
                    label="Experience Level"
                    placeholder="Choose Experience Level"
                    required
                    value={draft.experienceLevel}
                    onValueChange={(experienceLevel) => set("experienceLevel", experienceLevel)}
                    options={EXPERIENCE_LEVELS}
                  />

                  {draft.experienceLevel === "Experienced" && (
                    <NumberField
                      id="min-years-experience"
                      label="Min Years Experience"
                      placeholder="5"
                      value={draft.minYearsExperience}
                      onValueChange={(value) => set("minYearsExperience", value)}
                    />
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <SelectField
                    id="salary-type"
                    label="Salary"
                    value={draft.salaryType}
                    onValueChange={(salaryType) => set("salaryType", salaryType)}
                    options={SALARY_TYPES}
                  />

                  <SelectField
                    id="currency"
                    label="Currency"
                    value={draft.currency}
                    onValueChange={(currency) => set("currency", currency)}
                    options={CURRENCIES}
                  />

                  <SelectField
                    id="salary-period"
                    label="Pay Period"
                    value={draft.salaryPeriod}
                    onValueChange={(salaryPeriod) => set("salaryPeriod", salaryPeriod)}
                    options={SALARY_PERIODS}
                  />
                </div>

                {draft.salaryType === "Exact figure" ? (
                  <NumberField
                    id="salary"
                    label="Amount"
                    placeholder={isHourly ? "20" : "100,000"}
                    allowDecimal={isHourly}
                    required
                    value={draft.salary}
                    onValueChange={(value) => set("salary", value)}
                  />
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <NumberField
                      id="salary-min"
                      label="Salary Min"
                      placeholder={isHourly ? "20" : "100,000"}
                      allowDecimal={isHourly}
                      required
                      value={draft.salaryMin}
                      onValueChange={(value) => set("salaryMin", value)}
                    />

                    <NumberField
                      id="salary-max"
                      label="Salary Max"
                      placeholder={isHourly ? "20" : "100,000"}
                      allowDecimal={isHourly}
                      required
                      value={draft.salaryMax}
                      onValueChange={(value) => set("salaryMax", value)}
                    />
                  </div>
                )}

                <TextAreaField
                  id="job-description"
                  label="Job Description"
                  placeholder="Describe the role, responsibilities, and requirements…"
                  hint="Use Markdown for formatting."
                  required
                  value={draft.description}
                  onChange={(event) => set("description", event.target.value)}
                />
              </div>
            </section>
          )}

          {step === 1 && (
            <div className="p-4.5">
              <p className="text-meta text-ink-meta mb-4">
                Screening questions aren&apos;t saved yet. You can draft them here, but they
                won&apos;t be kept with the job.
              </p>
              <ScreeningQuestions questions={questions} onChange={setQuestions} />
            </div>
          )}

          {isPublishStep && (
            <section className="p-4.5">
              <SectionHeading as="h2" className="border-border-subtle border-b pb-3">
                {isLive ? "Review Changes" : "Ready to Publish"}
              </SectionHeading>

              <div className="mt-4 flex flex-col gap-4">
                <p className="text-body text-ink-meta">
                  {isLive
                    ? "Check the live preview above, then update the job. Applicants see the changes right away."
                    : "Check the live preview above against what you entered, then publish the role or save it as a draft to come back to."}
                </p>

                <DateField
                  id="closes-at"
                  label="Applications Close (optional)"
                  value={draft.closesAt}
                  onValueChange={(value) => set("closesAt", value)}
                />
              </div>
            </section>
          )}

          {/* Only on step 0: Screening and Publish have nothing this form
              considers required (see the note by `missingFields`), so there
              is never anything to report on the steps that show this. */}
          {step === 0 && missingFields.length > 0 && (
            <p className="text-meta text-danger px-4.5 pt-3">
              Complete the required fields to continue: {missingFields.join(", ")}.
            </p>
          )}
          {step === 0 &&
            invalidFields.map((problem) => (
              <p key={problem} className="text-meta text-danger px-4.5 pt-3">
                {problem}.
              </p>
            ))}

          {saveError && <p className="text-meta text-danger px-4.5 pt-3">{saveError}</p>}

          <hr className="border-border-subtle mx-4.5" />

          <div className="flex flex-wrap items-center justify-end gap-3 p-4.5">
            {step > 0 && (
              <Button variant="secondary" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}

            {/* Every mode gets a way out, a new job and a draft included. */}
            <ButtonLink href="/company/jobs" variant="ghost" onClick={confirmLeave}>
              Cancel
            </ButtonLink>

            {isLive ? (
              <>
                {!isPublishStep && (
                  <Button
                    variant="secondary"
                    onClick={() => setStep(step + 1)}
                    disabled={step === 0 && !canLeaveBasicDetails}
                  >
                    Continue to {steps[step + 1]}
                  </Button>
                )}
                {!isClosed && (
                  <Button
                    onClick={() => save("published")}
                    disabled={!canLeaveBasicDetails || isSaving}
                  >
                    Update Job
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  onClick={() => save("draft")}
                  disabled={!canLeaveBasicDetails || isSaving}
                >
                  Save Draft
                </Button>

                {step === 0 && (
                  <Button onClick={() => setStep(1)} disabled={!canLeaveBasicDetails}>
                    Continue to Screening
                  </Button>
                )}
                {step === 1 && <Button onClick={() => setStep(2)}>Continue to Publish</Button>}
                {isPublishStep && (
                  <Button
                    variant="positive"
                    onClick={() => save("published")}
                    disabled={!canLeaveBasicDetails || isSaving}
                  >
                    Publish
                  </Button>
                )}
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * A number input that only accepts digits (plus, optionally, one decimal
 * point) and shows them grouped.
 *
 * Grouping as you type rather than on blur is what makes the placeholder's
 * "100,000" the truth about the field instead of a hint it contradicts the
 * moment you use it. The draft keeps the bare digits, so ./preview.tsx can
 * parse without stripping separators back out. Used for salary and for min
 * years experience alike — grouping a one- or two-digit number is a no-op.
 *
 * `allowDecimal` defaults off: a year-scale salary or a years-of-experience
 * count is never typed with cents. The composer turns it on for the salary
 * fields specifically when Pay Period is Hour — $27.50/hr is an ordinary
 * hourly rate, and without this the sanitizer below would strip the "." and
 * silently turn it into $2,750.
 */
function NumberField({
  id,
  label,
  placeholder,
  value,
  onValueChange,
  allowDecimal = false,
  required,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onValueChange: (value: string) => void;
  allowDecimal?: boolean;
  required?: boolean;
}) {
  return (
    <TextField
      id={id}
      label={label}
      placeholder={placeholder}
      required={required}
      /* inputMode over type="number": a number input brings spinners, accepts
         "1e5", and refuses the thousands separators shown below. This wants a
         numeric keypad on a phone and nothing else. `decimal` swaps in the
         "." key mobile keyboards otherwise leave out. */
      inputMode={allowDecimal ? "decimal" : "numeric"}
      value={formatNumericDisplay(value, allowDecimal)}
      onChange={(event) => onValueChange(sanitizeNumeric(event.target.value, allowDecimal))}
    />
  );
}

/** Nothing typed, or only the "." on the way to "27.50": no amount yet. */
function isBlankNumber(value: string) {
  return value === "" || value === ".";
}

/** Digits only, or digits with at most one "." and two digits after it. */
function sanitizeNumeric(raw: string, allowDecimal: boolean) {
  if (!allowDecimal) return raw.replace(/\D/g, "");

  const cleaned = raw.replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned;

  const whole = cleaned.slice(0, dot).replace(/\./g, "");
  const fraction = cleaned
    .slice(dot + 1)
    .replace(/\./g, "")
    .slice(0, 2);
  return `${whole}.${fraction}`;
}

/**
 * The grouped display string for a value `sanitizeNumeric` produced.
 *
 * Not `Number(value).toLocaleString()` when decimals are allowed: that
 * round-trip through `Number` collapses "27." back to "27" the instant it is
 * typed, which makes the decimal point impossible to type at all — there is
 * no state in which it survives long enough for a digit to follow it. Only
 * the whole-number part is grouped through `Number`; the fraction (including
 * a still-empty one right after the ".") is kept exactly as typed.
 */
function formatNumericDisplay(value: string, allowDecimal: boolean) {
  if (value === "") return "";
  if (!allowDecimal) return Number(value).toLocaleString("en-US");

  const [whole, fraction] = value.split(".");
  const groupedWhole = whole === "" ? "0" : Number(whole).toLocaleString("en-US");
  return fraction === undefined ? groupedWhole : `${groupedWhole}.${fraction}`;
}
