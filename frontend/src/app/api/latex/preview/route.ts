import { apiFetch } from "@/lib/auth";
import { getApplicantSession } from "@/lib/session";

/**
 * An applicant's own LaTeX, compiled to a PDF without saving (KAN-176): the
 * LaTeX editor's live preview. A route handler rather than an action because
 * the answer is a file the editor shows from a blob URL. It adds the
 * session's token and passes the API's answer through: the PDF with its
 * X-Pages count, or the JSON saying which line to fix.
 */
export async function POST(request: Request) {
  let session: { id: string; token: string };
  try {
    session = await getApplicantSession();
  } catch {
    return Response.json({ detail: "Sign in to preview your resume." }, { status: 401 });
  }
  try {
    const upstream = await apiFetch(
      `/applicants/${session.id}/latex/preview`,
      { method: "POST", body: await request.text() },
      session.token,
    );
    const headers = new Headers({
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
      // A resume is personal; never let a shared cache keep one
      "Cache-Control": "private, no-store",
    });
    const pages = upstream.headers.get("X-Pages");
    if (pages) headers.set("X-Pages", pages);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return Response.json({ detail: "Could not reach the server." }, { status: 502 });
  }
}
