"use server";

import { apiDelete, apiGet, apiUpload } from "@/lib/api";
import { extractErrorMessage } from "@/lib/auth";
import { getApplicantSession } from "@/lib/session";

/**
 * Profile photo for the signed-in applicant. `url` is a signed Storage URL
 * that expires after an hour, so it is fetched per page load and never
 * stored; null means no photo, and <Avatar> falls back to initials.
 */
type AvatarResult = { url: string | null; error: string | null };

export async function getAvatar(): Promise<AvatarResult> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiGet(`/applicants/${id}/avatar`, token);
    if (!res.ok) return { url: null, error: await extractErrorMessage(res) };
    const { url } = await res.json();
    return { url, error: null };
  } catch {
    return { url: null, error: "Could not reach the server." };
  }
}

export async function uploadAvatar(formData: FormData): Promise<AvatarResult> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiUpload(`/applicants/${id}/avatar`, formData, token, "PUT");
    if (!res.ok) return { url: null, error: await extractErrorMessage(res) };
    const { url } = await res.json();
    return { url, error: null };
  } catch {
    return { url: null, error: "Could not reach the server. Is the backend running?" };
  }
}

export async function removeAvatar(): Promise<{ error: string | null }> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiDelete(`/applicants/${id}/avatar`, token);
    if (!res.ok) return { error: await extractErrorMessage(res) };
    return { error: null };
  } catch {
    return { error: "Could not reach the server." };
  }
}
