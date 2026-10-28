import { getFillBrief } from "@/lib/fill-report-queries";

/** The fix brief as a Markdown download, for an admin (the API checks). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, status } = await getFillBrief(id);
  if (data === null) return new Response("Not found.", { status: status === 401 ? 401 : 404 });
  return new Response(data, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="fill-report-${id.slice(0, 8)}.md"`,
    },
  });
}
