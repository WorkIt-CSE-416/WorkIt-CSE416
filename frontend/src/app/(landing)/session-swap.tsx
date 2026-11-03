"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const SignedIn = createContext(false);

/**
 * Asks /api/session once, after the header mounts, whether this browser
 * holds a session (KAN-581). The marketing pages are prerendered and read
 * no session (frontend/CLAUDE.md, KAN-368), so the header is drawn signed
 * out and swaps its sign-up pair here. Any failure leaves it signed out.
 */
export function SessionProbe({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/session", { signal: controller.signal })
      .then((response) => response.json())
      .then((body: { signed_in?: boolean }) => setSignedIn(body.signed_in === true))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return <SignedIn value={signedIn}>{children}</SignedIn>;
}

/** `signedIn` in place of `signedOut` once SessionProbe hears of a session. */
export function SessionSwap({
  signedOut,
  signedIn,
}: {
  signedOut: ReactNode;
  signedIn: ReactNode;
}) {
  return useContext(SignedIn) ? signedIn : signedOut;
}
