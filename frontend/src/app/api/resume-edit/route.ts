import { renderEdit } from "@/lib/built-resume-actions";

/**
 * The editor's render of an edit (KAN-391, `renderEdit`): the body is
 * `{ resumeId, edit, source }`, and the answer is `renderEdit`'s Result as
 * JSON, its status the API's.
 *
 * A route handler, not a server action: Next runs a client's server actions
 * one at a time, and the editor sends each edit's save as an action beside
 * this render. As two actions the render waited behind the save, and a
 * typed line read "Saved, 2.4 s" again. The API checks the account owns the
 * resume and every item in the edit.
 */
export async function POST(request: Request) {
  const { resumeId, edit, source } = await request.json();
  if (typeof resumeId !== "string" || !edit) {
    return Response.json(
      { data: null, error: "Send an edit to render.", status: 400 },
      { status: 400 },
    );
  }
  const result = await renderEdit(resumeId, edit, source);
  return Response.json(result, { status: result.status ?? 502 });
}
