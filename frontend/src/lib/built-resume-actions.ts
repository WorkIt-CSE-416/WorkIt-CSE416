"use server";

import { applicantCall, encodeId, type Result } from "@/lib/applicant-call";
import type { BankEntry, Skill } from "@/lib/bank-actions";
import type { ApplicantProfile } from "@/lib/profile-actions";
import { revalidatingResumes } from "@/lib/resume-revalidate";

/**
 * Built resumes (backend/app/routers/built_resumes.py), as server actions.
 * Types mirror backend/app/schemas/built_resume.py. Every action returns
 * `error: string | null` and never throws. Files come back as base64, which
 * the browser turns into a download: a resume is tens of KB, far under
 * Vercel's 4.5 MB response limit.
 *
 * A write the Resumes page shows (Generate, Rename, Delete, the star) goes
 * through `revalidatingResumes`, so a Back to a list of resumes reads it
 * again. The editor's per-edit saves and Fit do not: each would render the
 * editor's page, PDF and all, again (`lib/resume-revalidate.ts`).
 */

export type BuiltResume = {
  id: string;
  name: string;
  template: string;
  job_posting_id: string | null;
  is_default: boolean;
  created_at: string;
  /** The last change to the resume itself (what shows, its order, its
   *  wording or its name); `created_at` until the first one (KAN-258). */
  edited_at: string;
  /** A tailored resume whose posting the Jobs page no longer lists. */
  posting_closed: boolean;
  /** A tailored resume's posting, which its card names and links to
   *  (KAN-268); null on a base resume. */
  posting_title: string | null;
  posting_company: string | null;
};

/**
 * Where one line sits on the PDF (schemas `RenderBox`): the bank id of the
 * bullet, skill or entry it shows, which part (`kind`: "bullet", "skill", or
 * an entry field such as "title" or "dates"), its page from 1, and its
 * rectangle in PDF points from the page's top left, y growing down. `text`
 * is the line as printed, labels included ("GPA: 3.8/4.0").
 */
export type RenderBox = {
  item_id: string;
  kind: string;
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  text: string;
};

/** The header a PDF printed (schemas `IdentityCopy`): the editor sends it
 *  back in its copy. */
export type IdentityCopy = {
  name: string;
  email: string | null;
  phone: string | null;
  links: [string, string][];
  us_citizen: boolean;
};

/** The PDF, base64, what the student is warned about before saving it, and
 *  the editor's click targets. */
export type RenderedPdf = {
  pdf: string;
  /** What a download saves it as: the resume's name, header-safe. */
  file_name: string;
  page_count: number;
  /** Lines of text past page 1; an estimate that can run a line or two short. */
  lines_over: number;
  missing_characters: string[];
  boxes: RenderBox[];
  identity: IdentityCopy | null;
  /** The resume's template id, sent back in the editor's copy. */
  template: string;
};

/** The editor's copy of what its PDF is built from (schemas `ResumeCopy`,
 *  KAN-391): with it, an edit's PDF compiles with no database read at all,
 *  the template and file name taken from the last render. It shapes only
 *  the PDF sent back. */
export type ResumeCopy = {
  entries: BankEntry[];
  skills: Skill[];
  choices: Choices;
  identity: IdentityCopy;
  template: string;
  file_name: string;
};

const id = encodeId;

function call<T>(path: string, init?: RequestInit, read?: (res: Response) => Promise<T>) {
  return applicantCall<T>(`/built-resumes${path}`, init, read);
}

export async function listBuiltResumes(): Promise<Result<BuiltResume[]>> {
  return call<BuiltResume[]>("");
}

/** Generate: a base resume with everything in the bank, "Resume #N" when
 *  no name is given. No limit: only uploads count toward the 5. */
export async function generateResume(name?: string): Promise<Result<BuiltResume>> {
  return revalidatingResumes(
    call<BuiltResume>("", { method: "POST", body: JSON.stringify(name ? { name } : {}) }),
  );
}

/** A new name for the resume (KAN-258); its sent resumes keep theirs. */
export async function renameBuiltResume(
  resumeId: string,
  name: string,
): Promise<Result<BuiltResume>> {
  return revalidatingResumes(
    call<BuiltResume>(`/${id(resumeId)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  );
}

export async function deleteBuiltResume(resumeId: string): Promise<{ error: string | null }> {
  return revalidatingResumes(call<null>(`/${id(resumeId)}`, { method: "DELETE" }));
}

export async function setDefaultBuiltResume(resumeId: string): Promise<{ error: string | null }> {
  return revalidatingResumes(call(`/${id(resumeId)}/default`, { method: "PUT" }));
}

/** The PDF, for the editor's preview and its Download PDF. Kept nowhere. */
export async function renderResumePdf(resumeId: string): Promise<Result<RenderedPdf>> {
  return call<RenderedPdf>(`/${id(resumeId)}/render`);
}

/** A file to save, base64, under the name it saves as. */
export type ResumeFile = { data: string; contentType: string; fileName: string };

/** The Word file (`docx`) or the PDF's LaTeX source (`tex`), for the
 *  editor's Download. Kept nowhere (KAN-267). */
export async function downloadResumeFile(
  resumeId: string,
  format: "docx" | "tex",
): Promise<Result<ResumeFile>> {
  return call<ResumeFile>(`/${id(resumeId)}/${format}`, undefined, async (res) => ({
    data: Buffer.from(await res.arrayBuffer()).toString("base64"),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
    // The API names it (Content-Disposition), header-safe already.
    fileName:
      /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ??
      `Resume.${format}`,
  }));
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

/** Every change in one request, saved together and answered with nothing
 *  (`?read_back=false`, KAN-391): the API writes with no read first when
 *  every change finds its row, and the editor renders through `renderEdit`,
 *  so it needs nothing back. */
export async function updateChoices(
  resumeId: string,
  changes: ChoicesUpdate,
): Promise<Result<null>> {
  return call<null>(`/${id(resumeId)}/choices?read_back=false`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

/** When anything the resume's page prints last changed, and the database's
 *  clock now (KAN-391): the editor asks on a return to its tab after a
 *  while away, and reloads only if something changed while it was hidden. */
export async function resumeChangedAt(
  resumeId: string,
): Promise<Result<{ changed_at: string; now: string }>> {
  return call<{ changed_at: string; now: string }>(`/${id(resumeId)}/changed-at`);
}

/** One edit rendered and never saved (KAN-391): a typed line or choice
 *  changes, made to the editor's copy in memory, so the API reads nothing
 *  but the resume's row. What the edit changed in the copy comes back with
 *  the PDF: the choices after a bullet or a choice change, the entry's own
 *  fields after an entry field (`bullets` and `resume_ids` empty), the
 *  header in `render.identity`. */
export type EditRendered = {
  render: RenderedPdf;
  choices: Choices | null;
  entry: BankEntry | null;
};

export async function renderEdit(
  resumeId: string,
  edit: { line: { item_id: string; kind: string; text: string } } | { changes: ChoicesUpdate },
  source?: ResumeCopy,
): Promise<Result<EditRendered>> {
  return call<EditRendered>(`/${id(resumeId)}/render`, {
    method: "POST",
    body: JSON.stringify({ ...edit, source }),
  });
}

/** What a typed line's save wrote that the editor cannot know: a bullet's
 *  local variant (null when the original was typed back), and the profile
 *  after a header field. */
export type LineSaved = {
  variant_id: string | null;
  profile: ApplicantProfile | null;
};

/** One typed line saved, never rendered: the clicked box's item and kind,
 *  and the text as typed. The API reads it (a GPA must be a number) and
 *  answers why when it cannot save it; it writes with no read first, and
 *  checks a typed entry field against `source`'s copy of the entry. */
export async function saveLine(
  resumeId: string,
  line: { item_id: string; kind: string; text: string },
  source?: ResumeCopy,
): Promise<Result<LineSaved>> {
  return call<LineSaved>(`/${id(resumeId)}/lines`, {
    method: "PUT",
    body: JSON.stringify({ ...line, source }),
  });
}

/** Fit to One Page: the bullets it hid, `undo` (the PATCH body that shows
 *  everything it hid again, whole entries and coursework too) and the
 *  render after, which can still be 2 pages when nothing more could go. */
export async function fitToOnePage(resumeId: string): Promise<
  Result<{
    hidden: string[];
    undo: ChoicesUpdate;
    render: RenderedPdf;
  }>
> {
  return call(`/${id(resumeId)}/fit`, { method: "POST" });
}
