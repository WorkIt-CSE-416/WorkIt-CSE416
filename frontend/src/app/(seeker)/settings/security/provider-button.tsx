"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { connectProvider, disconnectProvider } from "@/lib/account-actions";
import type { OAuthProvider } from "@/lib/oauth-actions";

/**
 * Connect or Disconnect for one sign-in provider. Connect leaves for the
 * provider and comes back through the callback; Disconnect unlinks it here,
 * refreshes the list and says so. The API refuses to unlink the last way
 * to sign in, and `canDisconnect` hides the button in that case already.
 */
export function ProviderButton({
  provider,
  name,
  connected,
  canDisconnect,
}: {
  provider: OAuthProvider;
  name: string;
  connected: boolean;
  canDisconnect: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();

  function run() {
    setError(null);
    startBusy(async () => {
      if (!connected) {
        // On success this redirects to the provider and never returns.
        const result = await connectProvider(provider);
        setError(result.error);
        return;
      }
      const result = await disconnectProvider(provider);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast.show({ message: `${name} is disconnected.` });
      router.refresh();
    });
  }

  if (connected && !canDisconnect) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" size="sm" disabled={busy} onClick={run}>
        {connected ? "Disconnect" : "Connect"}
      </Button>
      {error && (
        <p role="alert" className="text-meta text-danger max-w-56 text-right">
          {error}
        </p>
      )}
    </div>
  );
}
