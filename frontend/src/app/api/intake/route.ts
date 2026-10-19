import { apiFetch } from "@/lib/auth";
import { getAccessToken } from "@/lib/session";

/**
 * The browser's door to intake's turns (KAN-213), the same shape as
 * /api/scout: a route handler because the reply is an NDJSON stream. It adds
 * the session's token and pipes the API's lines back untouched; the API
 * decides who may use intake and counts the turns.
 */
export async function POST(request: Request) {
  const token = await getAccessToken();
  if (!token) return Response.json({ detail: "Sign in to use intake." }, { status: 401 });

  try {
    const upstream = await apiFetch(
      "/intake/turn",
      { method: "POST", body: await request.text() },
      token,
    );
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return Response.json(
      { detail: "Scout can't answer right now. Try again in a minute." },
      { status: 502 },
    );
  }
}
