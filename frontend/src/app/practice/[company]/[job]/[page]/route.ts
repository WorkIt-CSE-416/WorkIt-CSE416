import { practicePage } from "@/lib/practice-form";

/**
 * Onboarding's practice forms (KAN-378), /practice/<company>/<job>/apply,
 * and the page each one's Submit opens, .../thanks: whole HTML documents
 * from lib/practice-form, not React pages, so they look like a hiring
 * system and the extension's test serves the same bytes. Public: the
 * extension's background reads the form's questions from it without the
 * student's cookies. Only GET is answered: the forms send nothing.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/practice/[company]/[job]/[page]">,
) {
  const { company, job, page } = await ctx.params;
  const html = practicePage(company, job, page);
  if (!html) return new Response("Not found", { status: 404 });
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex" },
  });
}
