import type { BankEntry, EntryFields, Section } from "@/lib/bank-actions";

/**
 * The experience bank's sections in the order every screen and resume shows
 * them. Skills, the seventh, is a plain list with its own card, not entries.
 * `title` and `organization` name those two fields for the section: one
 * entry shape, worded the way a student thinks of each kind.
 */
export const SECTIONS: readonly {
  id: Section;
  label: string;
  title: string;
  organization: string;
}[] = [
  { id: "education", label: "Education", title: "School", organization: "College or Department" },
  { id: "experience", label: "Experience", title: "Job Title", organization: "Company" },
  { id: "projects", label: "Projects", title: "Project Name", organization: "Team or Course" },
  {
    id: "leadership",
    label: "Leadership & Activities",
    title: "Role",
    organization: "Club or Organization",
  },
  { id: "awards", label: "Awards", title: "Award", organization: "Given By" },
  {
    id: "certifications",
    label: "Certifications",
    title: "Certification",
    organization: "Organization",
  },
];

export function sectionOf(id: Section) {
  return SECTIONS.find((s) => s.id === id)!;
}

/** What the editor edits: an entry's fields, plus its bullets, which carry
 *  an id once saved. A draft from intake or import has no ids at all. */
export type EntryDraft = EntryFields & { bullets: { id?: string; text: string }[] };

export function emptyDraft(section: Section): EntryDraft {
  return {
    section,
    title: "",
    organization: null,
    location: null,
    start_month: null,
    end_month: null,
    end_kind: null,
    degree: null,
    field_of_study: null,
    gpa: null,
    gpa_scale: null,
    coursework: [],
    honors: null,
    link: null,
    issuer: null,
    award_date: null,
    bullets: [],
  };
}

/** Copies `source` without the keys named; typed so the result says so. */
function without<T extends object, K extends keyof T>(source: T, ...keys: K[]): Omit<T, K> {
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => !keys.includes(key as K)),
  ) as Omit<T, K>;
}

export function draftOf(entry: BankEntry): EntryDraft {
  return {
    ...without(entry, "id", "bullets"),
    bullets: entry.bullets.map((b) => ({ id: b.id, text: b.text })),
  };
}

/** An edit's PATCH body: every field but the section, which is fixed. */
export function changesOf(draft: EntryDraft): Omit<EntryFields, "section"> {
  return without(draft, "section", "bullets");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2025-05" → "May 2025". Plain string work: a month has no time zone. */
export function formatMonth(month: string): string {
  const [year, m] = month.split("-");
  return `${MONTHS[Number(m) - 1]} ${year}`;
}

/** The dates line an entry shows: "Jun 2025 – Present", "Expected May 2027". */
export function formatDates(entry: EntryFields): string | null {
  if (entry.section === "awards") return entry.award_date ? formatMonth(entry.award_date) : null;
  const end =
    entry.end_kind === "present"
      ? "Present"
      : entry.end_month
        ? `${entry.end_kind === "expected" ? "Expected " : ""}${formatMonth(entry.end_month)}`
        : null;
  const start = entry.start_month ? formatMonth(entry.start_month) : null;
  if (start && end) return `${start} – ${end}`;
  return start ?? end;
}
