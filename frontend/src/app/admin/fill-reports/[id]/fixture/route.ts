import { getFillFixture } from "@/lib/fill-report-queries";

/** The form's HTML, values out, as a download: text/plain, never rendered, since it is an employer page's markup. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, status } = await getFillFixture(id);
  if (data === null) return new Response("Not found.", { status: status === 401 ? 401 : 404 });
  return new Response(data, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="fill-report-${id.slice(0, 8)}.html"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
