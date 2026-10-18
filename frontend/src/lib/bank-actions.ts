"use server";

import { apiFetch, extractErrorMessage } from "@/lib/auth";
import { getApplicantSession } from "@/lib/session";
import { applicantCall, encodeId, OFFLINE, type Result } from "@/lib/applicant-call";

/**
 * The experience bank's API (backend/app/routers/bank.py), as server
 * actions. Types mirror backend/app/schemas/bank.py field for field; a field
 * added here does nothing until the schema declares it. Months are
 * "YYYY-MM". Every action returns `error: string | null` and never throws.
 */

export type Section =
  "education" | "experience" | "projects" | "leadership" | "awards" | "certifications";

export type EndKind = "month" | "present" | "expected";

/** Every field of an entry except its id and bullets. The section fields
 *  (degree … award_date) stay null outside their own section. */
export type EntryFields = {
  section: Section;
  title: string;
  organization: string | null;
  location: string | null;
  start_month: string | null;
  end_month: string | null;
  end_kind: EndKind | null;
  degree: string | null;
  field_of_study: string | null;
  gpa: number | null;
  gpa_scale: number | null;
  coursework: string[];
  honors: string | null;
  link: string | null;
  issuer: string | null;
  award_date: string | null;
};

export type Bullet = { id: string; position: number; text: string };
export type BankEntry = EntryFields & { id: string; bullets: Bullet[] };
/** `entry_ids`: the entries the skill is linked to, in bank order (KAN-216). */
export type Skill = { id: string; name: string; group: string | null; entry_ids: string[] };
/** Entries in section order, ongoing first and then newest. */
export type Bank = { entries: BankEntry[]; skills: Skill[] };

const id = encodeId;

function call<T>(path: string, init?: RequestInit, read?: (res: Response) => Promise<T>) {
  return applicantCall<T>(`/bank${path}`, init, read);
}

export async function getBank(): Promise<Result<Bank>> {
  return call<Bank>("");
}

/** Saves a new entry with its bullets. When it matches an entry already in
 *  the bank (same section, title and organization, ignoring case),
 *  `duplicate` is that entry and nothing is saved, unless `allowDuplicate`
 *  ("Save as New"). */
export async function createEntry(
  fields: EntryFields,
  bullets: string[],
  allowDuplicate = false,
): Promise<{ entry: BankEntry | null; duplicate: BankEntry | null; error: string | null }> {
  try {
    const session = await getApplicantSession();
    const query = allowDuplicate ? "?allow_duplicate=true" : "";
    const res = await apiFetch(
      `/applicants/${id(session.id)}/bank/entries${query}`,
      { method: "POST", body: JSON.stringify({ ...fields, bullets }) },
      session.token,
    );
    if (res.status === 409) {
      const body = (await res.json()) as { duplicate: BankEntry };
      return { entry: null, duplicate: body.duplicate, error: null };
    }
    if (!res.ok) return { entry: null, duplicate: null, error: await extractErrorMessage(res) };
    return { entry: (await res.json()) as BankEntry, duplicate: null, error: null };
  } catch {
    return { entry: null, duplicate: null, error: OFFLINE };
  }
}

/** Changes only the fields given; null clears one. The section is fixed. */
export async function updateEntry(
  entryId: string,
  changes: Partial<Omit<EntryFields, "section">>,
): Promise<Result<BankEntry>> {
  return call<BankEntry>(`/entries/${id(entryId)}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

/** How many built resumes show the entry, for the delete confirm (story 18). */
export async function entryResumeCount(entryId: string): Promise<Result<number>> {
  const res = await call<{ built_resumes: number }>(`/entries/${id(entryId)}/resumes`);
  return { ...res, data: res.data?.built_resumes ?? null };
}

export async function deleteEntry(entryId: string): Promise<Result<null>> {
  return call<null>(`/entries/${id(entryId)}`, { method: "DELETE" });
}

export async function addBullet(entryId: string, text: string): Promise<Result<Bullet>> {
  return call<Bullet>(`/entries/${id(entryId)}/bullets`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

/** New wording and/or a new place in the entry (0 is first). */
export async function updateBullet(
  bulletId: string,
  changes: { text?: string; position?: number },
): Promise<Result<Bullet>> {
  return call<Bullet>(`/bullets/${id(bulletId)}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

export async function deleteBullet(bulletId: string): Promise<Result<null>> {
  return call<null>(`/bullets/${id(bulletId)}`, { method: "DELETE" });
}

export async function addSkill(name: string, group: string | null): Promise<Result<Skill>> {
  return call<Skill>("/skills", { method: "POST", body: JSON.stringify({ name, group }) });
}

export async function updateSkill(
  skillId: string,
  changes: { name?: string; group?: string | null },
): Promise<Result<Skill>> {
  return call<Skill>(`/skills/${id(skillId)}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

export async function deleteSkill(skillId: string): Promise<Result<null>> {
  return call<null>(`/skills/${id(skillId)}`, { method: "DELETE" });
}

/** What one import wrote into the bank (ADR 0003): an upload's own reading,
 *  or Import Again. `found` is what the reading found, written or not, so 0
 *  means it read nothing. */
export type ImportResult = {
  found: number;
  entries_added: number;
  /** Entries the bank had that gained a field or a bullet. */
  entries_updated: number;
  skills_added: number;
  /** Who read the resume: the heuristic parser, or the model (KAN-222). */
  read_by: "parser" | "model";
  /** AI readings the student has left today. */
  uses_left: number;
};
export type ImportResponse = ImportResult & { resume_id: string; filename: string | null };

/** Import Again: reads an uploaded resume (`resumeId`, else the default one,
 *  else the newest) and writes it into the bank, merging the entries it
 *  already has. With no uploaded resume, `error` says so. `readWithAi` reads
 *  it with the model ("Read It With AI"), only ever on the student's click;
 *  `error` says when the AI limit is spent or the model is down. */
export async function importResume(
  options: { resumeId?: string; readWithAi?: boolean } = {},
): Promise<Result<ImportResponse>> {
  return call<ImportResponse>("/import", {
    method: "POST",
    body: JSON.stringify({
      ...(options.resumeId ? { resume_id: options.resumeId } : {}),
      ...(options.readWithAi ? { read_with_ai: true } : {}),
    }),
  });
}

/** Links a skill to an entry that shows it; linking twice is a no-op. */
export async function linkSkill(skillId: string, entryId: string): Promise<Result<null>> {
  return call<null>(`/skills/${id(skillId)}/entries/${id(entryId)}`, { method: "PUT" });
}

export async function unlinkSkill(skillId: string, entryId: string): Promise<Result<null>> {
  return call<null>(`/skills/${id(skillId)}/entries/${id(entryId)}`, { method: "DELETE" });
}
