"use server";

/**
 * Placeholder for the sign-in mutation.
 *
 * KAN-43 covers the mockup screens only — real authentication lands with the
 * auth ticket, and this must verify credentials before it does anything. The
 * action exists now so the form POSTs: without it the browser falls back to a
 * GET submit, which would put the password in the URL and the history.
 */
export async function signIn(formData: FormData) {
  void formData;
}
