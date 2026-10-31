"use server";

import { headers } from "next/headers";

import { apiFetch } from "@/lib/auth";

import { answerBody } from "./answer";

export type SurveyState = { sent: boolean; error: string | null };

/**
 * Sends the survey's answer (KAN-471) to `POST /uninstall-answers`, with no
 * session: the answer is anonymous. The student's address goes along as
 * `x-workit-client-ip` only for the API's per-sender cap, which keeps it in
 * memory and never stores it (backend/app/routers/uninstall_answers.py).
 * Cloudflare sets `cf-connecting-ip`; x-forwarded-for is the local and
 * Vercel equivalent.
 */
export async function sendAnswer(_: SurveyState, form: FormData): Promise<SurveyState> {
  const body = answerBody(form);
  if (!body) return { sent: false, error: "Pick one answer first." };
  const headersList = await headers();
  const address =
    headersList.get("cf-connecting-ip") ??
    headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "";
  try {
    const response = await apiFetch("/uninstall-answers", {
      method: "POST",
      body: JSON.stringify(body),
      headers: address ? { "x-workit-client-ip": address } : {},
    });
    // 429: this sender, or everyone today, has sent enough; an earlier answer is in.
    if (response.ok || response.status === 429) return { sent: true, error: null };
    return { sent: false, error: "That didn't send. Try again." };
  } catch {
    return {
      sent: false,
      error: "Could not reach the server. Check your connection and try again.",
    };
  }
}
