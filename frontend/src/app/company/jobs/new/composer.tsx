"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { TextField } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

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
import { LocationField, SelectField, TextAreaField } from "./fields";
import { EyeIcon } from "./icons";
import { JobPreview } from "./preview";
import { ScreeningQuestions } from "./screening-questions";
import { Stepper } from "./stepper";

/**
 * /company/jobs/new — the screen behind the top bar's "Post a Job".
 *
 * WHY THIS IS ONE CLIENT COMPONENT AND NOT TWO COLUMNS OF SERVER MARKUP: the
 * preview is live. Both columns read the same draft, so the draft has to live
 * above both of them, and the split runs down the middle of the page rather
 * than along a server/client seam. The page file stays a server component and
 * this is the only thing it renders.
 *
 * ALL THREE STEPS EXIST NOW, so moving between them (`step` state) is real
 * navigation, not the single dead rail the mockup drew. The Live Preview only
 * mounts on Publish — see `isPublishStep` — because it has nothing to show
 * before then and would otherwise trail every step as a sidebar with nothing
 * to preview yet. `Save Draft` and the final `Publish` stay inert: there is
 * still no backend, and a button that pretends to save or go live is worse
 * than one that visibly does not.
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
 */
export function Composer() {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<JobDraft>(EMPTY_DRAFT);
  const [questions, setQuestions] = useState<ScreeningQuestion[]>(INITIAL_QUESTIONS);
  const [locations, setLocations] = useState<SavedLocation[]>(SAVED_LOCATIONS);

  function set<K extends keyof JobDraft>(key: K, value: JobDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function addLocation(location: Omit<SavedLocation, "id">) {
    const id = `${location.city.toLowerCase().replace(/\s+/g, "-")}-${location.country.toLowerCase()}`;
    setLocations((current) => [...current, { id, ...location }]);
    return id;
  }

  const isRemote = draft.workStyle === "Remote";
  /** The preview simulates the posting as a seeker will see it once it is
   *  live — it has nothing to show before Publish exists, so it only mounts
   *  there rather than trailing every step as a permanent sidebar. */
  const isPublishStep = step === STEPS.length - 1;

  return (
    <div className="max-w-app mx-auto w-full flex-1 px-6 py-6 sm:px-12">
      {/* items-start so the preview column can go sticky — a stretched grid
          item is already as tall as the row and has nothing to stick within.
          The form column is given the larger share and both tracks are
          minmax(0,…) so a long unbroken word cannot push a column wider than
          its share. Single column on Basic Details and Screening: there is no
          second thing to sit beside the form until the preview joins it on
          Publish. */}
      <div
        className={cn(
          "grid grid-cols-1 items-start gap-6",
          isPublishStep && "lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]",
        )}
      >
        <div className="min-w-0">
          <header>
            <h1 className="text-heading text-ink">Post a New Job</h1>
            <p className="text-body text-ink-meta mt-1">
              Fill out the details below to create a new job posting.
            </p>
          </header>

          <Stepper steps={STEPS} current={step} className="mt-4" />

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
                    value={draft.title}
                    onChange={(event) => set("title", event.target.value)}
                  />

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <SelectField
                      id="department"
                      label="Department"
                      value={draft.department}
                      onValueChange={(department) => set("department", department)}
                      options={DEPARTMENTS}
                    />

                    <SelectField
                      id="work-style"
                      label="Work Style"
                      value={draft.workStyle}
                      onValueChange={(workStyle) => set("workStyle", workStyle)}
                      options={WORK_STYLES}
                    />
                  </div>

                  {!isRemote && (
                    <LocationField
                      id="location"
                      label="Location"
                      value={draft.locationId}
                      onValueChange={(locationId) => set("locationId", locationId)}
                      options={locations}
                      onAddLocation={addLocation}
                    />
                  )}

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <SelectField
                      id="job-type"
                      label="Job Type"
                      value={draft.jobType}
                      onValueChange={(jobType) => set("jobType", jobType)}
                      options={JOB_TYPES}
                    />

                    <SelectField
                      id="experience-level"
                      label="Experience Level"
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
                      placeholder="125,000"
                      value={draft.salary}
                      onValueChange={(value) => set("salary", value)}
                    />
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <NumberField
                        id="salary-min"
                        label="Salary Min"
                        placeholder="100,000"
                        value={draft.salaryMin}
                        onValueChange={(value) => set("salaryMin", value)}
                      />

                      <NumberField
                        id="salary-max"
                        label="Salary Max"
                        placeholder="150,000"
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
                    value={draft.description}
                    onChange={(event) => set("description", event.target.value)}
                  />
                </div>
              </section>
            )}

            {step === 1 && (
              <div className="p-4.5">
                <ScreeningQuestions questions={questions} onChange={setQuestions} />
              </div>
            )}

            {isPublishStep && (
              <section className="p-4.5">
                <SectionHeading as="h2" className="border-border-subtle border-b pb-3">
                  Ready to Publish
                </SectionHeading>

                <div className="mt-4 flex flex-col gap-4">
                  <p className="text-body text-ink-meta">
                    Check the live preview on the right against what you entered, then publish the
                    role or save it as a draft to come back to.
                  </p>

                  <TextField
                    id="closes-at"
                    label="Applications Close (optional)"
                    type="date"
                    value={draft.closesAt}
                    onChange={(event) => set("closesAt", event.target.value)}
                  />
                </div>
              </section>
            )}

            <hr className="border-border-subtle mx-4.5" />

            <div className="flex flex-wrap items-center justify-end gap-3 p-4.5">
              {step > 0 && (
                <Button variant="secondary" onClick={() => setStep(step - 1)}>
                  Back
                </Button>
              )}

              <Button variant="secondary">Save Draft</Button>

              {step === 0 && <Button onClick={() => setStep(1)}>Continue to Screening</Button>}
              {step === 1 && <Button onClick={() => setStep(2)}>Continue to Publish</Button>}
              {/* No backend yet, so this stays inert like Save Draft always
                  has — see the note above the component. */}
              {isPublishStep && <Button variant="positive">Publish</Button>}
            </div>
          </Card>
        </div>

        {/* top-6 is the page's own py-6, and nothing more. A sticky offset is
            measured from its scroll container, and the shell's scroller now
            starts below the bar rather than at the top of the window — so
            clearing --company-bar as well, which is what this used to do, would
            park the panel a bar's height too low. */}
        {isPublishStep && (
          <aside className="min-w-0 lg:sticky lg:top-6">
            <h2 className="text-title text-ink flex items-center gap-2">
              <EyeIcon className="text-ink-meta size-4.5" />
              Live Preview
            </h2>

            <div className="mt-4">
              <JobPreview draft={draft} locations={locations} />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

/**
 * A number input that only accepts digits and shows them grouped.
 *
 * Grouping as you type rather than on blur is what makes the placeholder's
 * "100,000" the truth about the field instead of a hint it contradicts the
 * moment you use it. The draft keeps the bare digits, so ./preview.tsx can
 * parse without stripping separators back out. Used for salary and for min
 * years experience alike — grouping a one- or two-digit number is a no-op.
 */
function NumberField({
  id,
  label,
  placeholder,
  value,
  onValueChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <TextField
      id={id}
      label={label}
      placeholder={placeholder}
      /* inputMode over type="number": a number input brings spinners, accepts
         "1e5", and refuses the thousands separators shown below. This wants a
         numeric keypad on a phone and nothing else. */
      inputMode="numeric"
      value={value === "" ? "" : Number(value).toLocaleString("en-US")}
      onChange={(event) => onValueChange(event.target.value.replace(/\D/g, ""))}
    />
  );
}
