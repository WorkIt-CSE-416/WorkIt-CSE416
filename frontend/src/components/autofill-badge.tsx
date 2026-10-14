"use client";

import { useEffect, useState } from "react";

import { pingAutofillExtension } from "@/lib/autofill-extension";
import { Badge } from "@/components/ui/badge";

/**
 * The webapp half of the extension bridge (autofiller_extension/CLAUDE.md's
 * "two surfaces" decision) — renders nothing for the overwhelming majority
 * of visitors who don't have the extension, and a small badge for the ones
 * who do and are signed in. Not a dependency of the extension actually
 * working: autofill itself runs from the extension's own popup on
 * whatever page the user lands on, whether or not they ever saw this badge.
 */
export function AutofillBadge() {
  const [state, setState] = useState<"checking" | "ready" | "hidden">("checking");

  useEffect(() => {
    let cancelled = false;
    pingAutofillExtension().then(({ installed, signedIn }) => {
      if (!cancelled) setState(installed && signedIn ? "ready" : "hidden");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state !== "ready") return null;

  return (
    <Badge variant="status" tone="positive">
      Autofill ready
    </Badge>
  );
}
