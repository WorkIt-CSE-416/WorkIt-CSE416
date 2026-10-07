"use server";

import { apiGet } from "@/lib/api";
import { apiFetch, extractErrorMessage } from "@/lib/auth";
import { getApplicantSession } from "@/lib/session";

export type ApplicantProfile = {
  id: string;
  email: string;
  full_name: string;
  phone_number: string | null;
  headline: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  github_url: string | null;
  other_url: string | null;
};

export async function getProfile(): Promise<{
  profile: ApplicantProfile | null;
  error: string | null;
}> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiGet(`/applicants/${id}/profile`, token);
    if (!res.ok) return { profile: null, error: await extractErrorMessage(res) };
    const profile: ApplicantProfile = await res.json();
    return { profile, error: null };
  } catch {
    return { profile: null, error: "Could not reach the server." };
  }
}

export async function updateProfile(
  fields: Partial<Omit<ApplicantProfile, "id" | "email">>,
): Promise<{ profile: ApplicantProfile | null; error: string | null }> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiFetch(
      `/applicants/${id}/profile`,
      { method: "PATCH", body: JSON.stringify(fields) },
      token,
    );
    if (!res.ok) return { profile: null, error: await extractErrorMessage(res) };
    const profile: ApplicantProfile = await res.json();
    return { profile, error: null };
  } catch {
    return { profile: null, error: "Could not reach the server." };
  }
}
