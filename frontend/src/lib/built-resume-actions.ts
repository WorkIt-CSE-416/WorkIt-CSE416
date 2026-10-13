"use server";

import { apiDelete, apiGet } from "@/lib/api";
import { apiFetch, extractErrorMessage } from "@/lib/auth";
import { getApplicantSession } from "@/lib/session";

/**
 * Built resumes (backend/app/routers/built_resumes.py), as server actions.
 * Types mirror backend/app/schemas/built_resume.py. Every action returns
 * `error: string | null` and never throws. Files come back as base64, which
 * the browser turns into a download: a resume is tens of KB, far under
 * Vercel's 4.5 MB response limit.
 */

export type BuiltResume = {
  id: string;
  name: string;
  template: string;
  job_posting_id: string | null;
  is_default: boolean;
  created_at: string;
  /** A tailored resume whose posting the Jobs page no longer lists. */
  posting_closed: boolean;
};

/**
 * Where one line sits on the PDF (schemas `RenderBox`): the bank id of the
 * bullet, skill or entry it shows, which part (`kind`: "bullet", "skill", or
 * an entry field such as "title" or "dates"), its page from 1, and its
 * rectangle in PDF points from the page's top left, y growing down.
 */
export type RenderBox = {
  item_id: string;
  kind: string;
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

/** The PDF, base64, what the student is warned about before saving it, and
 *  the editor's click targets. */
export type RenderedPdf = {
  pdf: string;
  page_count: number;
  /** Lines of text past page 1; an estimate that can run a line or two short. */
  lines_over: number;
  missing_characters: string[];
  boxes: RenderBox[];
};

type Result<T> = { data: T | null; error: string | null };

const OFFLINE = "Could not reach the server.";

// Ids are encoded: any browser script can call an action with any argument.
const id = (value: string) => encodeURIComponent(value);

async function call<T>(
  path: string,
  init?: RequestInit,
  read: (res: Response) => Promise<T> = (res) => res.json() as Promise<T>,
): Promise<Result<T>> {
  try {
    const session = await getApplicantSession();
    const url = `/applicants/${id(session.id)}/built-resumes${path}`;
    const res =
      init == null
        ? await apiGet(url, session.token)
        : init.method === "DELETE"
          ? await apiDelete(url, session.token)
          : await apiFetch(url, init, session.token);
    if (!res.ok) return { data: null, error: await extractErrorMessage(res) };
    return { data: res.status === 204 ? null : await read(res), error: null };
  } catch {
    return { data: null, error: OFFLINE };
  }
}

export async function listBuiltResumes(): Promise<Result<BuiltResume[]>> {
  return call<BuiltResume[]>("");
}

/** Generate: a base resume with everything in the bank. Refused (the
 *  API's message in `error`) when the student already has 5 resumes. */
export async function generateResume(name?: string): Promise<Result<BuiltResume>> {
  return call<BuiltResume>("", { method: "POST", body: JSON.stringify(name ? { name } : {}) });
}

export async function deleteBuiltResume(resumeId: string): Promise<{ error: string | null }> {
  return call<null>(`/${id(resumeId)}`, { method: "DELETE" });
}

export async function setDefaultBuiltResume(resumeId: string): Promise<{ error: string | null }> {
  return call(`/${id(resumeId)}/default`, { method: "PUT" });
}

export async function renderResumePdf(resumeId: string): Promise<Result<RenderedPdf>> {
  return call<RenderedPdf>(`/${id(resumeId)}/render`);
}

/** The Word file as base64. */
export async function downloadResumeDocx(resumeId: string): Promise<Result<string>> {
  return call<string>(`/${id(resumeId)}/docx`, undefined, async (res) =>
    Buffer.from(await res.arrayBuffer()).toString("base64"),
  );
}

/** A built resume's choice rows (schemas `ChoicesResponse`, KAN-218). A bank
 *  item with no row is not on the resume. A bullet's `text` is the wording
 *  it shows when that is not the bank's original (null: the original). */
export type EntryChoice = {
  entry_id: string;
  shown: boolean;
  position: number;
  show_gpa: boolean;
  show_coursework: boolean;
};
export type BulletChoice = {
  bullet_id: string;
  shown: boolean;
  position: number;
  variant_id: string | null;
  text: string | null;
};
export type SkillChoice = { skill_id: string; shown: boolean; position: number };
/** A wording a bullet can switch to: Tailor's, or this resume's own (`local`). */
export type Variant = {
  id: string;
  bullet_id: string;
  text: string;
  job_posting_id: string | null;
  local: boolean;
};
export type Choices = {
  entries: EntryChoice[];
  bullets: BulletChoice[];
  skills: SkillChoice[];
  variants: Variant[];
};

/** One PATCH's changes; a field left out keeps its value. A bullet's `text`
 *  becomes this resume's local variant; `variant_id: null` shows the original. */
export type ChoicesUpdate = {
  entries?: (Partial<Omit<EntryChoice, "entry_id">> & { entry_id: string })[];
  bullets?: ({ bullet_id: string; shown?: boolean; position?: number } & (
    { text?: string } | { variant_id?: string | null }
  ))[];
  skills?: (Partial<Omit<SkillChoice, "skill_id">> & { skill_id: string })[];
};

export async function getChoices(resumeId: string): Promise<Result<Choices>> {
  return call<Choices>(`/${id(resumeId)}/choices`);
}

/** Every change in one request, saved together; returns the choices after. */
export async function updateChoices(
  resumeId: string,
  changes: ChoicesUpdate,
): Promise<Result<Choices>> {
  return call<Choices>(`/${id(resumeId)}/choices`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

/** Fit to One Page: the bullets it hid (Undo shows them again) and the
 *  render after, which can still be 2 pages when nothing more could go. */
export async function fitToOnePage(
  resumeId: string,
): Promise<Result<{ hidden: string[]; render: RenderedPdf }>> {
  return call(`/${id(resumeId)}/fit`, { method: "POST" });
}
