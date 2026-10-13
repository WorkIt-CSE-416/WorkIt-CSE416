"use server";

import { apiDelete, apiGet } from "@/lib/api";
import { apiFetch, extractErrorMessage } from "@/lib/auth";
import { getApplicantSession } from "@/lib/session";

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
export type Skill = { id: string; name: string; group: string | null };
/** Entries in section order, ongoing first and then newest. */
export type Bank = { entries: BankEntry[]; skills: Skill[] };

type Result<T> = { data: T | null; error: string | null };

const OFFLINE = "Could not reach the server.";

// Ids are encoded: any browser script can call an action with any argument.
const id = (value: string) => encodeURIComponent(value);

async function call<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  try {
    const session = await getApplicantSession();
    const url = `/applicants/${id(session.id)}/bank${path}`;
    const res =
      init == null
        ? await apiGet(url, session.token)
        : init.method === "DELETE"
          ? await apiDelete(url, session.token)
          : await apiFetch(url, init, session.token);
    if (!res.ok) return { data: null, error: await extractErrorMessage(res) };
    return { data: res.status === 204 ? null : ((await res.json()) as T), error: null };
  } catch {
    return { data: null, error: OFFLINE };
  }
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

/** A draft entry from import: a `createEntry` body, plus the id of the bank
 *  entry it matches ("Already in your bank"), or null. */
export type DraftEntry = EntryFields & { bullets: string[]; duplicate_of: string | null };
export type DraftSkill = { name: string; group: string | null; in_bank: boolean };
export type ImportResult = {
  resume_id: string;
  filename: string | null;
  entries: DraftEntry[];
  skills: DraftSkill[];
};

/** Reads an uploaded resume (the default one, else the newest) into draft
 *  entries and skills. Saves nothing: each draft goes through `createEntry`
 *  and `addSkill`. With no uploaded resume, `error` says so. */
export async function importResume(resumeId?: string): Promise<Result<ImportResult>> {
  return call<ImportResult>("/import", {
    method: "POST",
    body: JSON.stringify(resumeId ? { resume_id: resumeId } : {}),
  });
}
