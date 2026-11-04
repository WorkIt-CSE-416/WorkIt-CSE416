import { planFit } from "@/lib/built-resume-actions";

/**
 * One cycle of the editor's Fit to One Page (`planFit`, KAN-584): the body
 * is `{ resumeId, plan }`, and the answer is `planFit`'s Result as JSON, its
 * status the API's.
 *
 * A route handler, not a server action, for the reason `../resume-edit`
 * gives: Next runs a client's actions one at a time, so a plan sent as an
 * action waited behind the save of the cycle before it. The API checks the
 * account owns the resume.
 */
export async function POST(request: Request) {
  const { resumeId, plan } = await request.json();
  if (typeof resumeId !== "string" || !plan) {
    return Response.json(
      { data: null, error: "Send a resume to fit.", status: 400 },
      { status: 400 },
    );
  }
  const result = await planFit(resumeId, plan);
  return Response.json(result, { status: result.status ?? 502 });
}
