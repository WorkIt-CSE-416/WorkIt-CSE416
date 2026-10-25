"use server";

import { applicantCall } from "@/lib/applicant-call";

/**
 * The student's Claude as WorkIt sees it (GET and DELETE
 * /applicants/{id}/connector): whether their Claude holds a live sign-in
 * to WorkIt, and Settings' Disconnect, which revokes every connector token
 * of theirs, so their Claude is refused at once until they add WorkIt
 * again. Through applicantCall: identity from the session, never an
 * argument.
 */

/** `added` null on a failed read, with `error` saying why. */
export async function getClaudeConnected(): Promise<{
  added: boolean | null;
  error: string | null;
}> {
  const { data, error } = await applicantCall<{ added: boolean }>("/connector");
  return { added: data?.added ?? null, error };
}

export async function disconnectClaude(): Promise<{ error: string | null }> {
  const { error } = await applicantCall<null>("/connector", { method: "DELETE" });
  return { error };
}
