"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { apiFetch, extractErrorMessage, type AuthenticatedAccount } from "@/lib/auth";

// firstName/middleName/lastName/email round-trip the submitted values back
// into the form on failure. React resets a useActionState-bound form's
// uncontrolled fields once the action completes, so without this an error
// (a taken email, say) would wipe every field the user just typed along with
// it. password/confirmPassword don't need this — signup-form.tsx already
// keeps them in local state, and echoing a password back isn't good practice
// regardless. The company* fields are only filled on the Create Company path.
export type SignupState = {
  error: string | null;
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  companyName: string;
  websiteUrl: string;
  contactEmail: string;
  contactPhone: string;
};

/**
 * Sign up with a password (Create Account, never Google/LinkedIn — an
 * OAuth identity is already provider-verified and never touches this
 * action).
 *
 * POST /auth/signup (backend/app/routers/auth.py) creates the Supabase auth
 * user — unconfirmed — and the profile row, through the API rather than
 * `supabase.auth.signUp()` because only the API can set the account type
 * where the user can't edit it. There is no sign-in here: Supabase refuses
 * a session for an unconfirmed email (once the project's "Confirm email"
 * setting is on, docs/auth.md), so the student lands on
 * /signup/check-email instead and signs in for the first time once they
 * click the link that email sends — /auth/callback (route.ts) is what
 * picks that up and sends them on to onboarding.
 */
function fieldValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function createAccount(
  _prevState: SignupState,
  formData: FormData,
): Promise<SignupState> {
  // select all values, they will be None if not for the type
  const firstName = fieldValue(formData, "firstName");
  const middleName = fieldValue(formData, "middleName");
  const lastName = fieldValue(formData, "lastName");
  const email = fieldValue(formData, "email");
  const accountType = fieldValue(formData, "accountType");
  const companyName = fieldValue(formData, "companyName");
  const websiteUrl = fieldValue(formData, "websiteUrl");
  const contactEmail = fieldValue(formData, "contactEmail");
  const contactPhone = fieldValue(formData, "contactPhone");
  const companySize = fieldValue(formData, "companySize");
  const echo = {
    firstName,
    middleName,
    lastName,
    email,
    companyName,
    websiteUrl,
    contactEmail,
    contactPhone,
  };

  // clear the white spaces
  const name = [firstName, middleName, lastName]
    .map((part) => part.trim())
    .filter((part) => part.trim().length > 0)
    .join(" ");

  const password = fieldValue(formData, "password");

  // Where Supabase's confirmation email sends the browser back to, once it
  // verifies the token — same origin-from-headers pattern
  // src/lib/oauth-actions.ts's signInWithOAuth already uses, so a local or
  // preview signup confirms back to itself rather than production.
  const headersList = await headers();
  const host = headersList.get("x-forwarded-host") ?? headersList.get("host");
  const protocol = headersList.get("x-forwarded-proto") ?? "http";
  const redirectTo = `${protocol}://${host}/auth/callback`;

  // create the user in backend with supabase
  const response = await apiFetch("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      accountType,
      name,
      email,
      password,
      redirectTo,

      // fields for company sign up
      ...(accountType === "company" && {
        company: {
          name: companyName.trim(),
          websiteUrl: websiteUrl.trim() || null,
          contactEmail: contactEmail.trim(),
          contactPhone: contactPhone.trim() || null,
          sizeRange: companySize,
        },
      }),
    }),
  });

  if (!response.ok) {
    return { error: await extractErrorMessage(response), ...echo };
  }

  const account: AuthenticatedAccount = await response.json();

  // No sign-in here: the account is unconfirmed, and Supabase refuses a
  // session for it until the student clicks the link the signup above just
  // triggered. /auth/callback sends a verified account on to onboarding or
  // /company; this screen is only ever the waiting room before that.
  redirect(`/signup/check-email?email=${encodeURIComponent(account.email)}`);
}
