import "server-only";

import { apiDelete, apiGet } from "@/lib/api";
import { apiFetch, extractErrorMessage } from "@/lib/auth";
import { getApplicantSession } from "@/lib/session";

/**
 * The one call every applicant server action makes to a route under
 * `/applicants/{id}` (the bank, built resumes, sent resumes, Tailor). It
 * reads the session, sends the token, and never throws: a refusal comes back
 * as the API's message, a network failure as OFFLINE. `status` is the HTTP
 * status (null when nothing answered), for a screen that tells refusals
 * apart. Server-only: the action files that use it are the public surface.
 */

export type Result<T> = { data: T | null; error: string | null; status: number | null };

export const OFFLINE = "Could not reach the server.";

/** Ids are encoded: any browser script can call an action with any argument. */
export const encodeId = (value: string) => encodeURIComponent(value);

/** `path` is under `/applicants/{id}` ("/bank/entries"). No `init` is a GET;
 *  a 204 is `data: null`. `read` turns a body into data (JSON by default). */
export async function applicantCall<T>(
  path: string,
  init?: RequestInit,
  read: (res: Response) => Promise<T> = (res) => res.json() as Promise<T>,
): Promise<Result<T>> {
  try {
    const session = await getApplicantSession();
    const url = `/applicants/${encodeId(session.id)}${path}`;
    const res =
      init == null
        ? await apiGet(url, session.token)
        : init.method === "DELETE"
          ? await apiDelete(url, session.token)
          : await apiFetch(url, init, session.token);
    if (!res.ok) return { data: null, error: await extractErrorMessage(res), status: res.status };
    return { data: res.status === 204 ? null : await read(res), error: null, status: res.status };
  } catch {
    return { data: null, error: OFFLINE, status: null };
  }
}
