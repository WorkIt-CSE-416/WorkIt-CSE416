"use server";

import { redirect } from "next/navigation";

import { apiFetch, extractErrorMessage, type AuthenticatedAccount } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
 * Sign up with 2 steps (for job_applicants)
 *
 * 1. POST /auth/signup (backend/app/routers/auth.py) creates the Supabase
 *    auth user and the profile row. It goes through the API rather than
 *    `supabase.auth.signUp()` because only the API can set the account type
 *    where the user can't edit it
 * 2. signInWithPassword() starts the session, setting Supabase's cookies.
 
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

  // create the user in backend with supabase
  const response = await apiFetch("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      accountType,
      name,
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

  const account: AuthenticatedAccount = await response.json();

  // user finishes sign up, logs in and issue token
  const supabase = await createSupabaseServerClient();

  // sign in with the created user, supabase issues the token
  const { error } = await supabase.auth.signInWithPassword({ email: account.email, password });
  if (error) {
    return {
      error: "Your account was created, but signing in failed. Please sign in again.",
      ...echo,
    };
  }

  // only send to onboarding if it's profile 
  if (account.account_type=="applicant")
  {
    // KAN-141: onboarding is skipped for faster prototyping; restore this
    // redirect to send new applicants through it again.
    // redirect(`/onboarding/${account.account_type}`);
    redirect(`/profile`);
  }
  else 
  {
    redirect('/company'); 
  }
}
