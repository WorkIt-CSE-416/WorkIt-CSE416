import { renderResumePdf } from "@/lib/built-resume-actions";
import { readUploadedPdf } from "@/lib/resume-queries";

/**
 * The PDF of the resume picked in Tailor, for its preview
 * (`(seeker)/jobs/[jobId]/tailor/resume-preview.tsx`): `?built=<id>` renders
 * a built resume (`renderResumePdf`, kept nowhere), `?uploaded=<id>` reads an
 * upload's file (`readUploadedPdf`). It answers `{ pdf, error }`, the PDF in
 * base64 as `PdfPages` takes it; `pdf: null` with no error is a DOCX.
 *
 * A route handler, not a server action: Next runs a client's server actions
 * one at a time, so a render of a second or two, or several picks in a row,
 * would hold back Use This Resume's keyword match behind them. Each id goes
 * to the API, which checks the account owns it; the only URL fetched is the
 * file link the API answers for that id.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const built = params.get("built");
  const uploaded = params.get("uploaded");

  if (built) {
    const { data, error, status } = await renderResumePdf(built);
    if (!data) return Response.json({ pdf: null, error }, { status: status ?? 502 });
    return Response.json({ pdf: data.pdf, error: null });
  }
  if (uploaded) {
    const { pdf, error } = await readUploadedPdf(uploaded);
    return Response.json({ pdf, error }, { status: error ? 502 : 200 });
  }
  return Response.json({ pdf: null, error: "Pick a resume to preview it." }, { status: 400 });
}
