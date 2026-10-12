import type { EntryDraft, Section } from "@/lib/experience-actions";

/**
 * What each Section of the bank asks for, and what it is called: one table
 * the entry editor, the bank's list and the intake review all read, so the
 * three can't name a field differently. The order is the order Jake's
 * Resume prints them in (backend/app/services/resume_render/jakes.py).
 */
export type SectionInfo = {
  key: Section;
  /** The list's heading */
  title: string;
  /** One of them, Title Case: "Add Experience" */
  noun: string;
  titleLabel: string;
  /** Null: the section has no organization (a project) */
  orgLabel: string | null;
  location: boolean;
  /** "range": start and end months; "one": a single date (when it was won) */
  dates: "range" | "one";
  bullets: boolean;
};

export const SECTION_INFO: SectionInfo[] = [
  {
    key: "education",
    title: "Education",
    noun: "Education",
    titleLabel: "Degree",
    orgLabel: "School",
    location: true,
    dates: "range",
    bullets: true,
  },
  {
    key: "experience",
    title: "Experience",
    noun: "Experience",
    titleLabel: "Role",
    orgLabel: "Company",
    location: true,
    dates: "range",
    bullets: true,
  },
  {
    key: "project",
    title: "Projects",
    noun: "Project",
    titleLabel: "Project Name",
    orgLabel: null,
    location: false,
    dates: "range",
    bullets: true,
  },
  {
    key: "activity",
    title: "Leadership & Activities",
    noun: "Activity",
    titleLabel: "Role",
    orgLabel: "Organization",
    location: true,
    dates: "range",
    bullets: true,
  },
  {
    key: "award",
    title: "Awards",
    noun: "Award",
    titleLabel: "Award",
    orgLabel: "Given By",
    location: false,
    dates: "one",
    bullets: true,
  },
  {
    key: "certification",
    title: "Certifications",
    noun: "Certification",
    titleLabel: "Certification",
    orgLabel: "Issuer",
    location: false,
    dates: "one",
    bullets: false,
  },
];

export const INFO = Object.fromEntries(SECTION_INFO.map((s) => [s.key, s])) as Record<
  Section,
  SectionInfo
>;

const MONTH = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "Jun 2024 – Present", as the resume prints it. Dates are UTC days, so
 *  formatted in UTC (lib/format-date.ts says why). */
export function span(start: string | null, end: string | null): string {
  const f = (d: string) => MONTH.format(new Date(`${d}T00:00:00Z`));
  if (start && end) return `${f(start)} – ${f(end)}`;
  if (start) return `${f(start)} – Present`;
  return end ? f(end) : "";
}

/** What an entry's details add, as one line: "Python, Flask · GPA 3.6". */
export function detailLine(entry: Pick<EntryDraft, "details">): string {
  const { field_of_study, gpa, technologies, url } = entry.details;
  return [technologies, field_of_study, gpa != null ? `GPA ${gpa}` : null, url]
    .filter(Boolean)
    .join(" · ");
}
