"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { TextField } from "@/components/ui/text-field";

import {
  DEPARTMENTS,
  EMPLOYMENT_TYPES,
  EMPTY_DRAFT,
  INITIAL_QUESTIONS,
  STEPS,
  type JobDraft,
  type ScreeningQuestion,
} from "./data";
import { SelectField, TextAreaField } from "./fields";
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
 * WHAT IS INERT, and why that is deliberate rather than unfinished: Save Draft
 * and Continue do nothing, exactly as the seeker screens' Apply Now and filters
 * do nothing. There is no backend, and a button that pretends to save is worse
 * than one that visibly does not. What *is* wired is everything the screen can
 * honestly do on its own — every field, the preview, and the screening list's
 * add, edit, delete and reorder.
 *
 * TWO PLACES THE MOCKUP AND THIS DISAGREE, both noted rather than silently
 * resolved:
 *
 *   - The mockup's primary button reads "Continue to Rubrics" while its own
 *     rail calls step 2 "Screening". Only one can be right and nothing behind
 *     either exists yet, so the button follows the rail — a button naming a
 *     step the rail does not have is a bug a reader hits immediately, and the
 *     rail is the thing repeated on all three screens.
 *
 *   - The mockup has no employment-type field, but its preview shows a
 *     "Full-time" pill. A preview showing a value the form cannot set is a
 *     preview that lies, so the field exists here, sharing a row with the
 *     salary pair. That row is 3-up where the mockup draws 2-up; rows one and
 *     two are as drawn.
 *
 * The description hint promises Markdown and nothing renders it. That is the
 * mockup's copy and the intended behaviour, so it stays — the preview shows the
 * raw text until a renderer lands, which is one component in ./preview.tsx.
 */
export function Composer() {
  const [draft, setDraft] = useState<JobDraft>(EMPTY_DRAFT);
  const [questions, setQuestions] = useState<ScreeningQuestion[]>(INITIAL_QUESTIONS);

  function set<K extends keyof JobDraft>(key: K, value: JobDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="max-w-app mx-auto w-full flex-1 px-6 py-6 sm:px-12">
      {/* items-start so the preview column can go sticky — a stretched grid
          item is already as tall as the row and has nothing to stick within.
          The form column is given the larger share and both tracks are
          minmax(0,…) so a long unbroken word cannot push a column wider than
          its share. */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <header>
            <h1 className="text-heading text-ink">Post a New Job</h1>
            <p className="text-body text-ink-meta mt-1">
              Fill out the details below to create a new job posting.
            </p>
          </header>

          <Stepper steps={STEPS} current={0} className="mt-4" />

          {/* padding="none" because the card's own rules have to sit inside the
              padding, not run edge to edge — so each block pads itself. */}
          <Card padding="none" className="mt-5">
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

                  <TextField
                    id="location"
                    label="Location"
                    placeholder="e.g. San Francisco, CA or Remote"
                    value={draft.location}
                    onChange={(event) => set("location", event.target.value)}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <SelectField
                    id="employment-type"
                    label="Employment Type"
                    value={draft.employmentType}
                    onValueChange={(type) => set("employmentType", type)}
                    options={EMPLOYMENT_TYPES}
                  />

                  <SalaryField
                    id="salary-min"
                    label="Salary Min (USD)"
                    placeholder="100,000"
                    value={draft.salaryMin}
                    onValueChange={(value) => set("salaryMin", value)}
                  />

                  <SalaryField
                    id="salary-max"
                    label="Salary Max (USD)"
                    placeholder="150,000"
                    value={draft.salaryMax}
                    onValueChange={(value) => set("salaryMax", value)}
                  />
                </div>

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

            {/* Inset rules, not edge-to-edge ones: the mockup stops them at the
                card's padding, so they line up with the fields rather than
                cutting the card into strips. mx-, not a bordered wrapper. */}
            <hr className="border-border-subtle mx-4.5" />

            <div className="p-4.5">
              <ScreeningQuestions questions={questions} onChange={setQuestions} />
            </div>

            <hr className="border-border-subtle mx-4.5" />

            <div className="flex flex-wrap items-center justify-end gap-3 p-4.5">
              <Button variant="secondary">Save Draft</Button>
              <Button>Continue to Screening</Button>
            </div>
          </Card>
        </div>

        {/* top-6 is the page's own py-6, and nothing more. A sticky offset is
            measured from its scroll container, and the shell's scroller now
            starts below the bar rather than at the top of the window — so
            clearing --company-bar as well, which is what this used to do, would
            park the panel a bar's height too low. */}
        <aside className="min-w-0 lg:sticky lg:top-6">
          <h2 className="text-title text-ink flex items-center gap-2">
            <EyeIcon className="text-ink-meta size-4.5" />
            Live Preview
          </h2>

          <div className="mt-4">
            <JobPreview draft={draft} />
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * A salary input that only accepts digits and shows them grouped.
 *
 * Grouping as you type rather than on blur is what makes the placeholder's
 * "100,000" the truth about the field instead of a hint it contradicts the
 * moment you use it. The draft keeps the bare digits, so ./preview.tsx can
 * parse without stripping separators back out.
 */
function SalaryField({
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
