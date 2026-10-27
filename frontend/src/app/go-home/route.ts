import { NextResponse, type NextRequest } from "next/server";

import { homePath } from "@/lib/auth";
import { getCurrentAccount } from "@/lib/session";

/**
 * /go-home: a redirect to the signed-in account's own home, for a link on a page
 * that must not read the session itself. The root 404's "Back to Home"
 * (app/not-found.tsx) is the one today: that page renders into every page's
 * tree, so a session read there made the whole site dynamic. The lookup
 * waits for the click instead and lands here.
 *
 * The destination is homePath()'s, the same as a password sign-in's: the
 * business side for a company account (which src/proxy.ts sends on to
 * /coming-soon while KAN-239 hides it), onboarding for an applicant who has
 * not finished it, Home after. Anyone the API does not know, signed
 * out or with the API down, goes to /home, the seeker's Home;
 * the seeker layout then sends a signed-out visitor to /login.
 *
 * It was /home until the seeker's Dashboard became Home at that path
 * (2026-10-27). Dynamic on purpose: the answer is per request. The proxy
 * matches /go-home, so
 * the session is refreshed before this reads it.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const account = await getCurrentAccount();
  return NextResponse.redirect(new URL(account ? homePath(account) : "/home", request.url));
}
