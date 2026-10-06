"use server";

import { redirect } from "next/navigation";

import { apiFetch, extractErrorMessage, type AuthenticatedAccount } from "@/lib/auth";
import { getAccessToken } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// companyName/websiteUrl/contactEmail/contactPhone round-trip the submitted
// values back into the form on failure, same reasoning as
// signup/actions.ts's SignupState — there's no email or password here for
// React's post-action reset to spare.
export type ChooseAccountTypeState = {
  error: string | null;
  companyName: string;
  websiteUrl: string;
  contactEmail: string;
  contactPhone: string;
};

function fieldValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Finishes a Google/LinkedIn sign-in that /auth/callback sent here because
 * Supabase created the auth user without going through POST /auth/signup —
 * app_metadata.account_type and the profile row are both still missing
 * (backend/CLAUDE.md's Auth section). POST /auth/oauth/account-type creates
 * them; refreshSession() then re-fetches the access token so it carries the
 * account_type claim that was just set — the token the browser arrived with
 * was issued before that existed.
 */
export async function chooseAccountType(
  _prevState: ChooseAccountTypeState,
  formData: FormData,
): Promise<ChooseAccountTypeState> {
  const accountType = fieldValue(formData, "accountType");
  const companyName = fieldValue(formData, "companyName");
  const websiteUrl = fieldValue(formData, "websiteUrl");
  const contactEmail = fieldValue(formData, "contactEmail");
  const contactPhone = fieldValue(formData, "contactPhone");
  const companySize = fieldValue(formData, "companySize");
  const echo = { companyName, websiteUrl, contactEmail, contactPhone };

  const token = await getAccessToken();
  if (!token) {
    redirect("/login");
  }

  const response = await apiFetch(
    "/auth/oauth/account-type",
    {
      method: "POST",
      body: JSON.stringify({
        accountType,
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
    },
    token,
  );

  if (!response.ok) {
    return { error: await extractErrorMessage(response), ...echo };
  }

  const account: AuthenticatedAccount = await response.json();

  const supabase = await createSupabaseServerClient();
  await supabase.auth.refreshSession();

  if (account.account_type === "applicant") {
    // KAN-141: onboarding is skipped for faster prototyping, same as
    // signup/actions.ts and login/actions.ts.
    redirect("/profile");
  } else {
    redirect("/company");
  }
}
