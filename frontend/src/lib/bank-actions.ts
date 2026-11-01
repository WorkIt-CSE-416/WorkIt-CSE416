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
/** `resume_ids`: the resumes that hold it (KAN-343), in `Bank.resumes`
 *  order: uploads whose import found it, built resumes that show it. */
export type BankEntry = EntryFields & {
  id: string;
  bullets: Bullet[];
  resume_ids: string[];
  /** Shared by entries that are copies of one: the API's rule (KAN-440). */
  copy_group: string;
};
/** `resume_ids`: as an entry's. */
export type Skill = {
  id: string;
  name: string;
  group: string | null;
  resume_ids: string[];
};
/** One resume in the Experiences view's dropdown. `posting` names a tailored
 *  resume's job posting; `primary` is the starred resume, of either kind. */
export type BankResume = {
  id: string;
  kind: "uploaded" | "base" | "tailored";
  name: string;
  posting: string | null;
  primary: boolean;
  created_at: string;
  /** The resume table's date (KAN-361): a built resume's last edit, an
   *  upload's upload time. */
  edited_at: string;
};
/** Entries in section order, ongoing first and then newest. `resumes`:
 *  uploads, then base, then tailored resumes, each newest first. */
export type Bank = { entries: BankEntry[]; skills: Skill[]; resumes: BankResume[] };

const id = encodeId;

function call<T>(path: string, init?: RequestInit, read?: (res: Response) => Promise<T>) {
  return applicantCall<T>(`/bank${path}`, init, read);
}

/** `builtResumeId` adds that built resume's own skills, which are not in
 *  the bank (Tailor's picked skills, docs/tailor_resume.md): its editor
 *  names them. */
export async function getBank(builtResumeId?: string): Promise<Result<Bank>> {
  return call<Bank>(builtResumeId ? `?built_resume_id=${id(builtResumeId)}` : "");
}

/** Saves a new entry with its bullets, into `resumeId` when given (ADR
 *  0005): an upload owns it, a built resume shows it. When it matches an
 *  entry of the same owner (same section, title and organization, ignoring
 *  case), `duplicate` is that entry and nothing is saved, unless
 *  `allowDuplicate` ("Save as New"). */
export async function createEntry(
  fields: EntryFields,
  bullets: string[],
  allowDuplicate = false,
  resumeId?: string,
): Promise<{ entry: BankEntry | null; duplicate: BankEntry | null; error: string | null }> {
  try {
    const session = await getApplicantSession();
    const params = new URLSearchParams();
    if (allowDuplicate) params.set("allow_duplicate", "true");
    if (resumeId) params.set("resume_id", resumeId);
    const query = params.toString() ? `?${params}` : "";
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

/** Clear All (KAN-352): every entry given, or none when one is not yours. */
export async function deleteEntries(entryIds: string[]): Promise<Result<null>> {
  return call<null>("/entries/delete", { method: "POST", body: JSON.stringify({ ids: entryIds }) });
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

/** Saves a skill, into `resumeId` when given, as `createEntry` does. */
export async function addSkill(
  name: string,
  group: string | null,
  resumeId?: string,
): Promise<Result<Skill>> {
  const query = resumeId ? `?resume_id=${id(resumeId)}` : "";
  return call<Skill>(`/skills${query}`, { method: "POST", body: JSON.stringify({ name, group }) });
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

/** Clear All for the Skills card, as `deleteEntries`. */
export async function deleteSkills(skillIds: string[]): Promise<Result<null>> {
  return call<null>("/skills/delete", { method: "POST", body: JSON.stringify({ ids: skillIds }) });
}

/** What one import wrote into the bank: an upload's own reading, or Import
 *  Again, each replacing what the upload owned (ADR 0005). `found` is what
 *  the reading found, so 0 means it read nothing. */
export type ImportResult = {
  found: number;
  entries_added: number;
  skills_added: number;
  /** Other uploads' rows the reading replaced: only an upload confirming a
   *  parse preview replaces any (KAN-372, ADR 0006). */
  entries_replaced: number;
  skills_replaced: number;
  /** Who read the resume: the heuristic parser, or the model (KAN-222). */
  read_by: "parser" | "model";
  /** AI readings the student has left today. */
  uses_left: number;
};
export type ImportResponse = ImportResult & { resume_id: string; filename: string | null };

/** Import Again: reads an uploaded resume (`resumeId`, else the default one,
 *  else the newest) into the bank, replacing the entries and skills it owns. With no uploaded resume, `error` says so. `readWithAi` reads
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
