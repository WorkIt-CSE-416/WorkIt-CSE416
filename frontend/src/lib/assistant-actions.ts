"use server";

import { apiFetch, extractErrorMessage } from "@/lib/auth";
import { getApplicantSession } from "@/lib/session";

/**
 * The editor assistant (backend/app/routers/assistant.py), as a server
 * action. Types mirror backend/app/schemas/assistant.py. Returns
 * `error: string | null` and never throws.
 */

export type AssistantAction = "fit" | "hide" | "move_up" | "move_down" | "shorter" | "none";

/** What the editor does next. For "shorter", `text` is the proposal and
 *  `original` the wording it replaces; nothing is saved until it is used. */
export type AssistantReply = {
  action: AssistantAction;
  reply: string;
  text: string | null;
  original: string | null;
  uses_left: number;
};

/** The selected line, by its bank id: at most one. */
export type AssistantLine = { bullet_id?: string; entry_id?: string; skill_id?: string };

/** One message: spends one of today's assistant messages when the model answers. */
export async function askAssistant(
  resumeId: string,
  message: string,
  line: AssistantLine,
): Promise<{ data: AssistantReply | null; error: string | null }> {
  try {
    const session = await getApplicantSession();
    const url = `/applicants/${encodeURIComponent(session.id)}/built-resumes/${encodeURIComponent(resumeId)}/assistant`;
    const res = await apiFetch(
      url,
      { method: "POST", body: JSON.stringify({ message, ...line }) },
      session.token,
    );
    if (!res.ok) return { data: null, error: await extractErrorMessage(res) };
    return { data: (await res.json()) as AssistantReply, error: null };
  } catch {
    return { data: null, error: "Could not reach the server." };
  }
}
