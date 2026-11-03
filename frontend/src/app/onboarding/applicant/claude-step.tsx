"use client";

import { useEffect, useState } from "react";

import { ClaudeIcon, ExternalLinkIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui/button";
import { getClaudeConnected } from "@/lib/connector-actions";

import { Line } from "./extension-step";

/** How often the step asks WorkIt again, so it sees the connector added without a reload. */
const POLL_MS = 3000;

/**
 * Whether the student's Claude holds the WorkIt connector (GET
 * /applicants/{id}/connector, KAN-387's check), asked now and every POLL_MS
 * while `active`: null before the first answer and after a failed read.
 */
export function useClaudeConnected(active: boolean): boolean | null {
  const [added, setAdded] = useState<boolean | null>(null);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const ask = async () => {
      const next = await getClaudeConnected().catch(() => null);
      if (!stopped && next) setAdded(next.added);
    };
    void ask();
    const timer = setInterval(ask, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active]);
  return added;
}

/**
 * Onboarding's optional Add Claude page (KAN-507), between the extension
 * and the practice batch: the install link (lib/claude-connector.ts, read
 * on the server and passed down as `link`) opens Claude's Add Custom
 * Connector dialog filled in for WorkIt. The line turns done once the
 * student's Claude has signed in to WorkIt, as the extension's lines do.
 * A student who adds it here never sees the extension's add-Claude moment
 * (KAN-387), which skips anyone whose connector is added.
 */
export function ClaudeStep({ added, link }: { added: boolean | null; link: string }) {
  return (
    <ol className="flex flex-col gap-4">
      <Line
        n={1}
        title="Write Answers With Your Claude"
        done={added === true}
        optional
        status={added === null ? null : added ? "Added" : "Not Added Yet"}
      >
        {added ? (
          <p>
            Your Claude is connected. On each batch, it writes the written answers from your
            experience, and WorkIt checks them before they fill in.
          </p>
        ) : (
          <>
            <p>
              Many forms ask written questions, like why you want the job. Add WorkIt to your own
              Claude, and it writes each answer from your experience. WorkIt never runs an AI model
              itself.
            </p>
            <ButtonLink
              href={link}
              target="_blank"
              rel="noreferrer"
              variant="secondary"
              size="sm"
              className="mt-3 self-start"
            >
              <ClaudeIcon className="size-4" />
              Add to Claude
              <ExternalLinkIcon className="size-4" />
            </ButtonLink>
            <p className="text-body text-ink-meta mt-2">
              Skip it, and you write those answers yourself. This page sees it as soon as your
              Claude connects.
            </p>
          </>
        )}
      </Line>
    </ol>
  );
}
