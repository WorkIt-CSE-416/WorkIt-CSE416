"use server";

import { redirect } from "next/navigation";

import { apiFetch, extractErrorMessage } from "@/lib/auth";

// firstName/lastName/email round-trip the submitted values back
// into the form on failure. React resets a useActionState-bound form's
// uncontrolled fields once the action completes, so without this an error
// (a taken email, say) would wipe every field the user just typed along with
// it. The password doesn't need this — signup-form.tsx already
// keeps them in local state, and echoing a password back isn't good practice
// regardless. The company* fields are only filled on the Create Company path.
export type SignupState = {
  error: string | null;
  firstName: string;
  lastName: string;
  email: string;
  companyName: string;
  websiteUrl: string;
  contactEmail: string;
  contactPhone: string;
};

/**
 * Sign up (for job_applicants)
 *
 * POST /auth/signup (backend/app/routers/auth.py) creates the Supabase
 * auth user and the profile row. It goes through the API rather than
 * `supabase.auth.signUp()` because only the API can set the account type
 * where the user can't edit it.
 *
 * Email verification is required: the action redirects to /signup/check-email
 * after a successful signup. The user signs in after clicking the confirm link.
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
    lastName,
    email,
    companyName,
    websiteUrl,
    contactEmail,
    contactPhone,
  };

  // clear the white spaces
  // No middle name: sign-up asks the minimum (KAN-372); Settings adds one.
  const name = [firstName, lastName]
    .map((part) => part.trim())
    .filter((part) => part.trim().length > 0)
    .join(" ");

  const password = fieldValue(formData, "password");
  const captchaToken = fieldValue(formData, "cf-turnstile-response") || null;

  // create the user in backend with supabase
  const response = await apiFetch("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      accountType,
      name,
      captchaToken,
      // The parts too (KAN-326), so the API stores the name as typed
      // rather than splitting `name` again.
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email,
      password,

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

  // Email verification is required before sign-in. Redirect to the
  // check-email page regardless — a taken-email signup returns 201
  // silently, so this path always runs.
  redirect("/signup/check-email");
}
