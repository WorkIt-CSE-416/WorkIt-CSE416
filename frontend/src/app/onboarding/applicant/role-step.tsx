"use client";

import type { ComponentType, ReactNode } from "react";

import {
  EXPERIENCE_OPTIONS,
  JOB_TYPE_OPTIONS,
  PAY_OPTIONS,
  payUnits,
  WORKPLACE_OPTIONS,
  type FeedFilters,
} from "@/app/(seeker)/jobs/filter-query";
import { SalaryPicker, SearchPicker, type PickOption } from "@/components/filter-controls";
import { ChoiceTile } from "@/components/ui/choice-tile";
import { Chip } from "@/components/ui/chip";
import {
  BriefcaseIcon,
  CalendarIcon,
  CoinIcon,
  LevelIcon,
  PinIcon,
  RoleIcon,
  workStyleIcon,
} from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * Onboarding's first step, the job preferences, and the Field each question
 * sits in. Its own module because two screens draw it: the wizard
 * (./onboarding-form) and Settings' Job Preferences (KAN-326), which edits
 * the saved preferences with the same controls, `dense`. One set of
 * controls, so the two cannot ask different questions.
 *
 * `dense` IS SETTINGS' SIZE, NOT ONBOARDING'S SHRUNK. Onboarding draws each
 * question large on purpose: it is the whole screen, one step at a time.
 * Settings is one section of a modal among others, so `dense` draws what
 * the rest of the app draws for the same choices: 14px headings with a
 * 16px glyph, the pickers at their default 42px, and the answers as the
 * Jobs page's filter chips (`Choices`) in place of 56px tiles. Until
 * 2026-11-03 it only shrank the headings, and the section read as
 * onboarding dropped into Settings.
 */

type Glyph = ComponentType<{ className?: string }>;

const toggle = <T,>(values: T[], value: T) =>
  values.includes(value) ? values.filter((v) => v !== value) : [...values, value];

export type StepProps = { answers: FeedFilters; set: (change: Partial<FeedFilters>) => void };

export function RoleStep({
  answers,
  set,
  roles,
  places,
  seasons,
  dense = false,
}: StepProps & {
  roles: PickOption[];
  places: PickOption[];
  seasons: PickOption[];
  /** Settings' Job Preferences: the app's own sizes (above), h3 headings. */
  dense?: boolean;
}) {
  const interns = answers.jobTypes.includes("internship");
  const size = dense ? "default" : "lg";
  return (
    <>
      <Field dense={dense} Icon={RoleIcon} label="Role" required>
        <SearchPicker
          size={size}
          label="Roles"
          placeholder="Search a role, like Software Engineer"
          empty="No role by that name."
          options={roles}
          values={answers.roles}
          onChange={(next) => set({ roles: next })}
        />
      </Field>
      <Field dense={dense} Icon={BriefcaseIcon} label="Job Type" required>
        <Choices dense={dense} columns="grid-cols-2">
          {JOB_TYPE_OPTIONS.map((o) => (
            <Choice
              dense={dense}
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
            </Choice>
          ))}
        </Choices>
      </Field>
      {interns && (
        <Field dense={dense} Icon={CalendarIcon} label="Start Date">
          {seasons.length === 0 ? (
            <p className="text-body text-ink-meta">No start dates in the feed yet.</p>
          ) : (
            <SearchPicker
              size={size}
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
      {/* After Job Type, which says what kind of job: this says how much
          experience it asks for, and internships count as Entry Level, so
          no pair of the two empties the feed (KAN-284). */}
      <Field dense={dense} Icon={LevelIcon} label="Experience Level">
        <Choices dense={dense} columns="grid-cols-1 sm:grid-cols-2">
          {EXPERIENCE_OPTIONS.map((o) => (
            <Choice
              dense={dense}
              key={o.value}
              pressed={answers.levels.includes(o.value)}
              onClick={() => set({ levels: toggle(answers.levels, o.value) })}
            >
              {o.label}
            </Choice>
          ))}
        </Choices>
      </Field>
      <Field dense={dense} Icon={workStyleIcon("onsite")} label="Workplace" required>
        <Choices dense={dense} columns="grid-cols-1 sm:grid-cols-3">
          {WORKPLACE_OPTIONS.map((o) => (
            <Choice
              dense={dense}
              key={o.value}
              Icon={workStyleIcon(o.value)}
              pressed={answers.workStyles.includes(o.value)}
              onClick={() => set({ workStyles: toggle(answers.workStyles, o.value) })}
            >
              {o.label}
            </Choice>
          ))}
        </Choices>
      </Field>
      <Field dense={dense} Icon={PinIcon} label="Location">
        <SearchPicker
          size={size}
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
      <Field dense={dense} Icon={CoinIcon} label="Salary Range">
        <SalaryPicker
          size={size}
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

/** A question's answers: onboarding's tiles in a grid (`columns`), or in
 *  Settings (`dense`) a wrapping row of chips. */
function Choices({
  dense,
  columns,
  children,
}: {
  dense: boolean;
  columns: string;
  children: ReactNode;
}) {
  return (
    <div className={dense ? "flex flex-wrap gap-2" : cn("grid gap-2 lg:gap-3", columns)}>
      {children}
    </div>
  );
}

/** One answer: onboarding's ChoiceTile, or in Settings (`dense`) the
 *  Jobs page's filter chip, which shares its pressed look. */
function Choice({
  dense,
  pressed,
  onClick,
  Icon,
  children,
}: {
  dense: boolean;
  pressed: boolean;
  onClick: () => void;
  Icon?: Glyph;
  children: ReactNode;
}) {
  if (!dense) {
    return (
      <ChoiceTile pressed={pressed} onClick={onClick} Icon={Icon}>
        {children}
      </ChoiceTile>
    );
  }
  return (
    <Chip pressed={pressed} onClick={onClick}>
      {Icon && <Icon aria-hidden />}
      {children}
    </Chip>
  );
}

/** One question on the right: its glyph and label, a red star when it must be
 *  answered to go on, "Optional" when it need not be.
 *
 *  THE SCREEN HAS THREE TYPE SIZES, AT EVERY WIDTH: 20px for these labels,
 *  16px for every answer (tiles, chips, pills, typed text) and 14px for every
 *  note beside one. The answers' size is text-subtitle, whose own weight is
 *  600, so each answer sets its weight. */
/** A Field's heading id, from its label; its hint is the same id plus
 *  "-hint". */
export const fieldId = (label: string) => `field-${label.toLowerCase().replaceAll(" ", "-")}`;

export function Field({
  Icon,
  label,
  hint,
  required = false,
  dense = false,
  children,
}: {
  Icon: Glyph;
  label: string;
  /** A 14px note under the label: the question as forms word it. */
  hint?: string;
  required?: boolean;
  /** Settings' size (RoleStep's `dense`): a 14px heading, 16px apart. */
  dense?: boolean;
  children: ReactNode;
}) {
  const id = fieldId(label);
  const Heading = dense ? "h3" : "h2";
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "border-border-subtle border-t first:border-t-0 first:pt-0",
        dense ? "py-4" : "py-8",
      )}
    >
      <Heading
        id={id}
        className={cn(
          "text-ink flex items-center font-semibold",
          dense ? "text-body mb-2.5 gap-2" : "text-title mb-4 gap-2.5",
        )}
      >
        <Icon className={cn("text-ink-meta shrink-0", dense ? "size-4" : "size-5")} />
        {label}
        {required ? (
          <span className="text-danger" aria-label="required">
            *
          </span>
        ) : (
          <span
            className={cn("text-ink-meta ml-auto font-normal", dense ? "text-note" : "text-body")}
          >
            Optional
          </span>
        )}
      </Heading>
      {hint && (
        <p id={`${id}-hint`} className="text-body text-ink-meta -mt-2 mb-4">
          {hint}
        </p>
      )}
      {children}
    </section>
  );
}
