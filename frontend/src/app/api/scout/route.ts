import { apiFetch } from "@/lib/auth";
import { getAccessToken } from "@/lib/session";

/**
 * The browser's door to Scout. A route handler rather than a server action
 * because the reply streams, and an action resolves once with a whole value.
 *
 * It adds the session's access token — which only this server can read — and
 * pipes the API's NDJSON back untouched. The API decides who may use Scout;
 * this only refuses to forward a request it has no token for.
 */
export async function POST(request: Request) {
  const token = await getAccessToken();
  if (!token) return Response.json({ detail: "Sign in to talk to Scout." }, { status: 401 });

  try {
    const upstream = await apiFetch(
      "/scout/chat",
      { method: "POST", body: await request.text() },
      token,
    );
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return Response.json(
      { detail: "Scout is offline right now. Try again in a minute." },
      { status: 502 },
    );
  }
}
