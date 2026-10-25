"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { SparkleIcon } from "@/components/icons";
import { Button, ButtonLink } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { disconnectClaude } from "@/lib/connector-actions";

/**
 * Settings' Claude row action: Disconnect while the student's Claude is
 * signed in to WorkIt, which revokes it at once (lib/connector-actions.ts)
 * and refreshes the row; Add to Claude otherwise, opening Claude's Add
 * Custom Connector dialog (`claudeLink`, lib/claude-connector.ts, read on
 * the server).
 */
export function ClaudeButton({
  connected,
  claudeLink,
}: {
  connected: boolean;
  claudeLink: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();

  if (!connected) {
    return (
      <ButtonLink href={claudeLink} target="_blank" rel="noreferrer" variant="secondary" size="sm">
        <SparkleIcon className="size-4" />
        Add to Claude
      </ButtonLink>
    );
  }

  function run() {
    setError(null);
    startBusy(async () => {
      const result = await disconnectClaude();
      if (result.error) {
        setError(result.error);
        return;
      }
      toast.show({ message: "Claude is disconnected." });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" size="sm" disabled={busy} onClick={run}>
        Disconnect
      </Button>
      {error && (
        <p role="alert" className="text-meta text-danger max-w-56 text-right">
          {error}
        </p>
      )}
    </div>
  );
}
