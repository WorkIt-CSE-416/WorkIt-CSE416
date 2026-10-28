import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { CheckIcon, SparkleIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { SkylineBackdrop } from "@/components/skyline";
import { apiFetch, extractErrorMessage } from "@/lib/auth";
import { getAccessToken } from "@/lib/session";

import { ConsentForm } from "./consent-form";

export const metadata: Metadata = {
  title: "Connect Claude",
  description: "Let your Claude write your WorkIt answers.",
};

/** Claude's own sign-in hosts (the API registers only these, and loopback in
 * development; backend app/connector/oauth.py CLAUDE_CALLBACKS). */
const CLAUDE_HOSTS = new Set(["claude.ai", "claude.com"]);

/**
 * The connector's consent page (KAN-377; auto-apply/architecture.md 14.6).
 * Claude's sign-in to WorkIt sends the student's browser here from the
 * API's /authorize with `?request=<id>`. Signed out, the student signs in
 * first and comes back (/login's `next`). Allow or Deny answers the API,
 * which says where the browser goes: back to Claude, whose host the page
 * shows (the MCP authorization spec). The auth screens' card, outside both
 * shells.
 */
export default async function ConnectClaudePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Request time: it reads the session.
  await connection();
  const raw = (await searchParams).request;
  const requestId = typeof raw === "string" ? raw : "";

  const token = await getAccessToken();
  if (!token) redirect(`/login?next=${encodeURIComponent(`/connect/claude?request=${requestId}`)}`);

  let clientName: string | null = null;
  let redirectHost = "";
  let problem: string | null = null;
  try {
    const res = await apiFetch(
      `/connector/requests/${encodeURIComponent(requestId)}`,
      { method: "GET" },
      token,
    );
    if (res.ok) {
      const asker = (await res.json()) as { client_name: string; redirect_host: string };
      clientName = asker.client_name;
      redirectHost = asker.redirect_host;
    } else problem = await extractErrorMessage(res);
  } catch {
    problem = "Could not reach the server.";
  }

  return (
    <main className="flex flex-1 items-start justify-center p-6 lg:pt-[12vh]">
      <SkylineBackdrop />

      <div className="max-w-auth rounded-card border-border bg-surface shadow-card w-full border p-6">
        <Logo size="card" className="mx-auto" />

        <h1 className="text-title text-ink mt-2.5 text-center">Connect Claude</h1>
        {clientName ? (
          <>
            <p className="text-body text-ink-muted mt-1 text-center">
              {clientName} wants to use your WorkIt account
            </p>
            <p className="text-note text-ink-meta mt-1 text-center">
              Allow sends you back to <span className="text-ink font-semibold">{redirectHost}</span>
            </p>
            {!CLAUDE_HOSTS.has(redirectHost) && (
              <p role="alert" className="text-note text-warning mt-2 text-center">
                This is a program on your own computer, not Claude&apos;s website. Allow only if you
                just connected WorkIt from Claude Code.
              </p>
            )}
            <ul className="text-body text-ink mt-5 flex flex-col gap-2.5">
              <li className="flex items-start gap-2">
                <SparkleIcon className="text-brand mt-0.5 size-4 shrink-0" />
                Read your next application&apos;s questions, its job posting and your experience
              </li>
              <li className="flex items-start gap-2">
                <CheckIcon className="text-positive mt-0.5 size-4 shrink-0" />
                Save answers, which WorkIt fills into your open application tabs
              </li>
            </ul>
            <p className="text-note text-ink-meta mt-4">
              Back in Claude, when it first asks to use each of WorkIt&apos;s tools, choose{" "}
              <span className="text-ink font-semibold">Always allow</span>, so it doesn&apos;t stop
              to ask at every answer.
            </p>
            <p className="text-note text-ink-meta mt-2">
              Claude writes with your own Claude plan. WorkIt never submits an application: you
              review each one and submit it yourself.
            </p>
            <ConsentForm requestId={requestId} />
          </>
        ) : (
          <p role="alert" className="text-body text-ink-muted mt-1 text-center">
            {problem}
          </p>
        )}
      </div>
    </main>
  );
}
