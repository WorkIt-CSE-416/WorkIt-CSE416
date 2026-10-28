import { encodeId } from "@/lib/applicant-call";
import { apiFetch } from "@/lib/auth";
import { getApplicantSession } from "@/lib/session";

/**
 * The browser's door to a streamed Tailor run, the same shape as
 * /api/intake: a route handler because the reply is an NDJSON stream of the
 * run's phases (`lib/tailor-actions.ts`, `TailorStreamEvent`). It adds the
 * session's token and the applicant's path and pipes the API's lines back
 * untouched; the API checks the account owns the path and decides the rest.
 */
export async function POST(request: Request) {
  let session: { id: string; token: string };
  try {
    session = await getApplicantSession();
  } catch {
    return Response.json({ detail: "Sign in to tailor a resume." }, { status: 401 });
  }

  try {
    const upstream = await apiFetch(
      `/applicants/${encodeId(session.id)}/tailor/stream`,
      { method: "POST", body: await request.text() },
      session.token,
    );
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return Response.json(
      { detail: "Tailor can't reach WorkIt's AI right now. Try again in a minute." },
      { status: 502 },
    );
  }
}
