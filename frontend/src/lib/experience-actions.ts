"use server";

import { call } from "@/lib/applicant-call";
import type { ParsedResume } from "@/lib/resume-actions";

/**
 * Server actions for the Experience Bank and the resume builder (KAN-176):
 * backend/app/routers/experience.py and resume_builder.py. Every one answers
 * `{ ..., error }` rather than throwing, so a screen can show what went wrong
 * in place. The bank's first read is in experience-queries.ts, for the Server
 * Component that draws it.
 */

// Mirrors backend/app/schemas/experience.py.
export type Section =
  "education" | "experience" | "project" | "activity" | "award" | "certification";

export type EntryDetails = {
  field_of_study?: string | null;
  gpa?: number | null;
  url?: string | null;
  technologies?: string | null;
};

export type EntryDraft = {
  section: Section;
  title: string;
  organization: string | null;
  location: string | null;
  /** ISO "YYYY-MM-DD"; the builder edits months and stores the 1st */
  start_date: string | null;
  end_date: string | null;
  bullets: string[];
  details: EntryDetails;
};

export type Entry = EntryDraft & { id: string };
export type BankSkill = { name: string; category: string | null };
export type Bank = { entries: Entry[]; skills: BankSkill[] };

export type Suggestion = {
  /** The ParsedResume list the line is in */
  section: "experience" | "projects" | "activities" | "education";
  item: number;
  bullet: number;
  original: string;
  suggested: string;
};

// Ids come from the page, and an action is an endpoint anything can call:
// encoded, so a crafted one can't walk the request onto another route.
const seg = encodeURIComponent;

/** Adds an entry, or replaces the one `id` names. */
export async function saveEntry(entry: EntryDraft, id?: string) {
  return id
    ? call<Entry>(`/experience/entries/${seg(id)}`, { method: "PUT", body: JSON.stringify(entry) })
    : call<Entry>("/experience/entries", { method: "POST", body: JSON.stringify(entry) });
}

export async function deleteEntry(id: string) {
  return call<null>(`/experience/entries/${seg(id)}`, { method: "DELETE" });
}

/** The whole skill list, in order. */
export async function saveSkills(skills: BankSkill[]) {
  return call<BankSkill[]>("/experience/skills", {
    method: "PUT",
    body: JSON.stringify({ skills }),
  });
}

/** Appends a stored resume's sections to the bank. */
export async function importResume(resumeId: string) {
  return call<{ added_entries: number; added_skills: number }>(
    `/experience/import/${seg(resumeId)}`,
    { method: "POST" },
  );
}

/** Proposed bullets for one entry; nothing is saved. */
export async function writeBullets(entry: EntryDraft, notes: string) {
  return call<{ bullets: string[] }>("/experience/ai/bullets", {
    method: "POST",
    body: JSON.stringify({ entry, notes }),
  });
}

/** Free text as proposed entries; nothing is saved. */
export async function readExperience(text: string) {
  return call<{ entries: EntryDraft[] }>("/experience/ai/intake", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

/** Builds the resume from the chosen entries and every skill, then saves it
 *  as a Generated Resume. */
export async function generateResume(entryIds: string[], name: string, templateKey: string) {
  const composed = await call<ParsedResume>("/experience/compose", {
    method: "POST",
    body: JSON.stringify({ entry_ids: entryIds }),
  });
  if (composed.error != null) return composed;
  return saveResume(composed.data, name, templateKey);
}

/** Saves a resume as given: a Tailored Resume when `targetJobId` is set. */
export async function saveResume(
  resume: ParsedResume,
  name: string,
  templateKey: string,
  targetJobId?: string,
) {
  return call<{ id: string; original_filename: string; pages: number }>("/resumes/generated", {
    method: "POST",
    body: JSON.stringify({
      resume,
      name,
      template_key: templateKey,
      target_job_id: targetJobId ?? null,
    }),
  });
}

/** One job posting's reordering and rewordings; nothing is saved. Starts from
 *  the resume `resumeId` names, or the whole bank without one. */
export async function tailorResume(jobId: string, resumeId: string | null) {
  return call<{ resume: ParsedResume; suggestions: Suggestion[]; notice: string | null }>(
    "/tailor",
    { method: "POST", body: JSON.stringify({ job_id: jobId, resume_id: resumeId }) },
  );
}
