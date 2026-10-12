import { apiGet } from "@/lib/api";
import { getApplicantSession } from "@/lib/session";

/**
 * A resume drawn with its template, as a PDF or Word file (KAN-176): the
 * builder's preview and downloads, and My Profile's preview of a built
 * resume. A route handler rather than an action because the answer is a
 * file. It adds the session's token, which only this server can read, and
 * passes the API's answer through untouched; the API decides whose resume
 * it is.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/resumes/[resumeId]/download">) {
  const { resumeId } = await ctx.params;
  let session: { id: string; token: string };
  try {
    session = await getApplicantSession();
  } catch {
    return Response.json({ detail: "Sign in to see your resume." }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const query = new URLSearchParams();
  for (const key of ["format", "template", "inline"]) {
    const value = searchParams.get(key);
    if (value) query.set(key, value);
  }
  try {
    const upstream = await apiGet(
      `/applicants/${session.id}/resumes/${encodeURIComponent(resumeId)}/download?${query}`,
      session.token,
    );
    const headers = new Headers({
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
      // A resume is personal; never let a shared cache keep one
      "Cache-Control": "private, no-store",
    });
    const disposition = upstream.headers.get("Content-Disposition");
    if (disposition) headers.set("Content-Disposition", disposition);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return Response.json({ detail: "Could not reach the server." }, { status: 502 });
  }
}
