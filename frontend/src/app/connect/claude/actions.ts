"use server";

import { redirect } from "next/navigation";

import { apiFetch, extractErrorMessage } from "@/lib/auth";
import { getAccessToken } from "@/lib/session";

export type ConsentState = { error: string | null };

/**
 * The consent page's Allow and Deny (KAN-377): the API answers the client's
 * redirect URI, with a code or with access_denied, and the browser goes
 * there, back to Claude. The request id is checked by the API; any browser
 * script can call this with any id.
 */
async function answer(requestId: string, choice: "approve" | "deny"): Promise<ConsentState> {
  const token = await getAccessToken();
  if (!token) return { error: "Sign in to WorkIt first." };
  let to: string;
  try {
    const res = await apiFetch(
      `/connector/requests/${encodeURIComponent(requestId)}/${choice}`,
      { method: "POST" },
      token,
    );
    if (!res.ok) return { error: await extractErrorMessage(res) };
    to = ((await res.json()) as { redirect_to: string }).redirect_to;
  } catch {
    return { error: "Could not reach the server." };
  }
  // Outside the try: redirect() throws to do its work.
  redirect(to);
}

export async function connectClaude(
  _prev: ConsentState,
  formData: FormData,
): Promise<ConsentState> {
  return answer(
    String(formData.get("request") ?? ""),
    formData.get("choice") === "deny" ? "deny" : "approve",
  );
}
