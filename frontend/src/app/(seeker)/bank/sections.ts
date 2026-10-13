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

/** "/4.00" beside a GPA of 3.81: the scale as precise as the GPA, as the
 *  resume prints it. */
function gpaScale(gpa: number, scale: number | null): string {
  if (!scale) return "";
  const places = (n: number) => String(n).split(".")[1]?.length ?? 0;
  return `/${scale.toFixed(Math.max(places(gpa), places(scale)))}`;
}

/** The lines under an entry's title and place: degree and GPA, coursework,
 *  honors, issuer and link. The bank list and import's drafts both show them. */
export function entryDetails(entry: EntryFields): string[] {
  const degree = [entry.degree, entry.field_of_study].filter(Boolean).join(" in ");
  const gpa = entry.gpa != null ? `GPA ${entry.gpa}${gpaScale(entry.gpa, entry.gpa_scale)}` : null;
  return [
    [degree, gpa].filter(Boolean).join(" · "),
    entry.coursework.length ? `Coursework: ${entry.coursework.join(", ")}` : null,
    entry.honors && `Honors: ${entry.honors}`,
    entry.issuer && `Issued by ${entry.issuer}`,
    entry.link,
  ].filter((line): line is string => Boolean(line));
}

/** Sections whose entries a resume reads as "at" someone: a job, a club role. */
const NEEDS_ORGANIZATION = new Set<Section>(["experience", "leadership"]);

/**
 * What a resume would miss from the entry (story 17): its dates, and for a
 * job or club role its organization. The bank page warns before Generate;
 * the entry still saves, since the student may not know them yet.
 */
export function missingFacts(entry: EntryFields): string[] {
  const missing = [];
  if (!formatDates(entry)) missing.push("dates");
  if (NEEDS_ORGANIZATION.has(entry.section) && !entry.organization?.trim()) {
    missing.push(sectionOf(entry.section).organization.toLowerCase());
  }
  return missing;
}

/** Sections whose entries read as things the student did, so want bullets. */
const NEEDS_BULLETS = new Set<Section>(["experience", "projects", "leadership"]);

/**
 * Intake's questions about an entry already in the bank, an imported one
 * most often: one for each fact a resume would miss, plus what they did when
 * a job, project or role has no bullets. Empty when the entry is complete,
 * and then intake does not visit it.
 */
export function gapQuestions(entry: BankEntry): string[] {
  const questions = [];
  if (!formatDates(entry)) {
    questions.push(
      entry.section === "awards" ? "When did you win it?" : "When did it start and end?",
    );
  }
  if (NEEDS_ORGANIZATION.has(entry.section) && !entry.organization?.trim()) {
    questions.push(`What was the ${sectionOf(entry.section).organization.toLowerCase()}?`);
  }
  if (NEEDS_BULLETS.has(entry.section) && entry.bullets.length === 0) {
    questions.push("What did you do there, and what came of it?");
  }
  return questions;
}
