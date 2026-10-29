"use server";

import { revalidatePath } from "next/cache";

import { apiFetch, extractErrorMessage } from "@/lib/auth";
import { isReportId, statusOf } from "@/lib/fill-reports";
import { getAccessToken } from "@/lib/session";

/**
 * Fix reports' one write (KAN-369): an admin sets a report's status and note
 * (PATCH /admin/fill-reports/{id}). Every export here is a public endpoint:
 * the id must be a UUID and the API checks the caller is an admin.
 */
export async function triageFillReport(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const status = statusOf(String(formData.get("status") ?? ""));
  const note = String(formData.get("admin_note") ?? "").slice(0, 4000);
  if (!isReportId(id) || !status) throw new Error("Pick a status.");
  const token = await getAccessToken();
  if (!token) throw new Error("You're signed out. Sign in again to continue.");
  const response = await apiFetch(
    `/admin/fill-reports/${id}`,
    { method: "PATCH", body: JSON.stringify({ status, admin_note: note.trim() || null }) },
    token,
  );
  if (!response.ok) throw new Error(await extractErrorMessage(response));
  revalidatePath(`/admin/fill-reports/${id}`);
  revalidatePath("/admin/fill-reports");
}
