"use server";

import { headers } from "next/headers";

import { apiFetch, extractErrorMessage } from "@/lib/auth";

export type ResendState = { status: "idle" | "sent" | "error"; message: string | null };

export const INITIAL_RESEND_STATE: ResendState = { status: "idle", message: null };

/**
 * Re-sends Supabase's "Confirm signup" email — POST /auth/resend-confirmation
 * (backend/app/routers/auth.py), unauthenticated, same as signup/actions.ts's
 * createAccount: there is no session yet on this screen either. Always
 * answers a generic "sent" message on success, whatever the email actually
 * was underneath (the route's own doc comment has why) — a 429 is the one
 * failure worth its own message, since it doesn't leak anything about the
 * account, it only says to slow down.
 */
export async function resendConfirmation(
  _prevState: ResendState,
  formData: FormData,
): Promise<ResendState> {
  const email = formData.get("email");
  if (typeof email !== "string" || !email) {
    return { status: "error", message: "Something went wrong. Please try again." };
  }

  const headersList = await headers();
  const host = headersList.get("x-forwarded-host") ?? headersList.get("host");
  const protocol = headersList.get("x-forwarded-proto") ?? "http";
  const redirectTo = `${protocol}://${host}/auth/callback`;

  const response = await apiFetch("/auth/resend-confirmation", {
    method: "POST",
    body: JSON.stringify({ email, redirectTo }),
  });

  if (!response.ok) {
    return { status: "error", message: await extractErrorMessage(response) };
  }

  return { status: "sent", message: "We've sent another verification link." };
}
