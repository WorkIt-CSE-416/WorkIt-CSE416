"use client";

import { useSearchParams } from "next/navigation";

/** What the auth callback's `?notice=` says on the way back from a link or
 *  a confirm email (lib/account-actions.ts). Read in the browser: the
 *  section is drawn by a layout, which gets no search params. */
const NOTICES: Record<string, string> = {
  email: "Your sign-in email is changed.",
  "email-pending": "Link accepted. Open the link we sent to your other email to finish.",
  linked: "Your sign-in method is connected.",
};

export function SecurityNotice() {
  const notice = useSearchParams().get("notice");
  const message = notice ? NOTICES[notice] : undefined;
  if (!message) return null;
  return (
    <p role="status" className="bg-positive-tint text-ink rounded-control text-body px-4 py-3">
      {message}
    </p>
  );
}
