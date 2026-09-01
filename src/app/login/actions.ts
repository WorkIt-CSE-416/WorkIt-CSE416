"use server";

/**
 * Placeholder for the sign-in mutation.
 *
 * KAN-43 covers the mockup screens only — real authentication lands with the
 * auth ticket, and this must verify credentials before it does anything. The
 * action exists now so the form POSTs: without it the browser falls back to a
 * GET submit, which would put the password in the URL and the history.
 *
 * There are two account types behind this one form, so this is also where the
 * role lands: a seeker goes to /applications and a company to /company. The
 * guard that keeps each out of the other's screens belongs in a root
 * middleware.ts rather than here — every company route is under /company, so
 * it is one path check, and it covers routes nobody has written yet.
 */
export async function signIn(formData: FormData) {
  void formData;
}
